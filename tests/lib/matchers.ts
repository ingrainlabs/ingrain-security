/**
 * Custom matchers plus domain-specific assertions for the ingrain-security
 * review flow.
 *
 * Live model output varies, so these are intentionally shape-based and loose:
 * presence of a verdict keyword, a stable tag, an ordering — never exact prose.
 */

import { AssertionError } from "@std/assert";
import { extractYaml, test as hasFrontmatter } from "@std/front-matter";
import { dispatchedWorkers } from "./claudeRunner.ts";
import type { RunResult, StreamEvent } from "./types.ts";

type Pattern = string | RegExp;

const matches = (text: string, p: Pattern): boolean =>
  typeof p === "string" ? text.includes(p) : p.test(text);

const snippet = (text: string, max = 600): string =>
  text.length > max ? text.slice(0, max) + "…" : text;

const indexOf = (text: string, p: Pattern): number => {
  if (typeof p === "string") return text.indexOf(p);
  const m = p.exec(text);
  return m ? m.index : -1;
};

const usesSkill = (ev: StreamEvent, skill: string): boolean => {
  if (ev.type !== "assistant") return false;
  const content = ev.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    // deno-lint-ignore no-explicit-any
    (b: any) =>
      b?.type === "tool_use" && b.name === "Skill" &&
      typeof b.input?.skill === "string" && b.input.skill.endsWith(skill),
  );
};

/** At least one of the patterns must be present. */
export const assertContainsAny = (text: string, patterns: Pattern[], msg?: string): void => {
  if (patterns.some((p) => matches(text, p))) return;
  throw new AssertionError(
    `${msg ?? "Expected one of"} ${patterns.map(String).join(", ")}\n--- output ---\n${
      snippet(text)
    }`,
  );
};

/** Every pattern must be present. */
export const assertContainsAll = (text: string, patterns: Pattern[], msg?: string): void => {
  const missing = patterns.filter((p) => !matches(text, p));
  if (missing.length === 0) return;
  throw new AssertionError(
    `${msg ?? "Missing required patterns"}: ${missing.map(String).join(", ")}\n--- output ---\n${
      snippet(text)
    }`,
  );
};

/** Pattern `a` must appear before pattern `b` in the text. */
export const assertOrder = (text: string, a: Pattern, b: Pattern, msg?: string): void => {
  const ia = indexOf(text, a);
  const ib = indexOf(text, b);
  if (ia === -1) throw new AssertionError(`${msg ?? "order"}: '${a}' not found`);
  if (ib === -1) throw new AssertionError(`${msg ?? "order"}: '${b}' not found`);
  if (ia >= ib) {
    throw new AssertionError(
      `${msg ?? "order"}: expected '${a}' (@${ia}) before '${b}' (@${ib})`,
    );
  }
};

/** A number in 0..100 appears somewhere in the text. */
export const assertHasScore0to100 = (text: string, msg?: string): void => {
  const found = [...text.matchAll(/\b(\d{1,3})\b/g)].some((m) => {
    const n = Number(m[1]);
    return n >= 0 && n <= 100;
  });
  if (!found) {
    throw new AssertionError(
      `${msg ?? "Expected a 0-100 score"}\n--- output ---\n${snippet(text)}`,
    );
  }
};

// `assertRiskDescendsByTag` lived here, parsing `T<n> … risk … <0-100>` pairs out of whatever
// prose or table shape a live scorer produced, to check that risk never rose as the tag index
// did. Re-tagging is `scripts/threat-retag`'s now, so the same property is asserted on JSON in
// `hooks/threat-retag.test.ts` — deterministically, and with no prose to parse. A fuzzy matcher
// kept for a producer that no longer exists is a test that can only mislead.

/**
 * The orchestrator started the security review (announce / review question / Skill).
 *
 * The middle signal used to be the triage worker's dispatch. That worker is gone — Step 0 is
 * now a question the orchestrator asks directly — so the observable it leaves behind is the
 * question's own wording, which `static/skill.test.ts` pins in the flow file.
 */
export const assertReviewStarted = (result: RunResult, msg?: string): void => {
  const announced = /using ingrain-security/i.test(result.text);
  const asked = /run a security review for this change/i.test(result.text);
  const skillFired = result.events.some((ev) => usesSkill(ev, "ingrain-security"));
  if (announced || asked || skillFired) return;
  throw new AssertionError(
    `${msg ?? "Expected the review to start"} (no announce / review question / Skill)\n` +
      `--- text ---\n${snippet(result.text)}`,
  );
};

/** Assert a given worker was dispatched by the orchestrator. */
export const assertWorkerDispatched = (events: StreamEvent[], name: string): void => {
  const got = dispatchedWorkers(events);
  if (!got.includes(name)) {
    throw new AssertionError(`Expected '${name}' dispatched; saw: [${got.join(", ")}]`);
  }
};

/** Parse `---`-delimited YAML frontmatter from a markdown file. */
export const parseFrontmatter = (md: string): Record<string, unknown> => {
  if (!hasFrontmatter(md)) throw new AssertionError("No YAML frontmatter found");
  return extractYaml(md).attrs as Record<string, unknown>;
};

/** The body of a `##` section, from its heading to the next `##` (or end of file). */
export const section = (md: string, heading: string): string => {
  const start = md.indexOf(heading);
  if (start === -1) throw new AssertionError(`Section '${heading}' not found`);
  const rest = md.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
};

/**
 * A procedure's checklist must track its flow: same step labels, same order. The flow is the
 * single source of truth for HOW; the checklist restates WHAT as a terse tracker. That
 * restatement is deliberate — and it silently drifts the moment a step is added to one and
 * not the other, which is exactly what this catches.
 *
 * A step may carry a **sub-letter** (`1a`, `1b`), which is how the flow marks two steps that
 * run in parallel rather than in sequence. The checklist then has to name both halves: a
 * tracker listing only `1` for a forked step would hide whichever half was skipped. The flow
 * numbers those sub-steps inside the parent's prose, so they are matched against the
 * checklist's labels rather than against the flow's own `N. **` headings.
 */
export const assertChecklistTracksFlow = (
  md: string,
  flowHeading: string,
  checklistHeading: string,
): void => {
  const flowBody = section(md, flowHeading);
  const flow = [...flowBody.matchAll(/^(\d)\. \*\*/gm)].map((m) => m[1]);
  const list = [...section(md, checklistHeading).matchAll(/^- \[ \] (\d[a-z]?)\./gm)]
    .map((m) => m[1]);
  if (flow.length === 0) throw new AssertionError(`'${flowHeading}' has no numbered steps`);

  // Expand each flow step to the sub-steps its own prose declares (`**1a — …**`), so a fork
  // is tracked half by half.
  const expected = flow.flatMap((step) => {
    const subs = [...flowBody.matchAll(new RegExp(`\\*\\*${step}([a-z]) — `, "g"))]
      .map((m) => `${step}${m[1]}`);
    return subs.length > 0 ? [...new Set(subs)] : [step];
  });

  if (expected.join(",") !== list.join(",")) {
    throw new AssertionError(
      `'${checklistHeading}' drifted from '${flowHeading}': ` +
        `flow has steps [${expected.join(", ")}], checklist has [${list.join(", ")}]`,
    );
  }
};

// ── Phase blocks ────────────────────────────────────────────────────────────
//
// The producer half of the block model, which no offline check can reach: whether a live
// worker, reading its reference file, actually seeds the markers and writes inside its own.
// Everything else about blocks is asserted statically over prose; these read the artifact a
// model produced.

/** Each `### T<n> — …` entry in a written assessment, body included. */
export const threatEntries = (written: string): string[] => {
  const section = written.slice(written.indexOf("## Threats"));
  const bounded = section.slice(0, section.search(/\n## (?!Threats)/) + 1 || undefined);
  return bounded.split(/\n(?=### )/).filter((chunk) => /^### T\d+/.test(chunk.trim()));
};

/** One entry's `#### <name>` regions, in document order. */
export const phaseBlocksOf = (entry: string): Array<{ name: string; body: string }> =>
  entry.split(/\n(?=#### )/)
    .filter((chunk) => chunk.trim().startsWith("#### "))
    .map((chunk) => {
      const [head, ...rest] = chunk.split("\n");
      return { name: head.replace("#### ", "").trim(), body: rest.join("\n") };
    });

/** True when a block's body holds at least one `Key: value` line — an em-dash reads as
 *  unwritten, exactly as the parser treats it, so a block of dashes is still empty. */
const isFilled = (body: string): boolean =>
  body.split("\n").some((line) => /^[A-Z][A-Za-z ]*:\s*\S/.test(line) && !/:\s*—\s*$/.test(line));

/**
 * Every threat entry carries all four markers in order, and **only** `filled` holds fields.
 *
 * This is the assertion the whole P1 prose pass exists to earn: a worker that seeds `—` into
 * blocks it does not own destroys the empty-block signal at the earliest possible moment, and
 * nothing downstream can then tell a half-run review from a finished one.
 */
export const assertOnlyBlockFilled = (written: string, filled: string, msg?: string): void => {
  const entries = threatEntries(written);
  // Cardinality first: zero entries would satisfy every per-entry assertion below.
  if (entries.length === 0) {
    throw new AssertionError(
      `${msg ?? "phase blocks"}: no \`### T<n>\` entries were written\n--- file ---\n${
        snippet(written, 1200)
      }`,
    );
  }
  for (const entry of entries) {
    const blocks = phaseBlocksOf(entry);
    const names = blocks.map((block) => block.name);
    if (names.join(",") !== "gen,score,usergate,test") {
      throw new AssertionError(
        `${msg ?? "phase blocks"}: expected markers gen,score,usergate,test — got [${
          names.join(", ")
        }]\n--- entry ---\n${snippet(entry)}`,
      );
    }
    for (const block of blocks) {
      const shouldBeFilled = block.name === filled;
      if (isFilled(block.body) !== shouldBeFilled) {
        throw new AssertionError(
          `${msg ?? "phase blocks"}: \`#### ${block.name}\` should be ${
            shouldBeFilled ? "filled" : "empty"
          }\n--- entry ---\n${snippet(entry)}`,
        );
      }
    }
  }
};

/** A line the worker was told to carry across untouched survives verbatim, in the block
 *  that owned it. The risk scorer is the one writer that rewrites whole entries, so this
 *  is what stands between a re-tag and a wiped prior verdict. */
export const assertBlockCarriedAcross = (
  written: string,
  block: string,
  line: string,
  msg?: string,
): void => {
  const owning = threatEntries(written)
    .flatMap(phaseBlocksOf)
    .filter((candidate) => candidate.name === block);
  if (owning.length === 0) {
    throw new AssertionError(`${msg ?? "carry-across"}: no \`#### ${block}\` block survived`);
  }
  if (!owning.some((candidate) => candidate.body.includes(line))) {
    throw new AssertionError(
      `${msg ?? "carry-across"}: "${line}" is not in any \`#### ${block}\` block\n--- blocks ---\n${
        owning.map((candidate) => candidate.body).join("\n---\n")
      }`,
    );
  }
};

/**
 * Custom matchers plus domain-specific assertions for the ingrain-security
 * review flow.
 *
 * Live model output varies, so these are intentionally shape-based and loose:
 * presence of a verdict keyword, a stable tag, an ordering — never exact prose.
 *
 * Everything here reads `TToolUse` — the host-neutral tool-call shape each backend normalizes
 * its event stream into (`RunResult.uses`) — never a host's raw events.
 */

import { AssertionError } from "@std/assert";
import { extractYaml, test as hasFrontmatter } from "@std/front-matter";
import type { RunResult, TToolUse } from "./types.ts";
import { isWorker } from "./workers.ts";

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

/**
 * The hosts' subagent primitives, under every name any of them has shipped under.
 *
 * **Names, plural, deliberately.** The name is the host's, not ours, and this detector is what
 * every dispatch assertion reads — a rename it does not know about turns each positive
 * assertion red and, far worse, each NEGATIVE one vacuous. That is exactly what happened:
 * Claude Code's tool became `Agent`, nothing emitted `Task` any more, and `dispatchedWorkers`
 * returned `[]` for every run — so "the review halted before dispatching a worker" passed
 * whether or not it had. The same hazard `lib/workers.ts` documents for the roster, reaching
 * the suite through the host.
 */
const SUBAGENT_TOOLS = new Set(["Agent", "Task", "task"]);

/** The subagent dispatch, if the orchestrator made one. */
export const usesSubagent = (uses: readonly TToolUse[]): boolean =>
  uses.some((u) => SUBAGENT_TOOLS.has(u.name));

/**
 * Workers dispatched by the orchestrator, in order of appearance.
 *
 * Workers are reference files under the single ingrain-security skill now, not
 * platform-native agents, so dispatch no longer shows up as a dedicated
 * platform tool. The orchestrator dispatches a generic subagent told to
 * read `references/development/<name>.md`, so we recover the worker from the dispatch
 * prompt. The in-context fallback reads the same reference via the host's skill tool, so
 * we count that too.
 */
export const dispatchedWorkers = (uses: readonly TToolUse[]): string[] => {
  const workers: string[] = [];
  for (const u of uses) {
    if (SUBAGENT_TOOLS.has(u.name)) {
      const prompt = u.input.prompt;
      if (typeof prompt === "string") {
        const m = prompt.match(/references\/development\/([a-z-]+)\.md/);
        if (m && isWorker(m[1])) {
          workers.push(m[1]);
          continue;
        }
      }
    }
    if (u.name === "Skill" && typeof u.input.skill === "string") {
      const skill = u.input.skill.split(":").pop() ?? "";
      if (isWorker(skill)) workers.push(skill);
    }
  }
  return workers;
};

/** Names of all tools invoked, in order. */
export const toolNames = (uses: readonly TToolUse[]): string[] => uses.map((u) => u.name);

/** Does any normalized tool use invoke the given host skill? */
export const usesSkill = (uses: readonly TToolUse[], skill: string): boolean =>
  uses.some(
    (u) =>
      u.name === "Skill" && typeof u.input.skill === "string" &&
      u.input.skill.endsWith(skill),
  );

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
// did. Re-tagging is `ingrain assessment retag`'s now, so the same property is asserted on JSON
// in that command's own tests — deterministically, and with no prose to parse. A fuzzy matcher
// kept for a producer that no longer exists is a test that can only mislead.

/**
 * The orchestrator started the security review (announce / review question / Skill).
 *
 * The baseline signals are text — the announce wording and the review question, which are the
 * skill's own language — plus the Skill invocation when the host has that tool. **The wording
 * is the model's, and it flexes**: hosts without a Skill tool load the skill by reading it, and
 * the model then says "use/using Ingrain Security", hyphen or space. The trio is deliberately
 * host-neutral; an artifact-level assertion (a minted assessment) belongs to the case, which
 * holds the fixture path the matcher does not.
 */
export const assertReviewStarted = (result: RunResult, msg?: string): void => {
  const announced = /(use|using)\s+ingrain[- ]?security/i.test(result.text);
  const asked = /run a security review for this change/i.test(result.text);
  const skillFired = usesSkill(result.uses, "ingrain-security");
  if (announced || asked || skillFired) return;
  throw new AssertionError(
    `${msg ?? "Expected the review to start"} (no announce / review question / Skill)\n` +
      `--- text ---\n${snippet(result.text)}`,
  );
};

/** Assert a given worker was dispatched by the orchestrator. */
export const assertWorkerDispatched = (uses: readonly TToolUse[], name: string): void => {
  const got = dispatchedWorkers(uses);
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

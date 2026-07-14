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

/**
 * Risk descends as the threat tag rises: `T1` is the most critical threat, `Tn` the least.
 * The `ingrain-risk-scorer` re-tags the frozen list into this order, so the tags it returns
 * must carry non-increasing risk scores. Reads one `T<n> … risk … <0-100>` pair per line,
 * whichever prose or table shape the model used.
 */
export const assertRiskDescendsByTag = (text: string, msg?: string): void => {
  const byTag = new Map<number, number>();
  for (
    const m of text.matchAll(/^[^\n]*?\bT(\d+)\b[^\n]*?\brisk(?:\s*score)?\b\D{0,12}(\d{1,3})/gim)
  ) {
    const tag = Number(m[1]);
    if (!byTag.has(tag)) byTag.set(tag, Number(m[2]));
  }
  const scored = [...byTag.entries()].sort(([a], [b]) => a - b);
  if (scored.length < 2) {
    throw new AssertionError(
      `${msg ?? "Expected risk to descend by tag"}: found ${scored.length} tagged risk score(s), ` +
        `need at least 2\n--- output ---\n${snippet(text)}`,
    );
  }
  for (let i = 1; i < scored.length; i++) {
    const [prevTag, prevRisk] = scored[i - 1];
    const [tag, risk] = scored[i];
    if (risk > prevRisk) {
      throw new AssertionError(
        `${msg ?? "Expected risk to descend by tag"}: T${tag} (risk ${risk}) outranks ` +
          `T${prevTag} (risk ${prevRisk}) — the scorer did not re-tag into risk order\n` +
          `--- output ---\n${snippet(text)}`,
      );
    }
  }
};

/** The orchestrator started the security review (announce / triage dispatch / Skill). */
export const assertReviewStarted = (result: RunResult, msg?: string): void => {
  const announced = /using ingrain-security/i.test(result.text);
  const triaged = dispatchedWorkers(result.events).includes("ingrain-relevance-triage");
  const skillFired = result.events.some((ev) => usesSkill(ev, "ingrain-security"));
  if (announced || triaged || skillFired) return;
  throw new AssertionError(
    `${msg ?? "Expected the review to start"} (no announce / ingrain-relevance-triage / Skill)\n` +
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

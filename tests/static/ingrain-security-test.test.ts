/**
 * Static checks on the ingrain-security-test skill and its hook wiring. No model
 * calls. Guards the verification contract the skill relies on: it reads the same
 * per-task assessment file (by ABSOLUTE assessment_abs), dispatches a read-only
 * verifier subagent per adopted mitigation, records a Verified status + advances
 * the stage to review, and is nudged by a Stop hook on Claude.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parseFrontmatter } from "../lib/matchers.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL = `${ROOT}skills/ingrain-security-test/SKILL.md`;
const VERIFIER_REF =
  `${ROOT}skills/ingrain-security-test/references/ingrain-mitigation-verifier.md`;
const ASSESSMENT_REF = `${ROOT}skills/ingrain-security/references/assessment-file.md`;
const HOOK_JSON = `${ROOT}hooks/claude/hook.json`;
const VERIFY_NUDGE = `${ROOT}hooks/claude/verify-nudge`;
const SESSION_START = `${ROOT}hooks/start/session-start`;

Deno.test("SKILL.md: frontmatter name is ingrain-security-test", async () => {
  const fm = parseFrontmatter(await Deno.readTextFile(SKILL));
  assertEquals(fm.name, "ingrain-security-test");
});

Deno.test("SKILL.md: dispatches the read-only verifier worker via its reference file", async () => {
  const md = await Deno.readTextFile(SKILL);
  // The one worker role and the read-reference dispatch mechanism.
  assertStringIncludes(md, "ingrain-mitigation-verifier");
  assertStringIncludes(md, "Read references/ingrain-mitigation-verifier.md");
  // The read-only constraint is restated for the dispatched subagent.
  assertStringIncludes(md.toLowerCase(), "read-only");
  // Cross-platform dispatch mapping is reused from the sibling skill, not duplicated.
  assertStringIncludes(md, "../ingrain-security/references/platform-dispatch.md");
});

Deno.test("SKILL.md: one verifier per adopted (selected) mitigation", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "per adopted mitigation");
  // Only `selected` mitigations are verified.
  assertStringIncludes(md, "selected");
});

Deno.test("SKILL.md: writes to the absolute assessment_abs, minted not hand-built", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "assessment_abs");
  // The verifier dispatch template must hand out the absolute path, never a relative one.
  assertStringIncludes(md, "<the minted assessment_abs — the ABSOLUTE path, pasted in full>");
  // The path is minted by the bundled script, and the relative form is display-only.
  assertStringIncludes(md, "scripts/assessment-path");
  assertStringIncludes(md, "mint");
  assertStringIncludes(md, "assessment_path");
  // Same deterministic branch+task file the planning review wrote.
  assertStringIncludes(md, ".ingrain-security/assessment-<branch-slug>-<task-slug>.md");
});

Deno.test("SKILL.md: verifies the working-tree diff and reuses the assessment schema", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Working-tree diff scope.
  assertStringIncludes(md, "git diff HEAD");
  assertStringIncludes(md, "git status");
  // Reuses the shared schema reference rather than redefining it.
  assertStringIncludes(md, "../ingrain-security/references/assessment-file.md");
});

Deno.test("SKILL.md: marks the assessment checked (Verified + Latest stage: review)", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "Latest stage: review");
  // The verdict enum the orchestrator records.
  for (const v of ["verified", "insufficient", "missing"]) assertStringIncludes(md, v);
});

Deno.test("SKILL.md: announces itself and reports to the coding agent (no user gates)", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "Using ingrain-security-test to verify the implemented mitigations.");
});

Deno.test("verifier ref: INTERNAL worker, read-only with a narrow read-only-git exception", async () => {
  const md = await Deno.readTextFile(VERIFIER_REF);
  const fm = parseFrontmatter(md);
  assertEquals(fm.name, "ingrain-mitigation-verifier");
  // Marked internal so it does not self-trigger.
  assertStringIncludes(md, "do NOT invoke");
  assertStringIncludes(md.toLowerCase(), "internal worker");
  // Read-only on the codebase, with read-only git to obtain the diff, and writes nothing.
  assertStringIncludes(md.toLowerCase(), "read-only");
  assertStringIncludes(md, "git diff HEAD");
  // Leads with the verdict word.
  for (const v of ["verified", "insufficient", "missing"]) assertStringIncludes(md, v);
});

Deno.test("assessment-file.md: defines the optional Verified column and its values", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The new column and its enumerated values.
  assertStringIncludes(md, "**Verified**");
  for (const v of ["verified", "insufficient", "missing"]) assertStringIncludes(md, v);
  // It is the ingrain-security-test skill that fills it, at the review stage.
  assertStringIncludes(md, "ingrain-security-test");
  assertStringIncludes(md, "Latest stage: review");
  // The Verified column is present in the template header.
  assertStringIncludes(md, "| Selection | Verified |");
});

/**
 * True when `script` really SOURCES `lib` — a `.` command line, in either style the scripts
 * use. Mirrors the helper in skill.test.ts: a plain substring search would be fooled by the
 * `# shellcheck source=…` directive that precedes every source line.
 */
async function sourcesLib(script: string, lib: string): Promise<boolean> {
  const source = new RegExp(String.raw`^(?:if !\s+)?\.\s+\S*lib/${lib}\.sh`, "m");
  return source.test(await Deno.readTextFile(script));
}

Deno.test("hook.json: Claude registers a Stop hook invoking verify-nudge", async () => {
  const hook = JSON.parse(await Deno.readTextFile(HOOK_JSON));
  const stop = hook.hooks?.Stop;
  assertEquals(Array.isArray(stop), true, "Stop must be registered");
  const serialized = JSON.stringify(stop);
  assertStringIncludes(serialized, "claude/verify-nudge");
  // The host token is passed, matching the other hooks.
  assertStringIncludes(serialized, "verify-nudge claude");
});

Deno.test("verify-nudge: sources the shared project-root lib and guards the nudge", async () => {
  assertEquals(
    await sourcesLib(VERIFY_NUDGE, "project-root"),
    true,
    "verify-nudge must source the project-root lib",
  );
  const src = await Deno.readTextFile(VERIFY_NUDGE);
  // Only nudges when there is an adopted mitigation not yet verified, on a dirty tree,
  // and respects the stop-loop guard.
  assertStringIncludes(src, "status --porcelain");
  assertStringIncludes(src, "Latest stage: review");
  assertStringIncludes(src, "stop_hook_active");
  // It nudges toward the verification skill.
  assertStringIncludes(src, "ingrain-security-test");
});

Deno.test("session-start: injects the Codex post-implementation verify nudge", async () => {
  const hook = await Deno.readTextFile(SESSION_START);
  // Codex has no turn-end event, so the SessionStart injection carries the nudge.
  assertStringIncludes(hook, "ingrain-security-test");
});

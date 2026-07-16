/**
 * Static checks on the ingrain-security Phase B (verification) pass and its hook wiring.
 * No model calls. Guards the verification contract: Phase B lives in a reference the
 * slim SKILL.md points at, reads the same per-task assessment file (by ABSOLUTE
 * assessment_abs), dispatches a read-only verifier subagent per adopted mitigation,
 * records a Verified status + advances the stage to review, and is reminded by a Stop
 * hook on both Claude and Codex.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parseFrontmatter } from "../lib/matchers.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL = `${ROOT}skills/ingrain-security/SKILL.md`;
const VERIFY = `${ROOT}skills/ingrain-security/references/verification-pass.md`;
const VERIFIER_REF = `${ROOT}skills/ingrain-security/references/ingrain-mitigation-verifier.md`;
const ASSESSMENT_REF = `${ROOT}skills/ingrain-security/references/assessment-file.md`;
const RULES_REF = `${ROOT}skills/ingrain-security/references/rules-file.md`;
const HOOK_JSON = `${ROOT}hooks/claude/hook.json`;
const CODEX_HOOK_JSON = `${ROOT}hooks/codex/hook.json`;
const VERIFY_CHECK = `${ROOT}hooks/claude/verify-check`;
const CODEX_VERIFY_CHECK = `${ROOT}hooks/codex/verify-check`;
const VERIFY_CHECK_LIB = `${ROOT}skills/ingrain-security/scripts/lib/verify-check.sh`;

Deno.test("SKILL.md: one skill, frontmatter name is ingrain-security", async () => {
  const fm = parseFrontmatter(await Deno.readTextFile(SKILL));
  assertEquals(fm.name, "ingrain-security");
});

Deno.test("SKILL.md: the description carries both phase triggers", async () => {
  const fm = parseFrontmatter(await Deno.readTextFile(SKILL));
  const description = String(fm.description);
  // Phase A: the planning trigger — before code.
  assertStringIncludes(description, "AS THE FINAL STEP of building an implementation plan");
  // Phase B: the verification trigger — after code.
  assertStringIncludes(description, "AFTER you have implemented code");
  assertStringIncludes(description, "before you present or commit it");
  // Both phases are labeled, and the description states they are mutually exclusive.
  assertStringIncludes(description, "Phase A");
  assertStringIncludes(description, "Phase B");
  assertStringIncludes(description, "The phases never overlap");
});

Deno.test("SKILL.md: routes to a phase from repo state, then points at the reference", async () => {
  const md = await Deno.readTextFile(SKILL);
  // The phase-select block runs before anything else.
  assertStringIncludes(md, "## Phase select — do this FIRST");
  // Phase B is a pointer section, not the procedure — the detail is read on demand.
  assertStringIncludes(md, "## Phase B — verification");
  assertStringIncludes(md, "Read `references/verification-pass.md` NOW and follow it.");
  // The three Phase B conditions, and the signals they are read from.
  assertStringIncludes(md, "file_exists");
  assertStringIncludes(md, "git status --porcelain");
  assertStringIncludes(md, "it is a pointer, not the procedure");
});

Deno.test("SKILL.md: the SUBAGENT-STOP block covers the verifier and both phases", async () => {
  const md = await Deno.readTextFile(SKILL);
  // The verifier reads the injected SKILL.md, observes a dirty tree, and must not recurse.
  assertStringIncludes(md, "ingrain-mitigation-verifier), do the one job you were given");
  assertStringIncludes(md, "neither Phase A nor Phase B");
});

Deno.test("verification-pass.md: dispatches the read-only verifier via its reference file", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // The one worker role and the read-reference dispatch mechanism.
  assertStringIncludes(md, "ingrain-mitigation-verifier");
  assertStringIncludes(md, "Read references/ingrain-mitigation-verifier.md");
  // The read-only constraint is restated for the dispatched subagent.
  assertStringIncludes(md.toLowerCase(), "read-only");
  // Now a sibling reference in the same skill — no cross-skill path survives the merge.
  assertStringIncludes(md, "references/platform-dispatch.md");
  assertEquals(md.includes("../ingrain-security/"), false, "cross-skill paths must be collapsed");
});

Deno.test("verification-pass.md: one verifier per adopted (selected) mitigation", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "per adopted mitigation");
  // Only `selected` mitigations are verified.
  assertStringIncludes(md, "selected");
});

Deno.test("verification-pass.md: writes to the absolute assessment_abs, minted not hand-built", async () => {
  const md = await Deno.readTextFile(VERIFY);
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

Deno.test("verification-pass.md: guards title drift, never falls back to Phase A", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // A drifted --title mints a different path; falling through to Phase A would re-run the
  // whole planning review on already-written code. This is the merge's sharpest edge.
  assertStringIncludes(md, "verbatim");
  assertStringIncludes(md, "Do **not** fall through to Phase A.");
});

Deno.test("verification-pass.md: verifies the working-tree diff and reuses the assessment schema", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // Working-tree diff scope.
  assertStringIncludes(md, "git diff HEAD");
  assertStringIncludes(md, "git status");
  // Reuses the shared schema reference rather than redefining it.
  assertStringIncludes(md, "references/assessment-file.md");
});

Deno.test("verification-pass.md: marks the assessment checked (Verified + Latest stage: review)", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "Latest stage: review");
  // The verdict enum the orchestrator records.
  for (const v of ["verified", "insufficient", "missing"]) assertStringIncludes(md, v);
  // The rules sidecar is a persistent planning artifact — Phase B must not delete it.
  assertStringIncludes(md, "do not modify or delete it");
});

Deno.test("verification-pass.md: reads org rules from the rules-*.md sidecar, no CLI", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // Rules come from the planning-written sidecar, minted with rules-path.
  assertStringIncludes(md, "rules-path");
  assertStringIncludes(md, "rules_abs");
  assertStringIncludes(md, "references/rules-file.md");
  // Existence is the signal; the Rule refs ids are the link into the sidecar.
  assertStringIncludes(md, "file_exists");
  assertStringIncludes(md, "Rule refs");
  // No CLI anywhere in the verification pass.
  assertEquals(md.includes("ingrain context"), false, "Phase B must not query the CLI");
  assertEquals(md.includes("ingrain --version"), false, "Phase B must not probe the CLI");
});

Deno.test("verification-pass.md: announces itself and reports to the coding agent (no user gates)", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "Using ingrain-security to verify the implemented mitigations.");
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

Deno.test("verifier ref: reads its rule descriptions from the sidecar, runs no CLI", async () => {
  const md = await Deno.readTextFile(VERIFIER_REF);
  // The org rule body is handed to the verifier by pointer via the rules-*.md sidecar.
  assertStringIncludes(md, "rules_abs");
  assertStringIncludes(md, "## Retrieved rules");
  // The mitigation Description stays the verification contract.
  assertStringIncludes(md, "Description");
  // The verifier gains no CLI — the orchestrator hands it the sidecar; it never queries.
  assertEquals(md.includes("ingrain context"), false, "verifier must not run the CLI");
});

Deno.test("assessment-file.md: defines the optional Verified column and its values", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The new column and its enumerated values.
  assertStringIncludes(md, "**Verified**");
  for (const v of ["verified", "insufficient", "missing"]) assertStringIncludes(md, v);
  // It is the Phase B verification that fills it, at the review stage.
  assertStringIncludes(md, "Phase B");
  assertStringIncludes(md, "Latest stage: review");
  // The Verified column is present in the template header.
  assertStringIncludes(md, "| Selection | Verified |");
  // Org rules now live in the linked sidecar, not a section of this file.
  assertStringIncludes(md, "references/rules-file.md");
  assertEquals(md.includes("## Org rules"), false, "the ## Org rules section moved to the sidecar");
});

Deno.test("rules-file.md: defines the persistent org-rules sidecar schema", async () => {
  const md = await Deno.readTextFile(RULES_REF);
  // Keyed by the same slug as the assessment, minted by rules-path.
  assertStringIncludes(md, "rules-<branch-slug>-<task-slug>.md");
  assertStringIncludes(md, "rules-path");
  // Its sections: retrieved rules (id/title/body) + per-mitigation mapping.
  assertStringIncludes(md, "## Retrieved rules");
  assertStringIncludes(md, "## Per-mitigation mapping");
  // It persists (not deleted) and is written only when rules were retrieved.
  assertStringIncludes(md.toLowerCase(), "persist");
  assertStringIncludes(md, "only when org rules are retrieved");
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

Deno.test("hook.json: Claude registers a Stop hook invoking verify-check", async () => {
  const hook = JSON.parse(await Deno.readTextFile(HOOK_JSON));
  const stop = hook.hooks?.Stop;
  assertEquals(Array.isArray(stop), true, "Stop must be registered");
  const serialized = JSON.stringify(stop);
  assertStringIncludes(serialized, "claude/verify-check");
  // The host token is passed, matching the other hooks.
  assertStringIncludes(serialized, "verify-check claude");
});

Deno.test("hook.json: Codex registers a Stop hook invoking verify-check", async () => {
  const hook = JSON.parse(await Deno.readTextFile(CODEX_HOOK_JSON));
  const stop = hook.hooks?.Stop;
  assertEquals(Array.isArray(stop), true, "Codex Stop must be registered");
  const serialized = JSON.stringify(stop);
  assertStringIncludes(serialized, "codex/verify-check");
  // The host token is passed, matching the other Codex hooks.
  assertStringIncludes(serialized, "verify-check codex");
});

Deno.test("verify-check: both host wrappers source the shared libs and guard the loop", async () => {
  // The guard decision lives once in lib/verify-check.sh; each host wrapper sources it
  // (plus project-root.sh) so the two hosts cannot drift apart on when they remind.
  for (const hook of [VERIFY_CHECK, CODEX_VERIFY_CHECK]) {
    assertEquals(await sourcesLib(hook, "project-root"), true, `${hook} must source project-root`);
    assertEquals(await sourcesLib(hook, "verify-check"), true, `${hook} must source verify-check`);
    const src = await Deno.readTextFile(hook);
    // The stop-loop guard and the Stop JSON stay in the wrapper (it owns stdin + output).
    assertStringIncludes(src, "stop_hook_active");
    assertStringIncludes(src, '"decision": "block"');
    assertStringIncludes(src, "verify_check_reason");
  }
  // The reminder condition (dirty tree + not-yet-verified adopted mitigation) lives in the lib.
  const lib = await Deno.readTextFile(VERIFY_CHECK_LIB);
  assertStringIncludes(lib, "status --porcelain");
  assertStringIncludes(lib, "Latest stage: review");
  // The reminder names the surviving skill and doubles as the explicit Phase B override,
  // so the auto-invoked path never depends on title-keyed phase detection.
  assertStringIncludes(lib, "run the 'ingrain-security' skill");
  assertStringIncludes(lib, "Phase B verification request");
});

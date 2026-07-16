/**
 * Static checks on the ingrain-security Phase B (verification) pass and its hook wiring.
 * No model calls. Guards the verification contract: Phase B lives in a reference the
 * slim SKILL.md points at, reads the same per-task assessment file (by ABSOLUTE
 * assessment_abs), dispatches an INFORMED read-only verifier per adopted mitigation plus
 * exactly one BLIND reviewer that sees only the diff, reconciles the two by weighing their
 * justifications, and records a Justification + Verification level + advances the stage to
 * review. Phase B has no Stop-hook reminder: it runs on the skill's description or an
 * explicit request, and the tail of this file guards that the hook stays removed.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  assertChecklistTracksFlow,
  assertOrder,
  parseFrontmatter,
  section,
} from "../lib/matchers.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL = `${ROOT}skills/ingrain-security/SKILL.md`;
const VERIFY = `${ROOT}skills/ingrain-security/references/verification-pass.md`;
const VERIFIER_REF = `${ROOT}skills/ingrain-security/references/ingrain-mitigation-verifier.md`;
const BLIND_REF = `${ROOT}skills/ingrain-security/references/ingrain-blind-maturity-reviewer.md`;

/**
 * The contents of every fenced code block in `md`, joined. In a dispatch section that is the
 * prompt text the orchestrator pastes to the subagent — as opposed to the prose around it,
 * which addresses the orchestrator instead and may legitimately name what NOT to hand over.
 */
const fencedBlock = (md: string): string =>
  [...md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
const ASSESSMENT_REF = `${ROOT}skills/ingrain-security/references/assessment-file.md`;
const RULES_REF = `${ROOT}skills/ingrain-security/references/rules-file.md`;
const HOOK_JSON = `${ROOT}hooks/claude/hook.json`;
const CODEX_HOOK_JSON = `${ROOT}hooks/codex/hook.json`;

/** Phase B carries the same flow/checklist split as Phase A — see skill.test.ts. */
Deno.test("verification-pass.md: the Phase B checklist tracks every step in the flow", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertChecklistTracksFlow(md, "## Phase B — the flow", "## Phase B — checklist");
});

Deno.test("verification-pass.md: the flow holds no checkboxes", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertEquals(
    section(md, "## Phase B — the flow").includes("- [ ]"),
    false,
    "The flow contains checkboxes. The flow is the procedure; the checklist tracks it.",
  );
});

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

Deno.test("SKILL.md: the SUBAGENT-STOP block covers both Phase B reads and both phases", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Both Phase B workers read the injected SKILL.md, observe a dirty tree, and must not recurse.
  assertStringIncludes(md, "ingrain-mitigation-verifier,");
  assertStringIncludes(
    md,
    "ingrain-blind-maturity-reviewer), do the one job you were given",
  );
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

Deno.test("verification-pass.md: marks the assessment checked (Verification level + Latest stage: review)", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "Latest stage: review");
  // The two columns the orchestrator records, and the maturity enum it picks from.
  assertStringIncludes(md, "Verification level");
  assertStringIncludes(md, "Justification");
  for (const v of ["`fail`", "`accepted`", "`high`"]) assertStringIncludes(md, v);
  // The old verdict enum is gone from the schema. Note this pins the ENUM, not the bare
  // words: the prose and the report's Gap column still legitimately say "insufficient".
  assertEquals(
    md.includes("`verified` | `insufficient` | `missing`"),
    false,
    "the old verdict enum must be gone",
  );
  assertEquals(md.includes("**`Verified`**"), false, "the Verified column is renamed");
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
  // Grades on the maturity ladder, and leads with the JUSTIFICATION — not the level. The
  // order is the point: a level written first is one the justification then argues for.
  for (const v of ["`fail`", "`accepted`", "`high`"]) assertStringIncludes(md, v);
  assertOrder(md, "JUSTIFICATION", "LEVEL", "the verifier leads with its justification");
});

Deno.test("verification-pass.md: defines the three maturity levels", async () => {
  const s = section(await Deno.readTextFile(VERIFY), "## Maturity levels");
  for (const v of ["`fail`", "`accepted`", "`high`"]) assertStringIncludes(s, v);
  // `fail` subsumes both old verdicts; the split survives only in the report's Gap column.
  assertStringIncludes(s.toLowerCase(), "not sufficiently implemented");
  // `high` is `accepted` PLUS artefacts — not a synonym for "well implemented".
  assertStringIncludes(s.toLowerCase(), "artefact");
  assertStringIncludes(s.toLowerCase(), "test");
});

Deno.test("verification-pass.md: dispatches both reads — informed per mitigation, one blind", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "Read references/ingrain-blind-maturity-reviewer.md");
  assertStringIncludes(md, "per adopted mitigation");
  // The prompt the orchestrator actually pastes names neither minted path — that is what
  // makes the read blind. Assert on the fenced block alone, not the whole section: the
  // surrounding prose names both paths deliberately, to say which values NOT to pass.
  const prompt = fencedBlock(section(md, "## How to dispatch the blind reviewer"));
  for (const leak of ["assessment_abs", "rules_abs"]) {
    assertEquals(prompt.includes(leak), false, `the blind dispatch prompt must not carry ${leak}`);
  }
  // The task title is the one thing it IS given.
  assertStringIncludes(prompt, "The task is titled");
  // The informed dispatch is the contrast: its prompt DOES hand over both paths. Without
  // this, the assertion above would still pass if the fence were empty or misparsed.
  const informed = fencedBlock(section(md, "## How to dispatch a verifier"));
  for (const needed of ["assessment_abs", "rules_abs"]) {
    assertStringIncludes(informed, needed);
  }
});

Deno.test("verification-pass.md: reconciliation weighs justifications, informed is the prior", async () => {
  const s = section(await Deno.readTextFile(VERIFY), "## Reconciling the two reads");
  const lower = s.toLowerCase();
  // Justifications are read and weighed BEFORE the levels — never a mechanical word-compare.
  assertOrder(lower, "justification", "level", "justifications are weighed before the levels");
  assertStringIncludes(lower, "do not compare");
  // The informed read is the prior; blind moves a level only on better `file:line` evidence.
  assertStringIncludes(lower, "prior");
  assertStringIncludes(s, "file:line");
  // Blind silence is not evidence of absence.
  assertStringIncludes(lower, "never lowers a level");
  // The conclusion — and the Justification — are the orchestrator's own.
  assertStringIncludes(lower, "your own");
  // Unmapped blind findings get a home, and it is not the Gate-2 mitigation table.
  assertStringIncludes(s, "## Coverage / open items");
});

Deno.test("blind reviewer ref: INTERNAL worker, read-only, writes nothing", async () => {
  const md = await Deno.readTextFile(BLIND_REF);
  const fm = parseFrontmatter(md);
  assertEquals(fm.name, "ingrain-blind-maturity-reviewer");
  assertStringIncludes(String(fm.description), "INTERNAL");
  // Marked internal so it does not self-trigger.
  assertStringIncludes(md, "do NOT invoke");
  assertStringIncludes(md.toLowerCase(), "internal worker");
  assertStringIncludes(md, "do not run the orchestration");
  // Read-only, with the same narrow read-only-git exception, and it writes NOTHING at all —
  // unlike a Phase A worker, it has no section of its own.
  assertStringIncludes(md.toLowerCase(), "read-only");
  assertStringIncludes(md, "Read, Grep, and Glob");
  assertStringIncludes(md, "git diff HEAD");
  assertStringIncludes(md.toLowerCase(), "write nothing");
  assertStringIncludes(md, "Recommended model:");
  // Same ladder as the informed read, and the same justification-first contract.
  for (const v of ["fail", "accepted", "high"]) assertStringIncludes(md, v);
  assertOrder(md, "JUSTIFICATION", "LEVEL", "the blind reviewer leads with its justification");
});

Deno.test("blind reviewer ref: is actually blind — no assessment, mitigations, or rules", async () => {
  const md = await Deno.readTextFile(BLIND_REF);
  // The whole value of the second read is that it never saw the analysis: handed a pointer to
  // the assessment or the sidecar it would confirm what it was told to expect, and agreement
  // for that reason is worth nothing. This assertion is the only thing enforcing the design.
  for (const leak of ["assessment_abs", "rules_abs", "Selection", "Rule refs", "Threat tags"]) {
    assertEquals(md.includes(leak), false, `the blind reviewer must never be given ${leak}`);
  }
  // It is given exactly two things.
  assertStringIncludes(md, "task title");
  assertStringIncludes(md, "working-tree diff");
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

Deno.test("assessment-file.md: defines the Justification + Verification level columns", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The two columns and the maturity enum.
  assertStringIncludes(md, "**Verification level**");
  assertStringIncludes(md, "**Justification**");
  for (const v of ["`fail`", "`accepted`", "`high`"]) assertStringIncludes(md, v);
  assertEquals(md.includes("**Verified**"), false, "the Verified column is renamed");
  // It is the Phase B verification that fills them, at the review stage.
  assertStringIncludes(md, "Phase B");
  assertStringIncludes(md, "Latest stage: review");
  // One string pins all three at once: the rename, the addition, and the ordering —
  // Justification sits immediately BEFORE the level so reasoning drives the conclusion.
  assertStringIncludes(md, "| Selection | Justification | Verification level |");
  assertStringIncludes(md, "Justification leads the Verification level on purpose");
  // Both Justifications in the file (Threats + Mitigations) carry the same 256-char cap.
  assertEquals(
    [...md.matchAll(/≤ 256 characters/g)].length,
    2,
    "both Justification columns must be capped at 256 characters",
  );
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
 * The Stop-hook reminder was removed: Phase B is no longer nudged at the turn boundary, and
 * `verify-check` (both host wrappers + the shared decision lib) is gone with it. Phase B now
 * runs on the skill's own description or an explicit request.
 *
 * This guards the removal in both directions. A Stop entry that reappears would fire a hook
 * whose script no longer exists — failing on every turn end, on a file nobody would think to
 * look at — so the registration and the scripts have to stay gone together.
 */
Deno.test("hook.json: neither host registers a Stop hook", async () => {
  for (const [host, path] of [["Claude", HOOK_JSON], ["Codex", CODEX_HOOK_JSON]] as const) {
    const hook = JSON.parse(await Deno.readTextFile(path));
    assertEquals(hook.hooks?.Stop, undefined, `${host} must not register a Stop hook`);
    assertEquals(
      JSON.stringify(hook).includes("verify-check"),
      false,
      `${host} must not reference the removed verify-check script`,
    );
  }
});

Deno.test("verify-check: the scripts and shared lib are gone", async () => {
  const removed = [
    "hooks/claude/verify-check",
    "hooks/codex/verify-check",
    "skills/ingrain-security/scripts/lib/verify-check.sh",
  ];
  for (const rel of removed) {
    const exists = await Deno.stat(`${ROOT}${rel}`).then(() => true, () => false);
    assertEquals(exists, false, `${rel} was removed with the Stop hook and must not return`);
  }
});

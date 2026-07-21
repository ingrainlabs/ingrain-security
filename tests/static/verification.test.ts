/**
 * Static checks on the ingrain-security Testing (verification) pass and its hook wiring.
 * No model calls. Guards the verification contract: Testing lives in a reference the
 * slim SKILL.md points at, reads the same per-task assessment file (by ABSOLUTE
 * assessment_abs), dispatches a read-only verifier per adopted mitigation, concludes each level
 * itself by weighing that verifier's justification on its evidence, and records a
 * Justification + Robustness + advances the stage to
 * review. Testing has no Stop-hook reminder: it runs on the skill's description or an
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
const VERIFY = `${ROOT}skills/ingrain-security/references/testing/verification-pass.md`;
const VERIFIER_REF = `${ROOT}skills/ingrain-security/references/testing/ingrain-threat-verifier.md`;

/**
 * The contents of every fenced code block in `md`, joined. In a dispatch section that is the
 * prompt text the orchestrator pastes to the subagent — as opposed to the prose around it,
 * which addresses the orchestrator instead and may legitimately name what NOT to hand over.
 */
const fencedBlock = (md: string): string =>
  [...md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
const ASSESSMENT_REF = `${ROOT}skills/ingrain-security/references/formatting/assessment-file.md`;
const RULES_REF = `${ROOT}skills/ingrain-security/references/formatting/rules-file.md`;
const HOOK_JSON = `${ROOT}hooks/claude/hook.json`;
const CODEX_HOOK_JSON = `${ROOT}hooks/codex/hook.json`;

/** Testing carries the same flow/checklist split as Development — see skill.test.ts. */
Deno.test("verification-pass.md: the Testing checklist tracks every step in the flow", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertChecklistTracksFlow(md, "## Testing — the flow", "## Testing — checklist");
});

Deno.test("verification-pass.md: the flow holds no checkboxes", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertEquals(
    section(md, "## Testing — the flow").includes("- [ ]"),
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
  // Development: the planning trigger — before code.
  assertStringIncludes(description, "AS THE FINAL STEP of building an implementation plan");
  // Testing: the verification trigger — after code.
  assertStringIncludes(description, "AFTER you have implemented code");
  assertStringIncludes(description, "before you present or commit it");
  // Both phases are labeled, and the description states they are mutually exclusive.
  assertStringIncludes(description, "Development");
  assertStringIncludes(description, "Testing");
  assertStringIncludes(description, "Each phase owns one moment");
});

Deno.test("SKILL.md: routes to a phase from repo state, then points at the reference", async () => {
  const md = await Deno.readTextFile(SKILL);
  // The phase-select block runs before anything else.
  assertStringIncludes(md, "## Phase select — do this FIRST");
  // Testing is a pointer section, not the procedure — the detail is read on demand.
  assertStringIncludes(md, "## Testing — verification");
  assertStringIncludes(md, "Read `references/testing/verification-pass.md` NOW and follow it.");
  // The three Testing conditions, and the signals they are read from. The third is the BRANCH
  // DELTA, not the working tree: a fully-committed implementation must still route to Testing.
  assertStringIncludes(md, "file_exists");
  assertStringIncludes(md, "scripts/branch-diff");
  assertStringIncludes(md, "delta_empty");
  assertStringIncludes(md, "this section is a pointer, and the procedure is in that file");
});

Deno.test("SKILL.md: the SUBAGENT-STOP block covers the Testing read and both phases", async () => {
  const md = await Deno.readTextFile(SKILL);
  // The Testing worker reads the injected SKILL.md, sees a non-empty branch delta, and must not
  // recurse into the orchestration it is part of.
  assertStringIncludes(md, "ingrain-threat-verifier), do the one job you were given");
  assertStringIncludes(md, "neither Development nor Testing");
});

Deno.test("verification-pass.md: dispatches the read-only verifier via its reference file", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // The one worker role and the read-reference dispatch mechanism.
  assertStringIncludes(md, "ingrain-threat-verifier");
  assertStringIncludes(md, "Read references/testing/ingrain-threat-verifier.md");
  // The read-only constraint is restated for the dispatched subagent.
  assertStringIncludes(md.toLowerCase(), "read-only");
  // Now a sibling reference in the same skill — no cross-skill path survives the merge.
  assertStringIncludes(md, "references/development/dispatch.md");
  // The verifier's own contract is stated here, not reached for across the phase boundary.
  assertStringIncludes(md, "It writes nothing at all");
  assertEquals(md.includes("../ingrain-security/"), false, "cross-skill paths must be collapsed");
  // The prompt the orchestrator actually pastes hands the verifier both minted paths — the
  // mitigation to verify and the org rules behind it. Assert on the fenced block alone: the
  // surrounding prose addresses the orchestrator, not the subagent.
  const prompt = fencedBlock(section(md, "## How to dispatch a verifier"));
  for (const needed of ["assessment_abs", "rules_abs"]) {
    assertStringIncludes(prompt, needed);
  }
});

Deno.test("verification-pass.md: one verifier per selected threat", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "per selected threat");
  // Threats define the scope; only `selected` ones are tested.
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
  // Same deterministic branch+task file the plan review wrote.
  assertStringIncludes(md, ".ingrain-security/assessment-<branch-slug>-<task-slug>.md");
});

Deno.test("verification-pass.md: validates its one write against the schema, strictly", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // Testing writes the assessment once, and that write is a FINISHED file — so it runs the
  // validator without --lenient. Losing this leaves the last write of the whole lifecycle
  // unchecked, in the session that hands the file to everyone downstream.
  assertStringIncludes(md, "scripts/validate-assessment");
  assertStringIncludes(md, "no `--lenient`");
  // The contract itself belongs to the schema reference; this file points at it.
  assertStringIncludes(md, "references/formatting/assessment-file.md");
  // And the checklist tracks it, like every other step-6 obligation.
  assertStringIncludes(md, "validated clean by `scripts/validate-assessment` with NO `--lenient`");
});

Deno.test("verification-pass.md: guards title drift, never falls back to Development", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // A drifted --title mints a different path; falling through to Development would re-run the
  // whole planning review on already-written code. This is the merge's sharpest edge.
  assertStringIncludes(md, "verbatim");
  assertStringIncludes(md, "Do **not** fall through to Development.");
});

Deno.test("verification-pass.md: verifies the branch diff since the fork point and reuses the assessment schema", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // The diff basis is the fork point — committed work included, not just the dirty tree — and it
  // is resolved by the bundled script, so the gate and the review cannot drift apart.
  assertStringIncludes(md, "scripts/branch-diff");
  assertStringIncludes(md, "diff_ref");
  assertStringIncludes(md, "git diff <diff_ref>");
  assertStringIncludes(md, "git status");
  // HEAD survives only as the documented fallback, and must stay documented.
  assertStringIncludes(md, "git diff HEAD");
  assertStringIncludes(md, "only as the fallback");
  // Reuses the shared schema reference rather than redefining it.
  assertStringIncludes(md, "references/formatting/assessment-file.md");
});

Deno.test("verification-pass.md: marks the assessment checked (Robustness + Latest stage: testing)", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "Latest stage: testing");
  // The two columns the orchestrator records, and the enum it picks from.
  assertStringIncludes(md, "Robustness");
  assertStringIncludes(md, "Justification");
  for (const v of ["`weak`", "`adequate`", "`strong`"]) assertStringIncludes(md, v);
  // One concept, one name: `Verification level` was folded into `Robustness` because the
  // mitigation column holds the same measure, carried across from the threats it covers.
  assertEquals(md.includes("Verification level"), false, "one name for the concept: Robustness");
  // The old verdict enum is gone from the schema. Note this pins the ENUM, not the bare
  // words: the prose and the report's Gap column still legitimately say "insufficient".
  assertEquals(
    md.includes("`verified` | `insufficient` | `missing`"),
    false,
    "the old verdict enum must be gone",
  );
  assertEquals(md.includes("**`Verified`**"), false, "the Verified column is renamed");
  // The rules sidecar is a persistent planning artifact — Testing must not delete it.
  assertStringIncludes(md, "do not modify or delete it");
});

Deno.test("verification-pass.md: reads org rules from the rules-*.md sidecar, no CLI", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // Rules come from the planning-written sidecar, minted with rules-path.
  assertStringIncludes(md, "rules-path");
  assertStringIncludes(md, "rules_abs");
  assertStringIncludes(md, "references/formatting/rules-file.md");
  // Existence is the signal; the Rule refs ids are the link into the sidecar.
  assertStringIncludes(md, "file_exists");
  assertStringIncludes(md, "Rule refs");
  // No CLI anywhere in the verification pass.
  assertEquals(md.includes("ingrain context"), false, "Testing must not query the CLI");
  assertEquals(md.includes("ingrain --version"), false, "Testing must not probe the CLI");
});

Deno.test("verification-pass.md: announces itself and reports to the coding agent (no user gates)", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "Using ingrain-security to verify the implemented mitigations.");
});

Deno.test("verifier ref: INTERNAL worker, read-only with a narrow read-only-git exception on the branch diff", async () => {
  const md = await Deno.readTextFile(VERIFIER_REF);
  const fm = parseFrontmatter(md);
  assertEquals(fm.name, "ingrain-threat-verifier");
  // Marked internal so it does not self-trigger.
  assertStringIncludes(md, "do NOT invoke");
  assertStringIncludes(md.toLowerCase(), "internal worker");
  // Read-only on the codebase, with read-only git to obtain the diff, and writes nothing.
  assertStringIncludes(md.toLowerCase(), "read-only");
  // The verifier is HANDED the ref by the orchestrator — it never re-derives it, and must not
  // fall back to HEAD, which would hide the committed implementation.
  assertStringIncludes(md, "git diff <diff_ref>");
  assertStringIncludes(md, "do not substitute `HEAD` for it");
  // Grades on the Robustness ladder, and leads with the JUSTIFICATION — not the level. The
  // order is the point: a level written first is one the justification then argues for.
  for (const v of ["`weak`", "`adequate`", "`strong`"]) assertStringIncludes(md, v);
  assertOrder(md, "JUSTIFICATION", "LEVEL", "the verifier leads with its justification");
});

Deno.test("verification-pass.md: defines the three Robustness levels", async () => {
  const s = section(await Deno.readTextFile(VERIFY), "## Robustness levels");
  // The ladder is named by the column that carries it, not by a bare "level".
  assertStringIncludes(s, "**Robustness**");
  for (const v of ["`weak`", "`adequate`", "`strong`"]) assertStringIncludes(s, v);
  // The ladder is negative testing: `weak` means the threat survives the change.
  assertStringIncludes(s.toLowerCase(), "can still be realized");
  // `strong` is `adequate` PLUS artefacts — not a synonym for "well implemented".
  assertStringIncludes(s.toLowerCase(), "artefact");
  assertStringIncludes(s.toLowerCase(), "test");
});

Deno.test("verification-pass.md: the Robustness is concluded from the justification's evidence", async () => {
  const s = section(await Deno.readTextFile(VERIFY), "## Concluding the Robustness");
  const lower = s.toLowerCase();
  // The justification is read and weighed BEFORE the level — the level is re-derived, not
  // forwarded from the verifier.
  assertOrder(lower, "justification", "level", "the justification is weighed before the level");
  assertStringIncludes(s, "file:line");
  // The conclusion — and the Justification — are the orchestrator's own.
  assertStringIncludes(lower, "your own");
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

Deno.test("assessment-file.md: defines the Justification + Robustness columns", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The two columns and the enum.
  assertStringIncludes(md, "**Robustness**");
  assertStringIncludes(md, "**Justification**");
  for (const v of ["`weak`", "`adequate`", "`strong`"]) assertStringIncludes(md, v);
  assertEquals(md.includes("**Verified**"), false, "the Verified column is renamed");
  // One concept, one name. `Robustness` names the same measure in both tables: the threat
  // column is the primary result, the mitigation column carries it across (weakest governs).
  assertEquals(md.includes("Verification level"), false, "one name for the concept: Robustness");
  // It is the Testing verification pass that fills them, after the code is written.
  assertStringIncludes(md, "Testing");
  assertStringIncludes(md, "Latest stage: testing");
  // One string pins all three at once: the rename, the addition, and the ordering —
  // Justification sits immediately BEFORE the level so reasoning drives the conclusion.
  assertStringIncludes(md, "| Selection | Justification | Robustness |");
  assertStringIncludes(md, "Justification leads the Robustness on purpose");
  // Both Justifications in the file (Threats + Mitigations) carry the same 256-char cap.
  assertEquals(
    [...md.matchAll(/≤ 256 characters/g)].length,
    2,
    "both Justification columns must be capped at 256 characters",
  );
  // Org rules now live in the linked sidecar, not a section of this file.
  assertStringIncludes(md, "references/formatting/rules-file.md");
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
  // It persists past finalize. The minter seeds an empty skeleton, so it is the CONTENT
  // that is conditional — the file carries rules exactly when a pass retrieved them.
  assertStringIncludes(md.toLowerCase(), "persist");
  assertStringIncludes(md, "Filled when org rules are retrieved");
  assertStringIncludes(md, "skeleton");
});

/**
 * The Stop-hook reminder was removed: Testing is no longer nudged at the turn boundary, and
 * `verify-check` (both host wrappers + the shared decision lib) is gone with it. Testing now
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

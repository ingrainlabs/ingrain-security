/**
 * Static checks on the skill and hook wiring. No model calls. Guards the
 * workflow contract the live tests rely on: the strict step order, the two
 * announce/stop phrases, references to all 7 workers, and a valid SessionStart
 * hook that injects the skill.
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
const ASSESSMENT_REF = `${ROOT}skills/ingrain-security/references/formatting/assessment-file.md`;
const TRIAGE_REF =
  `${ROOT}skills/ingrain-security/references/development/ingrain-relevance-triage.md`;
const DISPATCH_REF = `${ROOT}skills/ingrain-security/references/development/dispatch.md`;
const HOOK_JSON = `${ROOT}hooks/claude/hook.json`;
const CODEX_HOOK_JSON = `${ROOT}hooks/codex/hook.json`;
const SESSION_START = `${ROOT}hooks/start/session-start`;
const ALLOW_HOOK = `${ROOT}hooks/claude/allow-assessment-write`;
const CODEX_ALLOW_HOOK = `${ROOT}hooks/codex/allow-assessment-write`;
const ALLOW_LIB = `${ROOT}skills/ingrain-security/scripts/lib/assessment-write.sh`;
const ENSURE_DIR = `${ROOT}hooks/start/ensure-assessment-dir`;
const PROJECT_ROOT_LIB = `${ROOT}skills/ingrain-security/scripts/lib/project-root.sh`;
const PATH_SCRIPT = `${ROOT}skills/ingrain-security/scripts/assessment-path`;
const MINT_LIB = `${ROOT}skills/ingrain-security/scripts/lib/mint-path.sh`;
const TEMPLATE_LIB = `${ROOT}skills/ingrain-security/scripts/lib/artifact-template.sh`;

const WORKERS = [
  "ingrain-relevance-triage",
  "ingrain-threat-generator",
  "ingrain-threat-critic",
  "ingrain-risk-scorer",
  "ingrain-mitigation-generator",
  "ingrain-mitigation-critic",
];

Deno.test("SKILL.md: frontmatter name is ingrain-security", async () => {
  const fm = parseFrontmatter(await Deno.readTextFile(SKILL));
  assertEquals(fm.name, "ingrain-security");
});

Deno.test("SKILL.md: references all six workers", async () => {
  const md = await Deno.readTextFile(SKILL);
  for (const w of WORKERS) assertStringIncludes(md, w);
});

Deno.test("SKILL.md: workflow steps are in the required order", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertOrder(md, "ingrain-relevance-triage", "ingrain-threat-generator", "triage before threats");
  assertOrder(md, "ingrain-threat-generator", "ingrain-threat-critic", "generate before critique");
  assertOrder(md, "ingrain-threat-critic", "ingrain-risk-scorer", "critique/freeze before scoring");
  assertOrder(md, "ingrain-risk-scorer", "ingrain-mitigation-generator", "score before mitigation");
  assertOrder(
    md,
    "ingrain-mitigation-generator",
    "ingrain-mitigation-critic",
    "mitigate before critique",
  );
});

/**
 * Flow and checklist are separate entities: the flow is the detailed procedure, the checklist
 * is a terse tracker at the end enforcing that its steps were followed. Keeping them distinct
 * is the point — a checklist that grows prose stops being scannable and stops being a tracker.
 */
Deno.test("SKILL.md: the Development checklist tracks every step in the flow", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertChecklistTracksFlow(md, "## Development — the flow", "## Development — checklist");
});

Deno.test("SKILL.md: the flow holds no checkboxes and the checklist stays terse", async () => {
  const md = await Deno.readTextFile(SKILL);
  // The detailed procedure must not wear checkboxes — that conflates the two entities.
  assertEquals(
    section(md, "## Development — the flow").includes("- [ ]"),
    false,
    "The flow contains checkboxes. The flow is the procedure; the checklist tracks it.",
  );
  // Every checklist item is ONE line. A caveat that needs a second line belongs in the flow.
  for (const line of section(md, "## Development — checklist").split("\n")) {
    if (!line.startsWith("- [ ] ")) continue;
    assertEquals(
      line.length <= 160,
      true,
      `Checklist line is too long to scan — move the detail into the flow:\n${line}`,
    );
  }
});

Deno.test("SKILL.md: both gate checklist lines fence table-before-windows", async () => {
  const list = section(await Deno.readTextFile(SKILL), "## Development — checklist");
  // The most-guarded behavior in the skill: the findings table is displayed BEFORE any
  // selection window. The checklist is where that ordering is enforced.
  for (const gate of list.split("\n").filter((l) => l.includes("Gate "))) {
    assertEquals(
      gate.indexOf("table") < gate.indexOf("window") && gate.includes("table"),
      true,
      `Gate checklist line must put the table before the windows:\n${gate}`,
    );
  }
});

Deno.test("SKILL.md: contains the announce and minor-stop phrases", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "Using ingrain-security to assess this plan.");
  assertStringIncludes(md, "no security review needed — minor change");
});

Deno.test("SKILL.md: documents the read-reference dispatch mechanism", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Generic-subagent dispatch reads each worker's reference file by path.
  assertStringIncludes(md, "Read references/development/<name>.md");
  // Cross-platform mapping lives in the reference doc.
  assertStringIncludes(md, "references/development/dispatch.md");
  // The per-run write target is restated inline for the dispatched subagents — it is the
  // one thing a worker cannot learn from its own reference file.
  assertStringIncludes(
    md,
    "Your ONE permitted write is your own section of the stored analysis file",
  );
});

// SKILL.md is an orchestration spine: it owns SEQUENCE and ROUTING, the reference files own
// DETAIL. So the assessment file's *schema and semantics* are asserted against their owner
// (assessment-file.md) and only the orchestrator's *action* — mint it, use the absolute form,
// go read the reference — is fenced here. A restatement creeping back into SKILL.md is the
// regression these two tests are split to prevent.

Deno.test("SKILL.md: mints the assessment path and defers its schema to the reference", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, ".ingrain-security/assessment-<branch-slug>-<task-slug>.md");
  // The host-root variable is still defined (used for the plan-file path).
  assertStringIncludes(md, "${coding_agent_root}");
  // The file's schema/template is defined in a dedicated reference file, and SKILL.md points
  // at it rather than restating it.
  assertStringIncludes(md, "references/formatting/assessment-file.md");
  // The path is minted by the bundled script (mint), not hand-built.
  assertStringIncludes(md, "scripts/assessment-path");
  assertStringIncludes(md, "mint");
  assertStringIncludes(md, "assessment_path");
});

/**
 * The field cards. The skeleton the minter seeds carries a comment under every heading naming
 * that section's fields, their order and their exact values — so a writer takes the shape from
 * the file it must open anyway, instead of paying a full read of the 345-line schema reference.
 * That saving is the whole point of the design, and it survives only while three things hold:
 * the template renders the cards, the skill points writers at them, and the reference stays the
 * owner of what a field MEANS. Losing any one of them puts the mandatory read straight back.
 */
Deno.test("field cards: the skeleton renders one under every value-bearing section", async () => {
  const sh = await Deno.readTextFile(TEMPLATE_LIB);
  // Every section a writer fills carries a card. Task/Triage/Risk score already showed their
  // labels; these two showed nothing at all before the cards, and hold every enum.
  assertStringIncludes(sh, "## Threats\n<!--");
  assertStringIncludes(sh, "## Mitigations\n<!--");
  // The enumerated values live IN the card — that is what removes the reference read.
  for (
    const v of [
      "critical|high|medium|low", // Impact
      "very high|high|medium|low", // Likelihood
      "selected|excluded|undecided", // Selection
      "weak|adequate|strong", // Robustness
      "development|testing", // Latest stage
      "minor|major", // Triage verdict
    ]
  ) {
    assertStringIncludes(sh, v);
  }
  // The sidecar's two sections are carded too — the mitigation generator writes both files.
  assertStringIncludes(sh, "## Retrieved rules\n<!--");
  assertStringIncludes(sh, "## Per-mitigation mapping\n<!--");
  // Permanent, not scratch: finalize deletes the critique sections and keeps these, because the
  // implementing agent and the Testing pass run in later sessions with no reference in context.
  assertStringIncludes(sh.toLowerCase(), "permanent");
});

Deno.test("field cards: SKILL.md sends writers to the card, not to the schema", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "field card");
  // The dispatch is where a worker learns the contract — it must name the card, since the
  // worker has no other cheap route to the shape.
  assertStringIncludes(md, "written to the field card");
  // And the reference read is explicitly demoted to a meaning lookup. A skill that stops
  // saying this silently goes back to a full schema read per worker.
  assertStringIncludes(md, "only if you need what a field MEANS");
  // SKILL.md still names NO enum value — the card owns the shape, the reference the meaning.
  for (const v of ["very high", "weak|adequate|strong"]) {
    assertEquals(
      md.includes(v),
      false,
      `SKILL.md restates the enum "${v}". The field card carries the values; the spine points at it.`,
    );
  }
});

/**
 * The check that replaced "read it back against the schema": three named things, run on reads
 * the skill already makes (the two gate slices and finalize) rather than on a read of its own.
 * Vague wording here is what made the old instruction cost a 345-line re-read or get skipped.
 */
Deno.test("field cards: the three-check is named, bounded, and rides on existing reads", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "three-check");
  assertStringIncludes(md, "never by re-reading the schema");
  // Its cadence: both gates and finalize, on reads those steps already make.
  assertStringIncludes(md, "It costs no read of its own");
  assertStringIncludes(md, "at both gates and at finalize");
  // Both gate steps run it on the bounded slice they already read.
  for (const gate of ["## Threats` slice", "## Mitigations` slice"]) {
    assertStringIncludes(md, gate);
  }
});

Deno.test("assessment-file.md: owns the meaning, and stays in step with the cards", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The ownership split, stated by the owner: cards carry shape, this file carries meaning.
  assertStringIncludes(md, "field card");
  assertStringIncludes(md.toLowerCase(), "normative");
  // Three copies of the shape now exist, so the reference carries the anti-drift rule and
  // names the renderer. Without this the card and the schema part ways on the next edit.
  assertStringIncludes(md, "scripts/lib/artifact-template.sh");
  assertStringIncludes(md, "in the same edit");
});

Deno.test("assessment-file.md: owns the living-document behavior", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The file is written/updated as a living document — stated by its owner, not by SKILL.md.
  assertStringIncludes(md.toLowerCase(), "living document");
});

Deno.test("assessment-file.md: defines the strict on-disk format and its allowed values", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The single in-repo artifact path.
  assertStringIncludes(md, ".ingrain-security/assessment-<branch-slug>-<task-slug>.md");
  // Enumerated fields carry their exact allowed values.
  assertStringIncludes(md, "very high"); // likelihood
  for (const v of ["selected", "excluded", "undecided"]) {
    assertStringIncludes(md, v); // selection status
  }
  // Key constraints from the format are stated.
  assertStringIncludes(md, "256"); // justification max length
  assertStringIncludes(md, "3–6"); // threat count: soft target, not a hard limit
  // The path is obtained from the bundled path-minting script.
  assertStringIncludes(md, "scripts/assessment-path");
});

Deno.test("SKILL.md + assessment-file.md: the assessment file name is keyed by branch + task", async () => {
  const skill = await Deno.readTextFile(SKILL);
  const ref = await Deno.readTextFile(ASSESSMENT_REF);
  // Deterministic branch+task name (no timestamp) in both the skill and its schema ref.
  const NAME = ".ingrain-security/assessment-<branch-slug>-<task-slug>.md";
  assertStringIncludes(skill, NAME);
  assertStringIncludes(ref, "assessment-<branch-slug>-<task-slug>.md");
  // How the name is DERIVED belongs to the schema reference, not the spine: branch resolved
  // with git (not the unreliable .git/HEAD read), and the unknown-branch fallback that keeps
  // the task-only name.
  assertStringIncludes(ref, "git branch --show-current");
  assertStringIncludes(ref, "assessment-<task-slug>.md");
});

/**
 * The ownership rule: SKILL.md owns SEQUENCE and ROUTING; the reference files own DETAIL. A
 * fact lives in exactly one file — the one that acts on it — and SKILL.md reaches it with a
 * pointer, never a restatement. Every string fenced below once appeared in BOTH SKILL.md and
 * its owner; the duplication silently grows back on each edit unless something fails.
 */
Deno.test("ownership: SKILL.md does not restate what assessment-file.md owns", async () => {
  const skill = (await Deno.readTextFile(SKILL)).toLowerCase();
  // Path derivation and lifecycle are the schema reference's; the spine points at it.
  for (
    const fact of ["git branch --show-current", "living document", "assessment-<task-slug>.md"]
  ) {
    assertEquals(
      skill.includes(fact),
      false,
      `SKILL.md restates "${fact}", which references/formatting/assessment-file.md owns. ` +
        `Point at the reference instead of restating it.`,
    );
  }
});

Deno.test("ownership: dispatch.md § Selection windows stays mechanism-only", async () => {
  const md = await Deno.readTextFile(DISPATCH_REF);
  // The gate PROCEDURE (display the table first, then ask) is SKILL.md's; this file maps the
  // host MECHANISM only, and points back rather than restating the procedure.
  assertStringIncludes(md, "lives in SKILL.md");
  // The mechanism itself must still be here — this is what SKILL.md defers TO.
  assertStringIncludes(md.toLowerCase(), "one window per finding");
  assertStringIncludes(md.toLowerCase(), "fallback");
});

Deno.test("triage: instructs a prior-analysis lookup that seeds the generator", async () => {
  const skill = await Deno.readTextFile(SKILL);
  const triage = await Deno.readTextFile(TRIAGE_REF);
  // The triage worker scans the durable folder for a prior analysis of this task.
  assertStringIncludes(triage.toLowerCase(), "check for prior analysis");
  assertStringIncludes(triage, ".ingrain-security/assessment-<branch-slug>-*.md");
  // It compares branch + title and emits a Prior analysis pointer.
  assertStringIncludes(triage, "Prior analysis");
  // The orchestrator forwards that pointer to the generator so it seeds prior threats.
  assertStringIncludes(skill, "Prior analysis pointer");
  // The schema carries the optional Prior analysis field.
  assertStringIncludes(await Deno.readTextFile(ASSESSMENT_REF), "Prior analysis");
});

Deno.test("SKILL.md: documents the pointer-based hand-off and context-window discipline", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Workers hand off via pointers, not by pasting full content.
  assertStringIncludes(md.toLowerCase(), "pointer");
  // The orchestrator's reads of the analysis are bounded to the gates and finalize.
  assertStringIncludes(md.toLowerCase(), "context-window discipline");
  assertStringIncludes(md.toLowerCase(), "bounded slice of the assessment file");
});

Deno.test("SKILL.md: folds the assessment link + maintenance instruction into the plan", async () => {
  const md = await Deno.readTextFile(SKILL);
  // A maintenance instruction is aimed at the downstream implementing agent.
  assertStringIncludes(md, "Maintenance");
  assertStringIncludes(md, "implementing agent");
  // The file is meant to stay in sync as implementation evolves.
  assertStringIncludes(md.toLowerCase(), "in sync");
});

Deno.test("dispatch.md: covers the subagent primitive and the fallback", async () => {
  const md = await Deno.readTextFile(DISPATCH_REF);
  assertStringIncludes(md.toLowerCase(), "task primitive");
  assertStringIncludes(md.toLowerCase(), "fallback");
});

Deno.test("ingrain-cli.md: documents the ingrain rule-retrieval CLI", async () => {
  const ref = `${ROOT}skills/ingrain-security/references/lib/ingrain-cli.md`;
  const md = await Deno.readTextFile(ref);
  // The probe, the retrieval command, and its output shape.
  assertStringIncludes(md, "ingrain --version");
  assertStringIncludes(md, "ingrain context security_rules");
  assertStringIncludes(md, '{ "id"');
  // The pre-rename `decisions` spelling is no longer supported anywhere.
  assertEquals(md.includes("ingrain context decisions"), false);
});

Deno.test("SKILL.md: the orchestrator's own step retrieves rules", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Step 2 is the orchestrator's retrieval pass, run in session — not a dispatch. It shares a
  // block with the threat critique, so the retrieval costs no wall-clock of its own.
  // It points at the CLI reference rather than restating the command.
  assertStringIncludes(md, "references/lib/ingrain-cli.md");
});

// The assessment file must be written to the ABSOLUTE `assessment_abs`. A relative path
// is resolved by whoever receives it, and a worker subagent has no project root in view —
// it resolves against the file it was reading and creates a stray .ingrain-security/ folder
// there. These fence the wording so a later doc edit cannot quietly reintroduce that.

Deno.test("SKILL.md: dispatches workers with the absolute assessment_abs", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "assessment_abs");
  // The worker dispatch template must not hand out the relative path as a write target.
  assertStringIncludes(md, "<the minted assessment_abs — the ABSOLUTE path, pasted in full>");
});

Deno.test("session-start: points the orchestrator at assessment_abs", async () => {
  const hook = await Deno.readTextFile(SESSION_START);
  assertStringIncludes(hook, "assessment_abs");
});

Deno.test("session-start: injects the branch-diff runner Phase select routes on", async () => {
  const hook = await Deno.readTextFile(SESSION_START);
  // Both prose files promise the ready-to-run command arrives in SessionStart context. Without
  // the runner the orchestrator hand-rolls a merge-base loop, which is the drift this replaces.
  assertStringIncludes(hook, "scripts/branch-diff");
  assertStringIncludes(hook, "branch_diff_runner_escaped");
  assertStringIncludes(hook, "${branch_diff_runner_escaped}");
  // The routing signal itself has to reach the agent, not just the command.
  assertStringIncludes(hook, "delta_empty");
});

Deno.test("assessment-path: emits an instruction and anchors on the git repo root", async () => {
  const script = await Deno.readTextFile(PATH_SCRIPT);
  // The minting logic (JSON emission included) now lives in the shared mint-path.sh, which
  // both assessment-path and rules-path source; the thin script just labels + dispatches.
  assertStringIncludes(script, "lib/project-root.sh");
  assertStringIncludes(script, "lib/mint-path.sh");
  assertStringIncludes(script, "mint_dispatch assessment usage");
  const lib = await Deno.readTextFile(MINT_LIB);
  assertStringIncludes(lib, '"instruction":"%s"');
  // The label-parameterized JSON keeps the assessment field names byte-identical.
  assertStringIncludes(lib, '"%s_abs":"%s"');
  // Root resolution lives in project-root.sh; the anchoring is covered end-to-end by the
  // "run from a subdirectory" cases in tests/hooks/assessment-path.test.ts.
  assertStringIncludes(await Deno.readTextFile(PROJECT_ROOT_LIB), "rev-parse --show-toplevel");
});

/**
 * True when `script` really SOURCES `lib` — a `.` command line, in either style the scripts
 * use (`. "${SCRIPT_DIR}/…"` and `if ! . "${SCRIPT_DIR}/…"`).
 *
 * A plain substring search cannot answer this: every source line is preceded by a
 * `# shellcheck source=…/lib/project-root.sh` directive carrying the same text, so a script
 * that DELETED its source line and kept the comment would still pass one. The regression these
 * guards exist to catch would walk straight through.
 */
async function sourcesLib(script: string, lib: string): Promise<boolean> {
  const source = new RegExp(String.raw`^(?:if !\s+)?\.\s+\S*lib/${lib}\.sh`, "m");
  return source.test(await Deno.readTextFile(script));
}

Deno.test("project-root.sh: is sourced by every script that resolves the project root", async () => {
  // The lib exists to keep every one of these in lockstep — a copy drifting back into any of
  // them is the regression this guards. Both hosts' allow-hooks are in the list: they resolve
  // the project root exactly like the scripts do.
  for (const script of [PATH_SCRIPT, ENSURE_DIR, ALLOW_HOOK, CODEX_ALLOW_HOOK]) {
    assertEquals(await sourcesLib(script, "project-root"), true, `${script} must source the lib`);
  }
});

Deno.test("assessment-write.sh: is sourced by both allow-hooks", async () => {
  // The grant itself — the assessment naming and the folder containment check — lives in this
  // one lib so the two hosts cannot drift apart on what they auto-approve. A hook that inlined
  // its own check would pass every other test in this file.
  for (const hook of [ALLOW_HOOK, CODEX_ALLOW_HOOK]) {
    assertEquals(await sourcesLib(hook, "assessment-write"), true, `${hook} must source the lib`);
  }
});

Deno.test("assessment-file.md: names assessment_abs as the write target", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  assertStringIncludes(md, "assessment_abs");
});

Deno.test("hook.json: valid JSON configuring a SessionStart hook", async () => {
  const hook = JSON.parse(await Deno.readTextFile(HOOK_JSON));
  const serialized = JSON.stringify(hook);
  assertStringIncludes(serialized, "SessionStart");
});

Deno.test("hook.json: both platforms pass their host token to session-start", async () => {
  // session-start needs the host so it can inject a host-correct assessment-path command.
  const claude = JSON.stringify(JSON.parse(await Deno.readTextFile(HOOK_JSON)));
  const codex = JSON.stringify(JSON.parse(await Deno.readTextFile(CODEX_HOOK_JSON)));
  assertStringIncludes(claude, "start/session-start claude");
  assertStringIncludes(codex, "start/session-start codex");
  // The assessment-folder hook keeps passing its host token too.
  assertStringIncludes(claude, "start/ensure-assessment-dir claude");
  assertStringIncludes(codex, "start/ensure-assessment-dir codex");
});

Deno.test("hook.json: Claude registers the PreToolUse auto-approve hook", async () => {
  // Without this registration the assessment file prompts on every write, which is the
  // whole reason the hook exists — and nothing else in the suite would notice.
  const hook = JSON.parse(await Deno.readTextFile(HOOK_JSON));
  const pre = hook.hooks?.PreToolUse;
  assertEquals(Array.isArray(pre), true, "PreToolUse must be registered");
  const serialized = JSON.stringify(pre);
  assertStringIncludes(serialized, "claude/allow-assessment-write");
  // The matcher must cover every file-editing tool the hook itself accepts.
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    assertStringIncludes(serialized, tool);
  }
});

Deno.test("hook.json: Codex registers the PermissionRequest auto-approve hook", async () => {
  // Codex's prompt-skipping event is PermissionRequest, not PreToolUse — registering the
  // hook anywhere else would leave the assessment file prompting on every write.
  const hook = JSON.parse(await Deno.readTextFile(CODEX_HOOK_JSON));
  const request = hook.hooks?.PermissionRequest;
  assertEquals(Array.isArray(request), true, "PermissionRequest must be registered");
  const serialized = JSON.stringify(request);
  assertStringIncludes(serialized, "codex/allow-assessment-write");
  // The matcher must cover every tool name the hook itself accepts. Codex reports
  // `apply_patch`; Edit and Write are its documented aliases for the same tool.
  for (const tool of ["apply_patch", "Edit", "Write"]) {
    assertStringIncludes(serialized, tool);
  }
});

Deno.test("allow-assessment-write: both hooks only ever allow, never deny", async () => {
  // The hooks' core safety property, asserted on the sources themselves: they can remove a
  // permission prompt but must never introduce a block. A "deny" verdict appearing here
  // would mean the plugin can silently veto a user's edit.
  const claude = await Deno.readTextFile(ALLOW_HOOK);
  assertStringIncludes(claude, '"permissionDecision":"allow"');
  assertEquals(claude.includes('"permissionDecision":"deny"'), false);

  const codex = await Deno.readTextFile(CODEX_ALLOW_HOOK);
  assertStringIncludes(codex, '"behavior":"allow"');
  assertEquals(codex.includes('"behavior":"deny"'), false);
  // Only additive patch verbs are approved: a delete or a move is outside the grant.
  assertEquals(codex.includes("Delete File: "), false);

  // Both hosts get their grant from the same shared test, so they cannot drift apart on it:
  // the minter's naming, directly inside the assessment folder.
  const lib = await Deno.readTextFile(ALLOW_LIB);
  assertStringIncludes(lib, "assessment*.md");
  assertStringIncludes(lib, "/.ingrain-security");
});

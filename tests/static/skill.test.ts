/**
 * Static checks on the skill and hook wiring. No model calls. Guards the
 * workflow contract the live tests rely on: the strict step order, the two
 * announce/stop phrases, references to all 6 workers, and a valid SessionStart
 * hook that injects the skill.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { assertOrder, parseFrontmatter } from "../lib/matchers.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL = `${ROOT}skills/ingrain-security/SKILL.md`;
const ASSESSMENT_REF = `${ROOT}skills/ingrain-security/references/assessment-file.md`;
const TRIAGE_REF = `${ROOT}skills/ingrain-security/references/ingrain-relevance-triage.md`;
const HOOK_JSON = `${ROOT}hooks/claude/hook.json`;
const CODEX_HOOK_JSON = `${ROOT}hooks/codex/hook.json`;

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

Deno.test("SKILL.md: contains the announce and minor-stop phrases", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "Using ingrain-security to assess this plan.");
  assertStringIncludes(md, "no security review needed — minor change");
});

Deno.test("SKILL.md: documents the read-reference dispatch mechanism", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Generic-subagent dispatch reads each worker's reference file by path.
  assertStringIncludes(md, "Read references/<name>.md");
  // Cross-platform mapping lives in the reference doc.
  assertStringIncludes(md, "references/platform-dispatch.md");
  // The read-only constraint is restated for the dispatched subagents.
  assertStringIncludes(md.toLowerCase(), "read-only");
});

Deno.test("SKILL.md: documents the assessment file, its path, and living-document behavior", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Dedicated section, and the single file written straight into ingrain-security/.
  assertStringIncludes(md, "## The assessment file");
  assertStringIncludes(md, "ingrain-security/assessment-<branch-slug>-<task-slug>.md");
  // The host-root variable is still defined (used for the plan-file path).
  assertStringIncludes(md, "${coding_agent_root}");
  // It is written/updated as a living document.
  assertStringIncludes(md.toLowerCase(), "living document");
  // The file's schema/template is defined in a dedicated reference file.
  assertStringIncludes(md, "references/assessment-file.md");
  // The path is minted by the bundled script (mint), not hand-built.
  assertStringIncludes(md, "scripts/assessment-path");
  assertStringIncludes(md, "mint");
  assertStringIncludes(md, "assessment_path");
});

Deno.test("assessment-file.md: defines the strict on-disk format and its allowed values", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The single in-repo artifact path.
  assertStringIncludes(md, "ingrain-security/assessment-<branch-slug>-<task-slug>.md");
  // Enumerated fields carry their exact allowed values.
  assertStringIncludes(md, "very high"); // likelihood
  for (const v of ["selected", "excluded", "undecided"]) {
    assertStringIncludes(md, v); // selection status
  }
  // Key constraints from the format are stated.
  assertStringIncludes(md, "256"); // justification max length
  assertStringIncludes(md, "3–6 rows"); // threat count: soft target, not a hard limit
  // The path is obtained from the bundled path-minting script.
  assertStringIncludes(md, "scripts/assessment-path");
});

Deno.test("SKILL.md + assessment-file.md: the assessment file name is keyed by branch + task", async () => {
  const skill = await Deno.readTextFile(SKILL);
  const ref = await Deno.readTextFile(ASSESSMENT_REF);
  // Deterministic branch+task name (no timestamp) in both the skill and its schema ref.
  const NAME = "ingrain-security/assessment-<branch-slug>-<task-slug>.md";
  assertStringIncludes(skill, NAME);
  assertStringIncludes(ref, "assessment-<branch-slug>-<task-slug>.md");
  // Branch is resolved with git (not the unreliable .git/HEAD read).
  assertStringIncludes(skill, "git branch --show-current");
  // The unknown-branch fallback keeps the task-only name.
  assertStringIncludes(skill, "assessment-<task-slug>.md");
});

Deno.test("triage: instructs a prior-analysis lookup that seeds the generator", async () => {
  const skill = await Deno.readTextFile(SKILL);
  const triage = await Deno.readTextFile(TRIAGE_REF);
  // The triage worker scans the durable folder for a prior analysis of this task.
  assertStringIncludes(triage.toLowerCase(), "check for prior analysis");
  assertStringIncludes(triage, "ingrain-security/assessment-<branch-slug>-*.md");
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
  // The orchestrator does not read the full running analysis into its context.
  assertStringIncludes(md.toLowerCase(), "running analysis");
});

Deno.test("SKILL.md: folds the assessment link + maintenance instruction into the plan", async () => {
  const md = await Deno.readTextFile(SKILL);
  // A maintenance instruction is aimed at the downstream implementing agent.
  assertStringIncludes(md, "Maintenance");
  assertStringIncludes(md, "implementing agent");
  // The file is meant to stay in sync as implementation evolves.
  assertStringIncludes(md.toLowerCase(), "in sync");
});

Deno.test("platform-dispatch.md: covers the subagent primitive and the fallback", async () => {
  const ref = `${ROOT}skills/ingrain-security/references/platform-dispatch.md`;
  const md = await Deno.readTextFile(ref);
  assertStringIncludes(md.toLowerCase(), "task primitive");
  assertStringIncludes(md.toLowerCase(), "fallback");
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

/**
 * Static checks on the skill and hook wiring. No model calls. Guards the
 * workflow contract the live tests rely on: the strict step order, the two
 * announce/stop phrases, references to all 6 workers, and a valid SessionStart
 * hook that injects the skill.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { assertOrder, parseFrontmatter } from "../lib/assert.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL = `${ROOT}skills/ingrain-security/SKILL.md`;
const HOOK_JSON = `${ROOT}hooks/hook.json`;

const WORKERS = [
  "relevance-triage",
  "threat-generator",
  "threat-critic",
  "risk-scorer",
  "mitigation-generator",
  "mitigation-critic",
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
  assertOrder(md, "relevance-triage", "threat-generator", "triage before threats");
  assertOrder(md, "threat-generator", "threat-critic", "generate before critique");
  assertOrder(md, "threat-critic", "risk-scorer", "critique/freeze before scoring");
  assertOrder(md, "risk-scorer", "mitigation-generator", "score before mitigation");
  assertOrder(md, "mitigation-generator", "mitigation-critic", "mitigate before critique");
});

Deno.test("SKILL.md: contains the announce and minor-stop phrases", async () => {
  const md = await Deno.readTextFile(SKILL);
  assertStringIncludes(md, "Using ingrain-security to assess this plan.");
  assertStringIncludes(md, "no security review needed — minor change");
});

Deno.test("hook.json: valid JSON configuring a SessionStart hook", async () => {
  const hook = JSON.parse(await Deno.readTextFile(HOOK_JSON));
  const serialized = JSON.stringify(hook);
  assertStringIncludes(serialized, "SessionStart");
});

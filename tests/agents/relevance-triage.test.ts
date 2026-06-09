/**
 * relevance-triage (haiku): classifies a plan as `major` or `minor`.
 * Live test — runs the agent in isolation via `--agent`.
 */

import { assertContainsAny } from "../lib/assert.ts";
import { runChecked } from "../lib/report.ts";
import { MAJOR_PLAN, MINOR_PLAN } from "../lib/fixtures.ts";

Deno.test("relevance-triage: security-relevant plan -> major", async () => {
  await runChecked(
    "relevance-triage :: major plan",
    MAJOR_PLAN,
    { agent: "relevance-triage", timeoutMs: 90_000 },
    (r) => assertContainsAny(r.text, [/\bmajor\b/i], "expected a 'major' verdict"),
  );
});

Deno.test("relevance-triage: cosmetic/doc plan -> minor", async () => {
  await runChecked(
    "relevance-triage :: minor plan",
    MINOR_PLAN,
    { agent: "relevance-triage", timeoutMs: 90_000 },
    (r) => assertContainsAny(r.text, [/\bminor\b/i], "expected a 'minor' verdict"),
  );
});

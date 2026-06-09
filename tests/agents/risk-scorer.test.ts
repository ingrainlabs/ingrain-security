/**
 * risk-scorer (sonnet): scores each frozen threat on likelihood x impact (0-100),
 * gives an overall plan score + a criticality band, and preserves the tags.
 * Live test via `--agent`.
 */

import { assertContainsAll, assertContainsAny } from "../lib/assert.ts";
import { runChecked } from "../lib/report.ts";
import { TASK_AND_FROZEN_THREATS } from "../lib/fixtures.ts";

Deno.test("risk-scorer: scores threats with likelihood/impact and a criticality band", async () => {
  await runChecked(
    "risk-scorer :: frozen threats",
    TASK_AND_FROZEN_THREATS,
    { agent: "risk-scorer", timeoutMs: 120_000 },
    (r) => {
      assertContainsAll(r.text, [/likelihood/i, /impact/i], "expected likelihood & impact labels");
      assertContainsAny(r.text, [/\b(low|medium|high|critical)\b/i], "expected a criticality band");
      assertContainsAny(r.text, [/\bT1\b/], "expected the T1 tag to be preserved");
    },
  );
});

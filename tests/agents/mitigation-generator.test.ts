/**
 * mitigation-generator (sonnet): proposes mitigations for the selected threats,
 * each with Yield / Effort / threatTags fields. Live test via `--agent`.
 */

import { assertContainsAll, assertContainsAny } from "../lib/assert.ts";
import { runChecked } from "../lib/report.ts";
import { SELECTED_THREATS } from "../lib/fixtures.ts";

Deno.test("mitigation-generator: emits Yield/Effort and references threat tags", async () => {
  await runChecked(
    "mitigation-generator :: selected threats",
    SELECTED_THREATS,
    { agent: "mitigation-generator", timeoutMs: 120_000 },
    (r) => {
      assertContainsAll(r.text, [/yield/i, /effort/i], "expected Yield & Effort fields");
      assertContainsAny(r.text, [/threatTags/i, /\bT1\b/], "expected a threat-tag reference");
    },
  );
});

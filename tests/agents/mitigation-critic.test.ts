/**
 * mitigation-critic (sonnet): scores mitigation coverage 0-100 and returns a
 * verdict (`approved` / `needs-revision`). Live test via `--agent`.
 */

import { assertContainsAny, assertHasScore0to100 } from "../lib/assert.ts";
import { runChecked } from "../lib/report.ts";
import { THREAT_AND_MITIGATIONS } from "../lib/fixtures.ts";

Deno.test("mitigation-critic: returns a verdict and a 0-100 score", async () => {
  await runChecked(
    "mitigation-critic :: sample mitigations",
    THREAT_AND_MITIGATIONS,
    { agent: "mitigation-critic", timeoutMs: 120_000 },
    (r) => {
      assertContainsAny(r.text, [/approved/i, /needs[-\s]revision/i], "expected a verdict");
      assertHasScore0to100(r.text);
    },
  );
});

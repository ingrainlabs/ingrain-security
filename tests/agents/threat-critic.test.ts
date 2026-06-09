/**
 * threat-critic (sonnet): scores a threat model 0-100 and returns a verdict
 * (`approved` / `needs-revision`). Live test via `--agent`.
 *
 * Verdict is non-deterministic, so we assert the *shape* (a verdict keyword +
 * a 0-100 score). The weak fixture biases toward needs-revision but we don't
 * hard-require it, to keep the test stable.
 */

import { assertContainsAny, assertHasScore0to100 } from "../lib/assert.ts";
import { runChecked } from "../lib/report.ts";
import { TASK_AND_WEAK_MODEL } from "../lib/fixtures.ts";

Deno.test("threat-critic: returns a verdict and a 0-100 score", async () => {
  await runChecked(
    "threat-critic :: weak model",
    TASK_AND_WEAK_MODEL,
    { agent: "threat-critic", timeoutMs: 120_000 },
    (r) => {
      assertContainsAny(r.text, [/approved/i, /needs[-\s]revision/i], "expected a verdict");
      assertHasScore0to100(r.text);
    },
  );
});

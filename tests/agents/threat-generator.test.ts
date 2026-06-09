/**
 * threat-generator (sonnet): produces a threat list with stable tags T1, T2, …
 * Live test via `--agent`.
 */

import { assertContainsAny } from "../lib/assert.ts";
import { assertEquals } from "@std/assert";
import { runChecked } from "../lib/report.ts";
import { MAJOR_PLAN } from "../lib/fixtures.ts";

Deno.test("threat-generator: emits tagged threats for a security plan", async () => {
  await runChecked(
    "threat-generator :: major plan",
    MAJOR_PLAN,
    { agent: "threat-generator", timeoutMs: 120_000 },
    (r) => {
      assertContainsAny(r.text, [/\bT1\b/], "expected at least a 'T1' threat tag");
      assertEquals(r.text.trim().length > 100, true, "expected a non-trivial threat list");
    },
  );
});

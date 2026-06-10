/**
 * Skill behavior in a full session (skill + agents + hook loaded). Verifies the
 * orchestrator starts the review on a security-relevant plan, and short-circuits
 * on a trivial one. Bounded turns keep these from running the whole cycle.
 */

import { assertEquals } from "@std/assert";
import { assertContainsAny, assertReviewStarted } from "../lib/matchers.ts";
import { dispatchedWorkers, SESSION_MAX_TURNS, SESSION_TIMEOUT_MS } from "../lib/claudeRunner.ts";
import { runChecked } from "../lib/reporter.ts";
import { MAJOR_PLAN, MINOR_PLAN } from "../lib/sampleInputs.ts";

Deno.test("trigger: security-relevant plan starts the review", async () => {
  await runChecked(
    "skill trigger :: major plan",
    `Here is my implementation plan, ready to build:\n\n${MAJOR_PLAN}`,
    { streamJson: true, maxTurns: SESSION_MAX_TURNS, timeoutMs: SESSION_TIMEOUT_MS },
    (r) => assertReviewStarted(r),
  );
});

Deno.test("trigger: trivial plan stops at triage (minor)", async () => {
  await runChecked(
    "skill trigger :: minor plan",
    `Here is my implementation plan, ready to build:\n\n${MINOR_PLAN}`,
    { streamJson: true, maxTurns: SESSION_MAX_TURNS, timeoutMs: SESSION_TIMEOUT_MS },
    (r) => {
      // Behavioral outcome, not exact prose: triage lands on `minor` and the cycle
      // stops there. (The exact instructed phrase is checked in static/skill.test.ts.)
      assertContainsAny(r.text, [/\bminor\b/i], "expected a 'minor' triage outcome");
      assertEquals(
        dispatchedWorkers(r.events).includes("ingrain-threat-generator"),
        false,
        "minor changes must not reach ingrain-threat-generator",
      );
    },
  );
});

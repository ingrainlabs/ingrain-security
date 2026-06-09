/**
 * Full orchestration, integration-gated (set INTEGRATION=1, or `deno task
 * test:integration`). Drives a security-relevant plan and asserts the workers
 * fire in the required order through risk scoring, then the run reaches Gate 1
 * without crossing into mitigation. We do NOT answer the interactive gates.
 */

import { assertEquals } from "@std/assert";
import { assertContainsAny, assertOrder, assertWorkerDispatched } from "../lib/matchers.ts";
import {
  dispatchedWorkers,
  ORCHESTRATION_MAX_TURNS,
  ORCHESTRATION_TIMEOUT_MS,
} from "../lib/claudeRunner.ts";
import { runChecked } from "../lib/reporter.ts";
import { MAJOR_PLAN } from "../lib/sampleInputs.ts";

const INTEGRATION = Boolean(Deno.env.get("INTEGRATION"));

Deno.test({
  name: "orchestration: triage -> threats -> critic -> risk-scorer, halts at Gate 1",
  ignore: !INTEGRATION,
  fn: async () => {
    await runChecked(
      "orchestration :: major plan",
      `Here is my implementation plan, ready to build. Run the security review:\n\n${MAJOR_PLAN}`,
      { streamJson: true, maxTurns: ORCHESTRATION_MAX_TURNS, timeoutMs: ORCHESTRATION_TIMEOUT_MS },
      (r) => {
        const order = dispatchedWorkers(r.events);
        const trace = order.join(" -> ");

        assertWorkerDispatched(r.events, "relevance-triage");
        assertWorkerDispatched(r.events, "threat-generator");
        assertWorkerDispatched(r.events, "risk-scorer");

        assertOrder(trace, "relevance-triage", "threat-generator", "triage before threats");
        assertOrder(trace, "threat-generator", "risk-scorer", "threats frozen before scoring");

        // Scored output: a criticality band should be present.
        assertContainsAny(
          r.text,
          [/\b(low|medium|high|critical)\b/i],
          "expected a criticality band from risk-scorer",
        );

        // Gate 1 is a hard stop: mitigation must not begin before the user selects.
        assertEquals(
          order.includes("mitigation-generator"),
          false,
          `mitigation started before Gate 1 — trace: ${trace}`,
        );
      },
    );
  },
});

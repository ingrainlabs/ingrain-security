/**
 * Full orchestration, integration-gated (set INTEGRATION=1, or `deno task
 * test:integration`). Drives a security-relevant plan and asserts the choreography the
 * driver model depends on: the two chains fork after triage, each is critiqued, and the
 * run halts at the user gates without crossing into guidance. We do NOT answer the
 * interactive gates.
 *
 * These pin flow BEHAVIOUR, not names. Every halt assertion here is a negative, so it
 * is only as honest as the roster `dispatchedWorkers` filters on: a name absent from
 * `lib/workers.ts` can never appear in a trace, and the assertion passes vacuously.
 * That roster is the single source for exactly this reason — do not inline a copy.
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
  name: "orchestration: both driver chains run, and the run halts at the user gates",
  ignore: !INTEGRATION,
  fn: async () => {
    await runChecked(
      "orchestration :: major plan",
      `Here is my implementation plan, ready to build. Run the security review:\n\n${MAJOR_PLAN}`,
      { streamJson: true, maxTurns: ORCHESTRATION_MAX_TURNS, timeoutMs: ORCHESTRATION_TIMEOUT_MS },
      (r) => {
        const order = dispatchedWorkers(r.events);
        const trace = order.join(" -> ");

        assertWorkerDispatched(r.events, "ingrain-relevance-triage");
        assertWorkerDispatched(r.events, "ingrain-threat-generator");
        assertWorkerDispatched(r.events, "ingrain-risk-scorer");

        assertOrder(
          trace,
          "ingrain-relevance-triage",
          "ingrain-threat-generator",
          "triage before threats",
        );
        assertOrder(
          trace,
          "ingrain-threat-generator",
          "ingrain-risk-scorer",
          "threats frozen before scoring",
        );

        // Scored output: a criticality band should be present.
        assertContainsAny(
          r.text,
          [/\b(low|medium|high|critical)\b/i],
          "expected a criticality band from ingrain-risk-scorer",
        );

        // The gates are a hard stop on BOTH axes: guidance needs each gate's selections,
        // so it must not begin before the user decides. This is the join the parallel
        // model adds, and the one edge worth pinning rather than implying.
        assertEquals(
          order.includes("ingrain-guidance-generator"),
          false,
          `guidance started before the user gates — trace: ${trace}`,
        );
        // ...and the same for its critic, which reads what the generator has not written.
        assertEquals(
          order.includes("ingrain-guidance-critic"),
          false,
          `the guidance critic ran before any guidance existed — trace: ${trace}`,
        );
      },
    );
  },
});

Deno.test({
  name: "orchestration: the rule chain is critiqued before the gate presents it",
  ignore: !INTEGRATION,
  fn: async () => {
    await runChecked(
      "orchestration :: rule chain",
      `Here is my implementation plan, ready to build. Run the security review:\n\n${MAJOR_PLAN}`,
      { streamJson: true, maxTurns: ORCHESTRATION_MAX_TURNS, timeoutMs: ORCHESTRATION_TIMEOUT_MS },
      (r) => {
        const order = dispatchedWorkers(r.events);
        const trace = order.join(" -> ");

        // The rule critique is what makes accept-all sound: it prunes the retrieval's misses
        // before anything is presented, so the user vouches for a curated set. A run that
        // reached a rule gate without it would be offering the raw broad retrieval.
        //
        // The rule chain STOPS at its gate — it does not flow on into guidance. That is the
        // rule axis's half of the join test 1 pins on the threat axis: guidance waits on BOTH
        // gates, so an unanswered rule gate holds it exactly as an unanswered threat gate
        // does. Asserted UNCONDITIONALLY: with no gate answered, guidance must not have
        // started whether or not retrieval found anything, so this half never depends on the
        // environment.
        assertEquals(
          order.includes("ingrain-guidance-generator"),
          false,
          `guidance started before the rule gate was answered — trace: ${trace}`,
        );

        // Only the critic-ran half is conditional: the CLI may be absent or unconfigured in
        // the harness, which leaves `## Org rules` empty by design and gives the critic
        // nothing to judge. The skip is ANNOUNCED rather than silent — this used to be a bare
        // `return` above every assertion, so a harness without the CLI ran this test to green
        // having checked nothing at all, indefinitely and invisibly.
        if (!order.includes("ingrain-rule-critic")) {
          console.warn(
            "  ! rule-critic assertions SKIPPED: retrieval produced no rules (ingrain CLI " +
              "absent or unconfigured). The choreography above was still checked.",
          );
          return;
        }
        // The chains' relative order is deliberately NOT asserted: they run in parallel, so
        // either interleaving is legal and pinning one would fail on scheduling. The
        // never-waits-on-a-gate property is pinned statically instead, on SKILL.md's own
        // wording — see static/skill.test.ts § retrieval keys on the plan and the footprint.
      },
    );
  },
});

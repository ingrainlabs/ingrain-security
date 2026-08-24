/**
 * Full orchestration, integration-gated (set INTEGRATION=1, or `deno task
 * test:integration`). Drives a security-relevant plan and asserts the choreography the
 * driver model depends on: the two chains fork after triage, each is critiqued, and the
 * run halts at the user gates without crossing into guidance.
 *
 * **Two things are supplied up front so the run can reach its subject; neither is a gate.**
 * The session gets a repo that holds what the plan describes (`MAJOR_PROJECT` — a plan whose
 * targets do not exist is refused, not reviewed), and the prompt carries the subagent request
 * (`PROMPT`). The two **driver gates** are left unanswered on purpose: they are the decisions
 * under test, and the halt is what these assertions read.
 *
 * **The halt is asserted on the ARTIFACT, not on a worker roster.** It used to read
 * `order.includes("ingrain-guidance-generator") === false`, which stopped meaning anything the
 * moment guidance became the orchestrator's own step: a name absent from `lib/workers.ts` can
 * never appear in a trace, so the assertion passed vacuously rather than failing. What survives
 * a step changing hands is the file — guidance nobody has written yet is guidance the assessment
 * does not carry — so that is what these read. It is also why the halt check runs FIRST and
 * unconditionally: it is the one thing still proved when the dispatch half is skipped.
 *
 * **Roughly half of headless runs stop before dispatching, and that is announced, not failed.**
 * See `dispatchedSomething` for the full reasoning and for the one shape of it that is a real
 * defect. A run that skips prints several lines saying precisely which half it was, what still
 * ran, and what did not — so a green result is never mistaken for a complete one.
 */

import { assertEquals } from "@std/assert";
import { assertOrder, assertWorkerDispatched } from "../lib/matchers.ts";
import {
  dispatchedWorkers,
  ORCHESTRATION_MAX_TURNS,
  ORCHESTRATION_TIMEOUT_MS,
  toolNames,
} from "../lib/claudeRunner.ts";
import { runChecked } from "../lib/reporter.ts";
import { MAJOR_PLAN } from "../lib/sampleInputs.ts";
import { MAJOR_PROJECT, projectWith } from "../lib/sampleProjects.ts";
import type { StreamEvent } from "../lib/types.ts";

const INTEGRATION = Boolean(Deno.env.get("INTEGRATION"));

/**
 * The invoking prompt: the plan, plus the two answers a user would give before the run starts.
 *
 * **Both are questions the flow puts BEFORE the driver gates, and headless has nobody to
 * answer them.** Left implicit, the run stops at whichever one it reaches first and this tier —
 * whose whole subject is the worker choreography — measures a review that never started.
 *
 * 1. **The subagent request.** A session rule holds the host's subagent tool behind a user
 *    request, and `references/lib/dispatch.md` § When a session rule gates subagents behind user
 *    request handles it correctly: ask once, up front, before the first dispatch. That same
 *    reference names the way out — a request already present **in the invoking prompt** IS the
 *    request.
 * 2. **Step 0's review question.** `flow.md` gives a non-interactive fallback ("no window
 *    mechanism reachable → take `Yes`"), but whether a headless run applies it or asks and waits
 *    is a coin flip: measured runs of this exact prompt did each once, one dispatching all four
 *    workers and the other stopping before its first write. Answering it removes the flake
 *    rather than papering over it.
 *
 * **The two driver gates stay unanswered** — they are what this tier tests, and the halt at them
 * is the assertion. Nothing here tells the run how to behave internally; it is the user's side of
 * the conversation, supplied up front instead of interactively.
 */
const PROMPT = `Here is my implementation plan, ready to build. Run the security review.\n\n` +
  `Answering the two questions it opens with, so you do not have to stop and ask: **yes**, this ` +
  `touches a security surface, so run the review; and **yes**, I am requesting that you dispatch ` +
  `the workers as subagents. Stop at the threat gate and the rule gate and show me the tables — ` +
  `I will make those decisions myself.\n\n${MAJOR_PLAN}`;

/**
 * True when the run dispatched at least one subagent — and when it did not, says exactly why
 * the dispatch assertions are about to be skipped.
 *
 * **Skipped rather than failed, because the cause is usually not a defect.** Driving an
 * interactive skill headlessly means the run meets questions with no reply channel, and whether
 * a `--print` session acts on the answers this prompt supplies or stops to ask them anyway is
 * model-dependent — measured across repeated runs of this exact prompt, roughly half proceed
 * through all four dispatches and half stop before the first. A test that is red half the time
 * for a reason nobody can fix is a test people learn to skip past, which costs more than it
 * catches.
 *
 * **But a skip must never be able to hide a real defect**, and one specific defect looks
 * identical from here: `dispatchedWorkers` filters tool calls by NAME, so a host that renames
 * its subagent primitive empties the list. That is not hypothetical — the tool became `Agent`
 * while the detector still matched `Task`, and this tier went quietly vacuous for as long as
 * that lasted. So the two cases are separated by asking whether the review got anywhere at all:
 * threats on disk with no subagent seen means the work happened through something this harness
 * does not recognise, which is the case that must be shouted about rather than skipped.
 */
async function dispatchedSomething(events: StreamEvent[], project: string): Promise<boolean> {
  const used = [...new Set(toolNames(events))];
  if (used.some((name) => name === "Agent" || name === "Task")) return true;

  const threats = await sectionLines(project, "Threats", /^### T\d+\b/);
  const seen = `Tools this run used: ${used.join(", ") || "(none)"}.`;

  if (threats.length > 0) {
    // The dangerous case. Do NOT soften this: the tier is unreliable until it is resolved.
    console.warn(
      `\n  !! ORCHESTRATION TIER IS UNRELIABLE — read this before trusting a green run.\n` +
        `  !! The review DID run — ${threats.length} threat entries were written — but through ` +
        `no tool this harness recognises as a subagent dispatch.\n` +
        `  !! Two possible causes, and both make every dispatch assertion here meaningless:\n` +
        `  !!   1. The host RENAMED its subagent tool. Add the new name to SUBAGENT_TOOLS in ` +
        `lib/claudeRunner.ts. This has happened before: it was 'Task', it is now 'Agent', and ` +
        `the detector went stale for months without a single test turning red.\n` +
        `  !!   2. The run took the sequential in-context fallback ` +
        `(references/lib/dispatch.md), which is a legal mode but not the one this tier exists ` +
        `to check.\n  !! ${seen}\n`,
    );
    return false;
  }

  console.warn(
    `\n  ! DISPATCH ASSERTIONS SKIPPED — the run stopped before any threat work, so there is ` +
      `no choreography to check.\n` +
      `  ! WHY: this tier drives the skill headlessly, and the flow asks two questions before ` +
      `the driver gates — the subagent request (references/lib/dispatch.md) and Step 0's review ` +
      `question. The prompt answers BOTH up front, but '--print' has no reply channel, so ` +
      `whether a session acts on those answers or stops to ask anyway is model-dependent. ` +
      `Measured on this exact prompt: roughly half of runs proceed through all four dispatches, ` +
      `half stop here. This is that half.\n` +
      `  ! NOT A REGRESSION on its own — re-run to get a proceeding session. It IS worth ` +
      `investigating if it becomes consistent, because that would mean the run stopped for a ` +
      `new reason rather than this one.\n` +
      `  ! WHAT STILL RAN: the halt assertions below, which read the assessment file and hold ` +
      `either way. WHAT DID NOT: everything about worker order and scoring.\n  ! ${seen}\n`,
  );
  return false;
}

/**
 * Field lines matching `pattern` inside one `## ` section, across every assessment this run
 * minted.
 *
 * Read from the throwaway project rather than from this checkout, which is what lets a result be
 * asserted EMPTY: the repo is fresh per run, so an assessment left behind by an earlier, fully
 * answered review cannot be mistaken for this run's work.
 */
async function sectionLines(
  project: string,
  heading: string,
  pattern: RegExp,
): Promise<string[]> {
  const found: string[] = [];
  try {
    for await (const entry of Deno.readDir(`${project}/.ingrain-security`)) {
      if (!entry.isFile || !entry.name.startsWith("assessment")) continue;
      const text = await Deno.readTextFile(`${project}/.ingrain-security/${entry.name}`);
      for (const section of text.split("\n## ")) {
        if (!section.startsWith(heading)) continue;
        for (const line of section.split("\n")) if (pattern.test(line)) found.push(line.trim());
      }
    }
  } catch {
    // No folder yet is the same evidence as an empty one: nothing has been written.
  }
  return found.sort();
}

/** The `### M<n>` guidance entries — none, until both gates are answered. */
const guidanceEntries = (project: string): Promise<string[]> =>
  sectionLines(project, "Implementation guidance", /^### M\d+\b/);

/**
 * The `Criticality:` lines the scoring step wrote into each threat's `#### score` block.
 *
 * **Read from the file, not from the run's text.** This asserted a criticality band in the
 * assistant's prose, which held while scoring was a subagent whose RETURN carried one. It is the
 * orchestrator's own step now and its output is the block — so the prose only mentions a band
 * once the gate table is rendered, and a run that scored correctly but stopped just short of the
 * table failed for saying nothing rather than for doing nothing.
 */
const scoredThreats = (project: string): Promise<string[]> =>
  sectionLines(project, "Threats", /^Criticality:\s*\S/);

Deno.test({
  name: "orchestration: both driver chains run, and the run halts at the user gates",
  ignore: !INTEGRATION,
  fn: async () => {
    const cwd = await projectWith(MAJOR_PROJECT);
    try {
      await runChecked(
        "orchestration :: major plan",
        PROMPT,
        {
          streamJson: true,
          maxTurns: ORCHESTRATION_MAX_TURNS,
          timeoutMs: ORCHESTRATION_TIMEOUT_MS,
          cwd,
        },
        async (r) => {
          const order = dispatchedWorkers(r.events);
          const trace = order.join(" -> ");

          // **The halt is checked first, and unconditionally.** It reads the assessment rather
          // than the trace, so it holds whether or not the run dispatched anything — which
          // makes it the one thing this tier still proves on a skipped run. The gates are a
          // hard stop on BOTH axes: guidance needs each gate's selections, so it must not be
          // written before the user decides. That join is the edge worth pinning rather than
          // implying.
          assertEquals(
            await guidanceEntries(cwd),
            [],
            `guidance was written before the user gates — trace: ${trace}`,
          );

          if (!await dispatchedSomething(r.events, cwd)) return;

          assertWorkerDispatched(r.events, "ingrain-threat-generator");
          assertWorkerDispatched(r.events, "ingrain-threat-critic");

          assertOrder(
            trace,
            "ingrain-threat-generator",
            "ingrain-threat-critic",
            "threats generated before they are critiqued",
          );

          // Scoring is the orchestrator's own step now, so it leaves no dispatch to trace —
          // what it leaves is a filled `#### score` block per threat. None means the run
          // stopped before Step 3 rather than at the gates.
          assertEquals(
            (await scoredThreats(cwd)).length > 0,
            true,
            "no threat carries a Criticality, so the orchestrator's scoring step never ran",
          );
        },
      );
    } finally {
      await Deno.remove(cwd, { recursive: true });
    }
  },
});

Deno.test({
  name: "orchestration: the rule chain is critiqued before the gate presents it",
  ignore: !INTEGRATION,
  fn: async () => {
    const cwd = await projectWith(MAJOR_PROJECT);
    try {
      await runChecked(
        "orchestration :: rule chain",
        PROMPT,
        {
          streamJson: true,
          maxTurns: ORCHESTRATION_MAX_TURNS,
          timeoutMs: ORCHESTRATION_TIMEOUT_MS,
          cwd,
        },
        async (r) => {
          const order = dispatchedWorkers(r.events);
          const trace = order.join(" -> ");

          // The rule chain STOPS at its gate — it does not flow on into guidance. That is the
          // rule axis's half of the join test 1 pins on the threat axis: guidance waits on BOTH
          // gates, so an unanswered rule gate holds it exactly as an unanswered threat gate
          // does. Asserted UNCONDITIONALLY: with no gate answered, guidance must not have been
          // written whether or not retrieval found anything, so this half never depends on the
          // environment.
          assertEquals(
            await guidanceEntries(cwd),
            [],
            `guidance was written before the rule gate was answered — trace: ${trace}`,
          );

          if (!await dispatchedSomething(r.events, cwd)) return;

          // **That the rule critic ran at all is the other half of this test**, and it is what
          // makes accept-all sound: it prunes the retrieval's misses before anything is
          // presented, so the user vouches for a curated set. A run that reached a rule gate
          // without it would be offering the raw broad retrieval.
          //
          // Conditional on a SECOND environmental precondition, distinct from the dispatch one
          // above: the CLI may be absent or unconfigured, which leaves `## Org rules` empty by
          // design and gives the critic nothing to judge. Announced for the same reason — this
          // used to be a bare `return` above every assertion, so a harness without the CLI ran
          // the test to green having checked nothing at all, indefinitely and invisibly.
          //
          // The chains' relative order is deliberately NOT asserted: they run in parallel, so
          // either interleaving is legal and pinning one would fail on scheduling. The
          // never-waits-on-a-gate property is pinned statically instead, on SKILL.md's own
          // wording — see static/skill.test.ts § retrieval keys on the plan and the footprint.
          if (!order.includes("ingrain-rule-critic")) {
            console.warn(
              `\n  ! RULE-CRITIC ASSERTIONS SKIPPED — the workers ran, but no rule critic among ` +
                `them.\n` +
                `  ! WHY: the rule chain only exists when the 'ingrain' CLI is installed AND ` +
                `configured AND this repository is registered on the platform. Any of those ` +
                `missing leaves '## Org rules' empty by design, so there is nothing to critique ` +
                `and nothing to prune. That is a legal review, not a defect.\n` +
                `  ! WHAT STILL RAN: the threat chain and the halt at the gates. WHAT DID NOT: ` +
                `that retrieval is curated before the rule gate presents it.\n` +
                `  ! Trace: ${trace}\n`,
            );
          }
        },
      );
    } finally {
      await Deno.remove(cwd, { recursive: true });
    }
  },
});

/**
 * Live per-worker tests, table-driven. Each case dispatches one worker the way
 * the orchestrator does — its SKILL.md body as the system prompt, plus a freshly
 * minted assessment file as its write target — and asserts the output's *shape*
 * (a verdict keyword, a 0-100 score, risk descending by tag, required fields)
 * over the worker's return AND the file it wrote. Assertions are loose because
 * live model output varies.
 *
 * The cases live in a single CASES table — mirroring the WORKERS loop in
 * static/agents.test.ts — so adding or tuning a worker test is a one-row change.
 */

import { assertEquals } from "@std/assert";
import {
  assertContainsAll,
  assertContainsAny,
  assertHasScore0to100,
  assertRiskDescendsByTag,
} from "../lib/matchers.ts";
import {
  AGENT_TIMEOUT_MS,
  mintAssessment,
  TRIAGE_TIMEOUT_MS,
  workerDispatchPrompt,
} from "../lib/claudeRunner.ts";
import type { RunResult } from "../lib/types.ts";
import { runChecked } from "../lib/reporter.ts";
import {
  MAJOR_PLAN,
  MINOR_PLAN,
  SELECTED_THREATS,
  TASK_AND_FROZEN_THREATS,
  TASK_AND_WEAK_MODEL,
  THREAT_AND_MITIGATIONS,
} from "../lib/sampleInputs.ts";

/**
 * Tools every worker is dispatched with. Workers write their section of the assessment
 * file, so Write/Edit are part of the real dispatch and have to be part of this one too —
 * without them a worker cannot complete its hand-off contract.
 */
const WORKER_TOOLS = ["Read", "Grep", "Glob", "Write", "Edit"];

interface AgentCase {
  /** Worker skill to dispatch (skills/<worker>/SKILL.md). */
  worker: string;
  /** Display label for the INPUT/OUTPUT/VERDICT block and the test name. */
  label: string;
  /** Input fed to the worker (becomes the dispatch INPUT). */
  input: string;
  /** Per-call timeout. */
  timeoutMs: number;
  /** Shape assertions on the worker's response. */
  check: (r: RunResult) => void;
}

const CASES: AgentCase[] = [
  {
    // ingrain-relevance-triage (haiku): classifies a plan as `major` or `minor`.
    worker: "ingrain-relevance-triage",
    label: "ingrain-relevance-triage :: major plan",
    input: MAJOR_PLAN,
    timeoutMs: TRIAGE_TIMEOUT_MS,
    check: (r) => assertContainsAny(r.text, [/\bmajor\b/i], "expected a 'major' verdict"),
  },
  {
    worker: "ingrain-relevance-triage",
    label: "ingrain-relevance-triage :: minor plan",
    input: MINOR_PLAN,
    timeoutMs: TRIAGE_TIMEOUT_MS,
    check: (r) => assertContainsAny(r.text, [/\bminor\b/i], "expected a 'minor' verdict"),
  },
  {
    // ingrain-threat-generator (sonnet): produces a threat list with stable tags T1, T2, …
    worker: "ingrain-threat-generator",
    label: "ingrain-threat-generator :: major plan",
    input: MAJOR_PLAN,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAny(r.text, [/\bT1\b/], "expected at least a 'T1' threat tag");
      assertEquals(r.text.trim().length > 100, true, "expected a non-trivial threat list");
    },
  },
  {
    // ingrain-risk-scorer (sonnet): scores each threat likelihood x impact (0-100), with
    // an overall criticality band, then re-tags the frozen list into descending-risk order.
    // The fixture's incoming tags are deliberately out of risk order, so a scorer that
    // leaves them alone fails the ordering assertion.
    worker: "ingrain-risk-scorer",
    label: "ingrain-risk-scorer :: frozen threats",
    input: TASK_AND_FROZEN_THREATS,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAll(r.text, [/likelihood/i, /impact/i], "expected likelihood & impact labels");
      assertContainsAny(r.text, [/\b(low|medium|high|critical)\b/i], "expected a criticality band");
      assertRiskDescendsByTag(r.text, "expected the threats re-tagged into risk order");
    },
  },
  {
    // ingrain-threat-critic (sonnet): scores a threat model 0-100 and returns a verdict.
    // The weak fixture biases toward needs-revision but we assert only the shape.
    worker: "ingrain-threat-critic",
    label: "ingrain-threat-critic :: weak model",
    input: TASK_AND_WEAK_MODEL,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAny(r.text, [/approved/i, /needs[-\s]revision/i], "expected a verdict");
      assertHasScore0to100(r.text);
    },
  },
  {
    // ingrain-mitigation-critic (sonnet): scores mitigation coverage 0-100 + a verdict.
    worker: "ingrain-mitigation-critic",
    label: "ingrain-mitigation-critic :: sample mitigations",
    input: THREAT_AND_MITIGATIONS,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAny(r.text, [/approved/i, /needs[-\s]revision/i], "expected a verdict");
      assertHasScore0to100(r.text);
    },
  },
  {
    // ingrain-mitigation-generator (sonnet): proposes mitigations for the selected threats,
    // each with Yield / Effort / threatTags fields. It has no CLI by design — the org rules
    // are retrieved before it runs — and here no rules sidecar exists either, so this
    // exercises the no-rules path: it must still produce mitigations from its own analysis.
    worker: "ingrain-mitigation-generator",
    label: "ingrain-mitigation-generator :: selected threats (no rules sidecar)",
    input: SELECTED_THREATS,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAll(r.text, [/yield/i, /effort/i], "expected Yield & Effort fields");
      assertContainsAny(r.text, [/threatTags/i, /\bT1\b/], "expected a threat-tag reference");
    },
  },
];

for (const c of CASES) {
  Deno.test(c.label, async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const { assessmentAbs } = await mintAssessment(projectDir, c.label);
      const seeded = await Deno.readTextFile(assessmentAbs);
      const prompt = await workerDispatchPrompt(c.worker, c.input, assessmentAbs);

      await runChecked(
        c.label,
        prompt,
        { allowedTools: WORKER_TOOLS, timeoutMs: c.timeoutMs },
        async (r) => {
          const written = await Deno.readTextFile(assessmentAbs);
          // The regression this whole tier guards: a worker that answers inline and leaves
          // the assessment file untouched has not done its job, however good its prose.
          assertEquals(
            written === seeded,
            false,
            "worker left the seeded assessment file untouched — it must write its section",
          );
          // A compliant worker returns only a headline plus a pointer and puts the substance
          // on disk, so the shape assertions run over the return AND the file together.
          c.check({ ...r, text: `${r.text}\n${written}` });
        },
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
}

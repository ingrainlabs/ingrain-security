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
  assertBlockCarriedAcross,
  assertContainsAll,
  assertContainsAny,
  assertHasScore0to100,
  assertOnlyBlockFilled,
  assertRiskDescendsByTag,
  threatEntries,
} from "../lib/matchers.ts";
import { AGENT_TIMEOUT_MS, mintAssessment, workerDispatchPrompt } from "../lib/claudeRunner.ts";
import type { RunResult } from "../lib/types.ts";
import { runChecked } from "../lib/reporter.ts";
import {
  FROZEN_THREATS_BLOCKED,
  MAJOR_PLAN,
  RETRIEVED_RULES,
  SELECTED_THREATS,
  TASK_AND_THREATS_ON_DISK,
  TASK_AND_WEAK_MODEL,
  THREAT_AND_GUIDANCE,
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
  /**
   * Optional: write into the minted skeleton before the dispatch.
   *
   * Some workers do not receive their input as prose — the risk scorer reads `## Threats`
   * off disk, and its carry-across rule is only reachable if there are blocks on disk to
   * carry. Seeding the file is what makes that case testable at all.
   */
  seedFile?: (assessmentAbs: string) => Promise<void>;
  /**
   * Optional: assertions over the file **as written**, rather than over the added lines.
   *
   * `check` reads the worker's return plus the lines it added, which is right for shape
   * assertions on content. Block structure is a property of the whole entry — markers the
   * worker seeded and blocks it deliberately left alone — so it needs the file itself.
   */
  checkFile?: (written: string) => void;
}

/**
 * The lines a worker ADDED to the seeded skeleton. `seeded` is the file exactly as the mint
 * left it, so anything not in that set is the worker's own writing — headings, field cards
 * and pre-filled values all drop out.
 */
const addedLines = (written: string, seeded: string): string => {
  const before = new Set(seeded.split("\n"));
  return written.split("\n").filter((line) => !before.has(line)).join("\n");
};

// The two `ingrain-relevance-triage` cases that opened this table are gone with the worker.
// Its classification is now a question the orchestrator puts to the user, so there is no
// subagent to run in isolation and nothing here to replace them with: a question's behaviour
// is the orchestrator's, asserted statically over the flow file and end to end in
// `skill/trigger.test.ts`.
const CASES: AgentCase[] = [
  {
    // ingrain-threat-generator (sonnet): produces a threat list with stable tags T1, T2, …
    worker: "ingrain-threat-generator",
    label: "ingrain-threat-generator :: major plan",
    input: MAJOR_PLAN,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      // `T01`, zero-padded, per the schema — this asserted `\bT1\b` and so contradicted the
      // very shape the card mandates. A compliant worker failed it; the assertion was
      // measuring the wrong thing rather than the model doing the wrong thing.
      assertContainsAny(r.text, [/\bT01\b/], "expected a zero-padded 'T01' threat tag");
      assertEquals(r.text.trim().length > 100, true, "expected a non-trivial threat list");
    },
    // The producer-side half of the block model, and the only place it is reachable: whether
    // a live worker reading its reference file actually seeds all four markers and writes
    // into `#### gen` alone. Every other block assertion in this repo is static prose
    // checking, which cannot see what a model does with the prose.
    //
    // A worker that fills the other three with `—` fails here — that is the exact behaviour
    // the dispatch prompt used to instruct, and the reason it was reworded.
    checkFile: (written) =>
      assertOnlyBlockFilled(written, "gen", "the generator seeds four markers and fills gen"),
  },
  {
    // ingrain-risk-scorer (sonnet): scores each threat likelihood x impact (0-100), with
    // an overall criticality band, then re-tags the frozen list into descending-risk order.
    // The fixture's incoming tags are deliberately out of risk order, so a scorer that
    // leaves them alone fails the ordering assertion.
    worker: "ingrain-risk-scorer",
    label: "ingrain-risk-scorer :: frozen threats",
    input: TASK_AND_THREATS_ON_DISK,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAll(r.text, [/likelihood/i, /impact/i], "expected likelihood & impact labels");
      assertContainsAny(r.text, [/\b(low|medium|high|critical)\b/i], "expected a criticality band");
      assertRiskDescendsByTag(r.text, "expected the threats re-tagged into risk order");
    },
    // The scorer reads `## Threats` off disk, so seeding it is what makes the real dispatch
    // shape testable — and it is the only way to put blocks in front of the one worker whose
    // contract is to rewrite entries WHOLE.
    seedFile: async (assessmentAbs) => {
      const seeded = await Deno.readTextFile(assessmentAbs);
      await Deno.writeTextFile(
        assessmentAbs,
        seeded.replace("## Threats", FROZEN_THREATS_BLOCKED.replace(/^## Threats\n/, "## Threats")),
      );
    },
    // R-C, the one exception to "write only inside your own block": re-tagging moves entries,
    // so the scorer rewrites them whole and must carry every other block across verbatim. The
    // failure it guards is silent and expensive — a re-assessment that flattens `#### test`
    // erases a prior pass's verdict, and the entry then reads as never verified.
    checkFile: (written) => {
      // Membership first. The scorer reorders and re-tags; it never adds or drops. Asserted
      // explicitly because the first live run of this case DID drop one — the entry whose
      // `#### usergate` already carried `Selection: excluded`, which the scorer appears to
      // have read as a filter rather than as context travelling with the entry. Its
      // reference now says so outright; this is what holds that shut.
      assertEquals(
        threatEntries(written).length,
        2,
        "the scorer must return exactly the frozen set — it reorders, never adds or drops",
      );
      assertBlockCarriedAcross(written, "usergate", "Selection: excluded", "prior gate decision");
      assertBlockCarriedAcross(written, "test", "Robustness: adequate", "prior verdict");
      assertBlockCarriedAcross(written, "test", "services/auth/signup.ts:31", "prior evidence");
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
    // ingrain-guidance-critic (sonnet): scores coverage across both driver axes 0-100 + a verdict.
    worker: "ingrain-guidance-critic",
    label: "ingrain-guidance-critic :: sample guidance",
    input: THREAT_AND_GUIDANCE,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAny(r.text, [/approved/i, /needs[-\s]revision/i], "expected a verdict");
      assertHasScore0to100(r.text);
    },
  },
  {
    // ingrain-guidance-generator (sonnet): proposes guidance for the selected drivers, each
    // with Yield / Effort and the drivers it names. It has no CLI by design — the org rules
    // are retrieved before it runs — and here `## Org rules` is empty, so this exercises the
    // no-rules path: it must still produce threat-anchored guidance from its own analysis.
    worker: "ingrain-guidance-generator",
    label: "ingrain-guidance-generator :: selected threats (no org rules)",
    input: SELECTED_THREATS,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAll(r.text, [/yield/i, /effort/i], "expected Yield & Effort fields");
      assertContainsAny(r.text, [/threats/i, /\bT1\b/], "expected a threat driver reference");
    },
  },
  {
    // ingrain-rule-critic (haiku): judges each retrieved rule's applicability to THIS change
    // and returns a keep/prune line per rule. The credential-hashing rule governs a login
    // feature; the build-artifact retention rule plainly does not — the noise broad retrieval
    // produces, and what this round exists to remove before the user sees anything.
    worker: "ingrain-rule-critic",
    label: "ingrain-rule-critic :: retrieved rules, one applicable and one not",
    input: RETRIEVED_RULES,
    timeoutMs: AGENT_TIMEOUT_MS,
    check: (r) => {
      assertContainsAll(r.text, [/keep/i, /prune/i], "expected both verdicts across the rules");
      assertContainsAny(r.text, [/0f7b0e6f/, /c611c934/], "expected a rule id to key each line");
    },
  },
];

for (const c of CASES) {
  Deno.test(c.label, async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const { assessmentAbs } = await mintAssessment(projectDir, c.label);
      await c.seedFile?.(assessmentAbs);
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
          // on disk, so the shape assertions run over the return AND its writes together —
          // but over the WRITES ONLY, never the whole file.
          //
          // Concatenating `written` wholesale disarmed most of this tier: the seeded field
          // cards stay in the file by design, and they spell out the very vocabulary being
          // asserted. The `## Triage` card reads `Verdict: minor|major`, which passed a
          // verdict assertion whatever the model decided; `Impact (critical|high|
          // medium|low)` satisfied the impact/likelihood checks; `Yield`/`Effort` and the
          // 0–100 score came free the same way. Subtracting the skeleton leaves the worker's
          // own lines, which is what these assertions were always meant to read.
          c.check({ ...r, text: `${r.text}\n${addedLines(written, seeded)}` });
          // Block structure is a property of the whole entry, so it reads the file rather
          // than the added lines — a marker the worker deliberately left empty adds no line.
          c.checkFile?.(written);
        },
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
}

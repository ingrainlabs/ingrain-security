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
  assertOnlyBlockFilled,
} from "../lib/matchers.ts";
import { AGENT_TIMEOUT_MS, mintAssessment, workerDispatchPrompt } from "../lib/claudeRunner.ts";
import type { RunResult } from "../lib/types.ts";
import { runChecked } from "../lib/reporter.ts";
import { MAJOR_PLAN, RETRIEVED_RULES, TASK_AND_WEAK_MODEL } from "../lib/sampleInputs.ts";

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
//
// Three more left the same way in the speed-up — the risk scorer and the guidance
// generator/critic, whose steps moved into the orchestrator. The scorer's case is the one
// worth knowing where it went: its central assertion was that re-tagging moves entries
// WITHOUT disturbing the blocks it does not own, and that is now a deterministic script with
// a deterministic test (`hooks/threat-retag.test.ts`) rather than a live worker checked
// loosely. The same property, pinned harder and for free.
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

/**
 * Live resume behaviour — what survives when a run picks up a prior analysis.
 *
 * **Why this tier and not a static one.** Both properties here are things a model does with an
 * instruction, and both have a static guard elsewhere that cannot see whether it is obeyed:
 * `static/skill.test.ts` asserts the generator's resume block *says* to carry tags across, and
 * Phase 1/2 assert the rule bodies are *available* to a resumed run. A worker that reads either
 * instruction and renumbers anyway, or judges no rule at all, passes every one of those.
 *
 * **Unattended makes both ordinary.** Locally a re-review is rare; in CI every run after the
 * first is one, so a resume defect that is a curiosity on a laptop is the normal path in the
 * product this phase exists for.
 *
 * Live output varies, so each case reports and skips when it could not reach its subject — a
 * green run must never be a run that measured nothing.
 */

import { assertEquals } from "@std/assert";
import {
  AGENT_TIMEOUT_MS,
  mintAssessment,
  ORCHESTRATION_MAX_TURNS,
  ORCHESTRATION_TIMEOUT_MS,
  workerDispatchPrompt,
} from "../lib/claudeRunner.ts";
import { runChecked } from "../lib/reporter.ts";
import { threatEntries } from "../lib/matchers.ts";
import { MAJOR_PLAN } from "../lib/sampleInputs.ts";
import { MAJOR_PROJECT, projectWith } from "../lib/sampleProjects.ts";

const PRIOR_TITLE = "Resume fixture";
const RULE_AXIS_TITLE = "Rule axis resume";

const WORKER_TOOLS = ["Read", "Grep", "Glob", "Write", "Edit"];
const ORCHESTRATOR_TOOLS = ["Bash", "Read", "Grep", "Glob", "Write", "Edit", "Agent", "Task"];

/**
 * The prior analysis a resumed run seeds from.
 *
 * **The tags are deliberately GAPPED, and that is what makes the assertion discriminating.**
 * A renumbering generator emits `T01, T02, T03…` — so against a *contiguous* prior it produces
 * the very tags a correct carry-forward would, and the two behaviours are indistinguishable
 * from the output alone. With `T01`, `T03`, `T04` and `T07`–`T08` retired before this run
 * begins, a renumber lands on a tag that is neither carried nor free on its first entry.
 *
 * Gaps are also the *ordinary* state under BR-10 — a dropped threat's id is retired rather than
 * handed on — so this is the shape a second CI run actually sees, not a contrived one.
 *
 * **Scores run opposite to the tags**: `T02` is the least dangerous of the five and `T14` the
 * most. Before BR-10 that was an impossible state, because the tag WAS the rank.
 */
const PRIOR_THREATS: ReadonlyArray<{ tag: string; title: string; score: number }> = [
  { tag: "T02", title: "verbose error bodies leak the SQL statement", score: 12 },
  { tag: "T05", title: "session token is not rotated after password change", score: 34 },
  { tag: "T06", title: "login endpoint has no rate limit", score: 55 },
  { tag: "T09", title: "password compared with a plain string equality", score: 71 },
  { tag: "T14", title: "email lookup is string-interpolated into the query", score: 93 },
];

const priorEntry = (t: { tag: string; title: string; score: number }): string =>
  [
    `### ${t.tag} — ${t.title}`,
    "",
    "#### gen",
    "Asset: the login endpoint and the users table behind it",
    `Vector: ${t.title}`,
    `Description: ${t.title}, reachable from an unauthenticated request.`,
    "Assumptions: the endpoint is exposed to the public internet",
    "",
    "#### score",
    `Justification: carried from the prior pass; scored ${t.score} there.`,
    `Impact: ${t.score > 60 ? "high" : "medium"}`,
    `Likelihood: ${t.score > 60 ? "high" : "medium"}`,
    `Risk score: ${t.score}`,
    `Criticality: ${t.score > 60 ? "high" : "medium"}`,
    "",
    "#### usergate",
    "Selection: selected",
    "",
    "#### test",
    "",
  ].join("\n");

/** Fill a freshly minted skeleton with a prior Development pass. */
const seedPriorAnalysis = async (
  assessmentAbs: string,
  opts: { rules: boolean; title: string },
) => {
  let md = await Deno.readTextFile(assessmentAbs);

  const replaceSection = (heading: string, body: string) => {
    const start = md.indexOf(`\n${heading}\n`);
    if (start === -1) throw new Error(`prior fixture: no ${heading} in the minted skeleton`);
    const after = start + heading.length + 2;
    const rest = md.slice(after);
    const end = rest.search(/\n## /);
    const tail = end === -1 ? "" : rest.slice(end);
    md = `${md.slice(0, after)}${body}${tail}`;
  };

  // The card is an HTML comment and the parser discards it, so it is kept: a resumed worker
  // reads the shape off the card exactly as it would in a real run.
  const card = (heading: string): string => {
    const start = md.indexOf(`\n${heading}\n`) + heading.length + 2;
    const rest = md.slice(start);
    const close = rest.indexOf("-->");
    return close === -1 ? "" : `${rest.slice(0, close + 3)}\n`;
  };

  // VERBATIM the title this file was minted under. The mint is keyed on branch + task slug and
  // Testing re-mints from the recorded `## Task` Title, so a drifted one resolves to a
  // different, empty file — and the run routes back to Development instead of verifying.
  replaceSection(
    "## Task",
    `${card("## Task")}Title: ${opts.title}
Latest stage: development
Description: Add a login endpoint and store credentials.
Schema version: 2
`,
  );
  replaceSection(
    "## Triage",
    `${card("## Triage")}Verdict: major
Security relevant: true
Prior analysis: none
Surfaces:
- new login endpoint
- password storage
`,
  );
  replaceSection(
    "## Threats",
    `${card("## Threats")}${PRIOR_THREATS.map(priorEntry).join("\n")}`,
  );
  replaceSection(
    "## Risk score",
    `${card("## Risk score")}Score: 70
Criticality: high
`,
  );
  if (opts.rules) {
    replaceSection(
      "## Org rules",
      `${card("## Org rules")}### 0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f — Hash credentials at rest
Selection: selected
Passwords and other long-lived credentials are stored only as a slow, salted hash
(bcrypt or argon2id). Plaintext or reversible storage is never acceptable.

### 4a2c8d10-77b3-4e51-9f0a-2b6d5c1e8a34 — Rate-limit unauthenticated endpoints
Selection: selected
Every endpoint reachable without a session enforces a per-IP and per-account rate
limit, so credential stuffing is bounded rather than merely logged.
`,
    );
  }
  await Deno.writeTextFile(assessmentAbs, md);
};

/**
 * Every `T<nn>` heading the generator wrote, paired with its title, **in document order**.
 *
 * A list rather than a map: a map keyed on the tag silently collapses a duplicate, which is one
 * of the two defects below and the cheapest to detect.
 */
const writtenTags = (written: string): Array<{ tag: string; title: string }> =>
  threatEntries(written).flatMap((entry) => {
    const m = entry.match(/^### (T\d+)\s+—\s+(.+)$/m);
    return m === null ? [] : [{ tag: m[1], title: m[2].trim() }];
  });

Deno.test("resume: a carried-forward threat keeps the tag it arrived with (BR-10)", async () => {
  // The generator is where a tag is born and, on a resume, where it would be reassigned. A
  // script that merely stops renumbering would faithfully preserve whatever the generator had
  // already renumbered — so this is the half that has to be checked at the source, and the only
  // place a live model's handling of the resume instruction is observable.
  //
  // **ONE FILE, which is the shape that matters.** A real resume has `has_content: true`: the
  // prior analysis is the worker's own write target, `## Threats` is already populated, and it
  // rewrites the section in place. The two-file shape — a separate prior snapshot pointed at by
  // a `siblings` lookup — only occurs when the title was paraphrased, and testing that instead
  // measures the easy case: with the prior threats in a *different* file there is nothing for
  // the worker to overwrite. Every Development route but `fresh_task` arrives one-file.
  const projectDir = await Deno.makeTempDir();
  try {
    const target = await mintAssessment(projectDir, PRIOR_TITLE);
    await seedPriorAnalysis(target.assessmentAbs, { rules: false, title: PRIOR_TITLE });

    const input = [
      MAJOR_PLAN,
      "",
      `Prior analysis pointer: ${target.assessmentAbs} — the SAME file you are writing to.`,
      "Its `## Threats` already holds the prior analysis: carry forward the threats that still",
      "apply, re-derived against the plan above, and drop the ones the plan has moved past.",
    ].join("\n");

    await runChecked(
      "resume :: threat tags are permanent",
      await workerDispatchPrompt("ingrain-threat-generator", input, target.assessmentAbs),
      { allowedTools: WORKER_TOOLS, timeoutMs: AGENT_TIMEOUT_MS },
      async () => {
        const written = await Deno.readTextFile(target.assessmentAbs);
        const produced = writtenTags(written);
        if (produced.length === 0) {
          console.log(
            "SKIPPED (BR-10 resume): the generator wrote no readable threat entry, so no " +
              "tag was measured.",
          );
          return;
        }

        // No tag names two threats.
        const tags = produced.map((entry) => entry.tag);
        assertEquals(
          tags.length,
          new Set(tags).size,
          `a tag was written twice — an id names exactly one threat: [${tags.join(", ")}]`,
        );

        // **Asserted on the tag algebra, never on the titles.** A resumed generator RE-DERIVES
        // each surviving threat against the current plan, so its wording moves freely: a
        // genuine carry-forward of "password compared with a plain string equality" came back
        // as "submitted password compared against a stored value that is not a strong hash",
        // sharing two content words with its own prior — the same two that a genuinely NEW
        // session-token threat shared with a RETIRED one. Title overlap scores the carry and
        // the non-carry identically, so no threshold over it separates them, and a matcher
        // that guesses turns a correct run red. The tags themselves are exact.
        const priorTags = new Set(PRIOR_THREATS.map((t) => t.tag));
        const priorMax = Math.max(...PRIOR_THREATS.map((t) => Number(t.tag.slice(1))));
        const highest = `T${String(priorMax).padStart(2, "0")}`;

        for (const { tag, title } of produced) {
          // Each entry is one of exactly two things, and both are decidable from the tag: a
          // threat carried forward, wearing the id it arrived with; or a new one, taking the
          // next free id past the snapshot's highest. Anything else — above all a restart at
          // `T01` — is the renumber BR-10 exists to stop.
          assertEquals(
            priorTags.has(tag) || Number(tag.slice(1)) > priorMax,
            true,
            `${tag} ("${title}") is neither a tag the prior pass used [${
              [...priorTags].join(", ")
            }] nor past its highest (${highest}) — the resumed generator renumbered instead ` +
              "of carrying tags across, so a comment anchored on a tag now names a " +
              "different threat",
          );
        }

        if (!tags.some((tag) => priorTags.has(tag))) {
          console.log(
            "SKIPPED (BR-10 resume): the generator carried nothing forward — every threat it " +
              "wrote was new, so tag permanence across a resume was not exercised.",
          );
        }
      },
    );
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

Deno.test("resume: a Testing run judges the org rules it inherited", async () => {
  // Part 1 names the empty `## Rule adherence` as the failure that would otherwise pass every
  // test in the plan: Phase 1 asserts the bodies come back on the pull, Phase 2 asserts
  // `retrieve` rebuilds them byte-identical — and nothing asserted that a resumed Testing run
  // then JUDGES them. A run that skipped the rule axis entirely satisfies both of those.
  const projectDir = await projectWith(MAJOR_PROJECT);
  try {
    const seeded = await mintAssessment(projectDir, RULE_AXIS_TITLE);
    await seedPriorAnalysis(seeded.assessmentAbs, { rules: true, title: RULE_AXIS_TITLE });

    await runChecked(
      "resume :: the rule axis survives",
      "Verify the implementation against the recorded security analysis for this branch.\n\n" +
        "I am requesting that you dispatch the verifiers as subagents.",
      {
        cwd: projectDir,
        streamJson: true,
        allowedTools: ORCHESTRATOR_TOOLS,
        maxTurns: ORCHESTRATION_MAX_TURNS,
        timeoutMs: ORCHESTRATION_TIMEOUT_MS,
        env: {
          INGRAIN_SECURITY_UNATTENDED: "standalone",
          INGRAIN_SECURITY_BAND: "high",
        },
      },
      async () => {
        const written = await Deno.readTextFile(seeded.assessmentAbs);
        const start = written.indexOf("\n## Rule adherence\n");
        if (start === -1) {
          console.log(
            "SKIPPED (rule axis): the run left no `## Rule adherence` section at all, so it " +
              "did not reach the Testing finalize. Nothing was measured.",
          );
          return;
        }
        const body = written.slice(start).replace(/<!--[\s\S]*?-->/, "");
        const entries = [...body.matchAll(/^### ([0-9a-f-]{36})\s+—/gm)].map((m) => m[1]);

        if (entries.length === 0) {
          // This is the defect, stated as one: a resumed run that judged nothing.
          throw new Error(
            "`## Rule adherence` came back empty. Both org rules were `selected`, so a " +
              "Testing pass owes one verdict each — an empty section here is the silent " +
              "failure Part 1 names, not a state.",
          );
        }

        // One verdict per SELECTED rule, including a rule no guidance implements — which is
        // precisely the case a security owner needs judged rather than quietly dropped.
        for (
          const id of [
            "0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f",
            "4a2c8d10-77b3-4e51-9f0a-2b6d5c1e8a34",
          ]
        ) {
          assertEquals(
            entries.includes(id),
            true,
            `rule ${id} was selected but carries no adherence verdict`,
          );
        }
        assertEquals(
          /^Adherence:\s*(followed|not-followed)\s*$/m.test(body),
          true,
          "an adherence entry must carry a verdict, not just a heading",
        );
      },
    );
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

/**
 * Live unattended runs — the gates resolving with nobody there to answer them.
 *
 * **Why these are live and not static.** Every other Phase-3 guard in this repo checks that the
 * prose *says* the right thing: the band table is present, the fall-through is instructed, the
 * resume carries tags across. None of that can see what a model does with the prose, and the
 * whole premise of unattended mode is that the model resolves three gates by itself. A static
 * assertion that the skill tells it to take `Yes` passes whether or not a run does.
 *
 * **The band assertions are RELATIONAL, never absolute.** Nothing here says "T01 is selected" —
 * the model picks its own threats and its own scores, so a fixed expectation would be measuring
 * the model rather than the gate. What is asserted is the property the band exists to enforce:
 * every `selected` threat scores above the threshold and every `excluded` one does not. That
 * holds for any threat list the model produces, and it is exactly what breaks if the band is
 * ignored, mis-mapped, or applied with the comparison inverted.
 *
 * **Standalone throughout, and that is deliberate.** These cases are about the gate, not about
 * the platform: standalone takes its band from `INGRAIN_SECURITY_BAND`, which is what lets one
 * fixture run at all three bands and produce three different answers. A connected run would take
 * the org's band from a live platform, which is Phase 4's end-to-end and not reproducible here.
 *
 * Live model output varies, so a case that cannot reach its subject **reports and skips** rather
 * than failing — see `assertReachedGate`. A red result here means the gate resolved *wrongly*,
 * which is worth waking up for; a run that never got there is a flake and says so.
 */

import { assertEquals } from "@std/assert";
import {
  getRunner,
  mintAssessment,
  ORCHESTRATION_MAX_TURNS,
  ORCHESTRATION_TIMEOUT_MS,
  resolveHost,
} from "../lib/runners/index.ts";
import { runChecked } from "../lib/reporter.ts";
import { phaseBlocksOf, threatEntries } from "../lib/matchers.ts";
import { MAJOR_PLAN } from "../lib/sampleInputs.ts";
import {
  MAJOR_PROJECT,
  MAJOR_PROJECT_IMPLEMENTED,
  projectWith,
  SESSION_BRANCH_SLUG,
} from "../lib/sampleProjects.ts";

/**
 * The band → threshold table, READ FROM THE MINT rather than mirrored.
 *
 * A copy here would be a fourth authority — checked by nothing offline, since the static sweep
 * exempts `tests/`, so a divergence would surface only in this paid tier. `ingrain assessment
 * mint` resolves it and reports it, so the expectation and the run read the same source.
 */
const THRESHOLD: Record<string, number> = await (async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { json } = await mintAssessment(dir, "threshold probe", resolveHost());
    return {
      high: json.threshold_high as number,
      medium: json.threshold_medium as number,
      low: json.threshold_low as number,
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
})();

/**
 * The opening batch went through the CLI, not through git commands of the agent's own.
 *
 * `ingrain delta` and `ingrain assessment mint` each leave a branch-keyed file behind; an
 * agent that resolved the fork point or the assessment path itself leaves neither. Nothing
 * here pre-runs either — the threshold probe mints into a throwaway dir, and every session
 * dir is an untouched fixture — so their presence is the agent's own work.
 *
 * Checked before the gate, because the batch runs whether or not the run gets that far.
 */
const assertCliDroveTheBatch = async (projectDir: string, label: string): Promise<void> => {
  for (
    const [file, command] of [
      [`delta-${SESSION_BRANCH_SLUG}.json`, "ingrain delta"],
      [`current-${SESSION_BRANCH_SLUG}.json`, "ingrain assessment mint"],
    ]
  ) {
    const landed = await Deno.stat(`${projectDir}/.ingrain-security/${file}`)
      .then(() => true).catch(() => false);
    assertEquals(
      landed,
      true,
      `${label}: no ${file} — ${command} never ran, so the run reached the repository some other way`,
    );
  }
};

/**
 * Tools an unattended orchestrator needs: the shell for the `ingrain` CLI, the
 * read trio for the plan and repo, Write/Edit for the assessment, and the subagent primitive
 * for the worker fan-out.
 */
const ORCHESTRATOR_TOOLS = ["Bash", "Read", "Grep", "Glob", "Write", "Edit", "Agent", "Task"];

/**
 * The invoking prompt.
 *
 * **It answers ONE question and no more.** A session rule holds the subagent tool behind a user
 * request, and `references/lib/dispatch.md` says a request already in the invoking prompt *is*
 * the request — so supplying it is the user's side of a conversation, not a hint about the
 * subject under test. **The three gates are deliberately left unanswered**: they are what these
 * cases measure, and `unattended: true` is what must resolve them.
 */
const PROMPT = `Here is my implementation plan, ready to build. Run the security review.\n\n` +
  `I am requesting that you dispatch the workers as subagents.\n\n${MAJOR_PLAN}`;

/**
 * The same plan, already implemented on the branch — the posture CI reviews in.
 *
 * `PROMPT` says "ready to build", which is true for every case above and false for the
 * fall-through: told the code is unwritten AND handed a checkout without it, the model
 * declines to verify and says why — the right call on that input, and a failing assertion
 * on this one.
 */
const BUILT_PROMPT = `The plan below is implemented on this branch. Run the security review.\n\n` +
  `I am requesting that you dispatch the workers as subagents.\n\n${MAJOR_PLAN}`;

/** Every `## ` section body in a written assessment, keyed by heading. */
const sectionOf = (md: string, heading: string): string => {
  const start = md.indexOf(`\n${heading}\n`);
  if (start === -1) return "";
  const rest = md.slice(start + heading.length + 2);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
};

interface IGatedThreat {
  readonly tag: string;
  readonly score: number;
  readonly selection: string;
}

/** Each threat's risk score and gate decision, read out of the entry's own phase blocks. */
const gatedThreats = (written: string): IGatedThreat[] =>
  threatEntries(written).flatMap((entry) => {
    const blocks = phaseBlocksOf(entry);
    const body = (name: string) => blocks.find((b) => b.name === name)?.body ?? "";
    const score = body("score").match(/^Risk score:\s*(\d{1,3})\s*$/m)?.[1];
    const selection = body("usergate").match(/^Selection:\s*(\w+)\s*$/m)?.[1];
    const tag = entry.match(/^### (T\d+)\b/)?.[1];
    if (tag === undefined || score === undefined || selection === undefined) return [];
    return [{ tag, score: Number(score), selection }];
  });

/**
 * Announce and skip when a live run never reached the gate, rather than failing.
 *
 * A headless run can stop early for reasons that say nothing about the gate — a turn cap, a
 * refusal, a model that asked a question anyway. Failing on those buries the signal this tier
 * exists for under flakes; passing silently would let a run that gated NOTHING read as green.
 * So it returns false and prints exactly which half happened.
 */
const reachedGate = (written: string, label: string): boolean => {
  const gated = gatedThreats(written);
  if (gated.length > 0) return true;
  console.log(
    `SKIPPED (${label}): the run did not reach the threat gate — ` +
      `${threatEntries(written).length} threat entr(ies) written, none carrying both a ` +
      `Risk score and a Selection. Nothing about the band was measured.`,
  );
  return false;
};

for (const band of ["high", "medium", "low"] as const) {
  Deno.test(`unattended: the \`${band}\` band gates at ${THRESHOLD[band]}`, async () => {
    const projectDir = await projectWith(MAJOR_PROJECT);
    try {
      await runChecked(
        `unattended :: band ${band}`,
        PROMPT,
        {
          cwd: projectDir,
          streamJson: true,
          allowedTools: ORCHESTRATOR_TOOLS,
          maxTurns: ORCHESTRATION_MAX_TURNS,
          timeoutMs: ORCHESTRATION_TIMEOUT_MS,
          env: {
            INGRAIN_SECURITY_UNATTENDED: "standalone",
            INGRAIN_SECURITY_BAND: band,
          },
        },
        async () => {
          const path = `${projectDir}/.ingrain-security`;
          await assertCliDroveTheBatch(projectDir, `band ${band}`);

          const files = [...Deno.readDirSync(path)].filter((e) => e.name.endsWith(".md"));
          assertEquals(files.length > 0, true, "the run minted no assessment at all");
          const written = await Deno.readTextFile(`${path}/${files[0].name}`);

          if (!reachedGate(written, `band ${band}`)) return;
          const gated = gatedThreats(written);
          const threshold = THRESHOLD[band];

          // THE assertion: the band decided the selection, in both directions. Stated
          // relationally so it holds for whatever threats and scores the model produced.
          for (const threat of gated) {
            const expected = threat.score > threshold ? "selected" : "excluded";
            assertEquals(
              threat.selection,
              expected,
              `${threat.tag} scored ${threat.score} against the ${band} threshold of ` +
                `${threshold}, so it should read ${expected} — got ${threat.selection}`,
            );
          }

          // Sub-threshold threats are REPORTED, not dropped — the half of the trade that makes
          // a threshold acceptable at all.
          //
          // **Counted against the whole threat list, not against `gated`.** The obvious form of
          // this — filter `gated` to the sub-threshold ones and assert each reads `excluded` —
          // is worse than useless: `gated` is built from entries ALREADY IN THE FILE, so a run
          // that dropped what it decided against writes no such entries, the filter is empty,
          // and the loop asserts nothing while claiming to catch exactly that. It is also a
          // strict subset of the relational check above. What can see an absence is the
          // section's own entry count: every threat the generator wrote must still be here,
          // carrying a decision either way.
          const entries = threatEntries(written).length;
          assertEquals(
            gated.length,
            entries,
            `${entries} threat entries exist but only ${gated.length} carry a score and a ` +
              "decision — a sub-threshold threat was dropped or left ungated rather than " +
              "recorded as excluded",
          );

          // The review question resolved without a window — a run that stopped to ask has no
          // Verdict on disk, and one that answered `minor` would have ended the review.
          assertEquals(
            /^Verdict:\s*major\s*$/m.test(sectionOf(written, "## Triage")),
            true,
            "unattended Step 0 must take `Yes` and record `Verdict: major` without asking",
          );

          // The band and the threshold it applied are on the record, so a reader sees what the
          // run enforced instead of inferring it from the selections.
          const risk = sectionOf(written, "## Risk score");
          assertEquals(
            new RegExp(`^Gating band:\\s*${band}\\s*$`, "m").test(risk),
            true,
            `## Risk score must record \`Gating band: ${band}\` — got:\n${risk}`,
          );
          assertEquals(
            new RegExp(`^Gating threshold:\\s*${threshold}\\s*$`, "m").test(risk),
            true,
            `## Risk score must record \`Gating threshold: ${threshold}\` — got:\n${risk}`,
          );
        },
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
}

Deno.test("unattended: an unrecognised band degrades to `high`, the strictest", async () => {
  // SR-6 applied to a value rather than a step. A band that failed to resolve would leave the
  // gate with no threshold, and both ways of guessing are worse than holding the change to the
  // strictest bar the org's vocabulary has. The mint resolves this before the model sees it,
  // so what is under test here is that the RUN then gates at 25 rather than inventing a bar.
  const projectDir = await projectWith(MAJOR_PROJECT);
  try {
    await runChecked(
      "unattended :: unknown band",
      PROMPT,
      {
        cwd: projectDir,
        streamJson: true,
        allowedTools: ORCHESTRATOR_TOOLS,
        maxTurns: ORCHESTRATION_MAX_TURNS,
        timeoutMs: ORCHESTRATION_TIMEOUT_MS,
        env: {
          INGRAIN_SECURITY_UNATTENDED: "standalone",
          INGRAIN_SECURITY_BAND: "aggressive",
        },
      },
      async () => {
        const path = `${projectDir}/.ingrain-security`;
        const files = [...Deno.readDirSync(path)].filter((e) => e.name.endsWith(".md"));
        assertEquals(files.length > 0, true, "the run minted no assessment at all");
        const written = await Deno.readTextFile(`${path}/${files[0].name}`);

        if (!reachedGate(written, "unknown band")) return;
        for (const threat of gatedThreats(written)) {
          assertEquals(
            threat.selection,
            threat.score > 25 ? "selected" : "excluded",
            `${threat.tag} scored ${threat.score}; an unknown band must gate at high's 25`,
          );
        }
        assertEquals(
          /^Gating band:\s*high\s*$/m.test(sectionOf(written, "## Risk score")),
          true,
          "an unrecognised band must be RECORDED as the `high` it degraded to, not as itself",
        );
      },
    );
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

Deno.test("unattended standalone: no platform call, and a review anyway", async () => {
  // Standalone must skip `context security_rules` and both `record` calls. It is not inferable
  // from the CLI being present — unattended, it always is — so this is the assertion that the
  // MODE, rather than the environment, decided it.
  //
  // Asserted over the tool stream rather than over the file: a call that was made and failed
  // leaves no trace in the assessment, so the file cannot tell "skipped" from "attempted and
  // refused" — which is precisely the distinction under test.
  const projectDir = await projectWith(MAJOR_PROJECT);
  try {
    await runChecked(
      "unattended :: standalone",
      PROMPT,
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
      async (r) => {
        // Asserted over the backend's normalized tool uses rather than over the file: a call
        // that was made and failed leaves no trace in the assessment, so the file cannot tell
        // "skipped" from "attempted and refused" — which is precisely the distinction under
        // test. Both backends normalize their Bash-equivalent calls into `uses`.
        const commands = getRunner(r.host).bashCommands(r.uses);

        const platformCalls = commands.filter((cmd) =>
          /ingrain\s+context\s+security_rules/.test(cmd) || /ingrain\s+record\s+/.test(cmd)
        );
        // Cardinality FIRST: `events` is empty whenever the stream did not parse, and an
        // empty command list satisfies "made no platform call" without having looked at one.
        // The run cannot reach this gate without shelling out for the mint at least once.
        assertEquals(
          commands.length > 0,
          true,
          "no Bash command was observed at all — the stream did not parse, so the platform " +
            "assertion below would have examined nothing",
        );
        assertEquals(
          platformCalls,
          [],
          `standalone must reach the platform not at all — it ran:\n${platformCalls.join("\n")}`,
        );

        // Non-vacuous: the run has to have DONE something, or "made no platform call" is true
        // of a session that never started. The findings are the product standalone still ships.
        const path = `${projectDir}/.ingrain-security`;
        const files = [...Deno.readDirSync(path)].filter((e) => e.name.endsWith(".md"));
        assertEquals(files.length > 0, true, "the run minted no assessment at all");
        const written = await Deno.readTextFile(`${path}/${files[0].name}`);
        assertEquals(
          threatEntries(written).length > 0,
          true,
          "standalone drops the org-rule axis, never the threat review — it wrote no threats",
        );
      },
    );
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

Deno.test("unattended: Development falls through into Testing in one pass", async () => {
  // Attended, Development stops because the code does not exist yet. Unattended it never does:
  // the review runs against a checkout that HOLDS the implementation, so every condition
  // Testing routes on is already met, and a run that stopped at `record design` would hand
  // back an analysis of code it declined to look at.
  //
  // **The checkout is what makes that true, and the cases above do not have it.** Handed
  // `MAJOR_PROJECT` — the repository before the plan is built — the model reads `/health` and
  // a passwordless schema, reports that there is no login implementation to verify, and stops.
  // That is the skill working: Testing against unwritten code returns every threat weak for a
  // trivial reason.
  //
  // `Latest stage: testing` is the assertion because it is the one thing only the Testing
  // finalize writes — a Development pass that merely mentioned Testing leaves it at
  // `development`.
  const projectDir = await projectWith(MAJOR_PROJECT_IMPLEMENTED);
  try {
    await runChecked(
      "unattended :: fall-through",
      BUILT_PROMPT,
      {
        cwd: projectDir,
        streamJson: true,
        allowedTools: ORCHESTRATOR_TOOLS,
        maxTurns: ORCHESTRATION_MAX_TURNS,
        timeoutMs: ORCHESTRATION_TIMEOUT_MS,
        env: {
          INGRAIN_SECURITY_UNATTENDED: "standalone",
          // `high` so the gate is most likely to select something: the fall-through is skipped
          // when both gates chose nothing, and this case is about the fall-through rather than
          // about the band.
          INGRAIN_SECURITY_BAND: "high",
        },
      },
      async () => {
        const path = `${projectDir}/.ingrain-security`;
        const files = [...Deno.readDirSync(path)].filter((e) => e.name.endsWith(".md"));
        assertEquals(files.length > 0, true, "the run minted no assessment at all");
        const written = await Deno.readTextFile(`${path}/${files[0].name}`);

        if (!reachedGate(written, "fall-through")) return;
        const selected = gatedThreats(written).filter((t) => t.selection === "selected");
        if (selected.length === 0) {
          // The one legitimate reason not to fall through, and it has to be distinguished from
          // a failure to fall through — otherwise this case passes on a run that gated nothing.
          console.log(
            "SKIPPED (fall-through): the band selected no threat, which is exactly when the " +
              "fall-through is meant to be skipped. Nothing was measured.",
          );
          return;
        }

        assertEquals(
          /^Latest stage:\s*testing\s*$/m.test(sectionOf(written, "## Task")),
          true,
          "a run that gated drivers unattended must continue into Testing in the same pass, " +
            "leaving `Latest stage: testing`",
        );

        // And the verdicts are really there: a stage line moved without a verification behind
        // it is the failure this would otherwise pass over.
        const verdicts = threatEntries(written)
          .flatMap((entry) => phaseBlocksOf(entry))
          .filter((block) => block.name === "test" && /^Robustness:\s*\w+/m.test(block.body));
        assertEquals(
          verdicts.length > 0,
          true,
          "`Latest stage: testing` is set but no threat carries a Robustness verdict",
        );
      },
    );
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

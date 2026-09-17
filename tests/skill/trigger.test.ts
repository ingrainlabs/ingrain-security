/**
 * Skill behavior in a full session (skill + agents loaded — there are no hooks), under
 * **directed invocation**: every prompt names the skill, because that is how the product
 * reaches it — the CI entrypoint's one instruction is "run the skill", so the review the
 * product runs is always one the user asked for. Self-triggering on an ambient plan was what
 * these cases measured on one host, and no host is measured against that here: it belongs to
 * the model, not the skill, and the static tier owns what the prose promises about it.
 *
 * Still a pair by disposition, on the same directed shape: a security-relevant plan starts a
 * review; a trivial plan, directed anyway, records the `major` a user-asked run owes without
 * putting the question back. **A review the user requested is not re-asked** is the one live
 * branch — the step-0 question and its resolution are pinned statically
 * (`static/skill.test.ts`: the question is asked only when something other than the user
 * started the run).
 *
 * **Each run gets a project the plan actually describes.** These used to run in this
 * repository, where nothing the sample plans name exists — no hero button, no `POST /login`,
 * no README typo. A careful agent handed such a plan does not review it: it looks for the
 * targets, does not find them, and stops before editing rather than inventing them, so the
 * skill's work never starts. (The minor case additionally found `MINOR_PLAN` itself in
 * `lib/sampleInputs.ts` and reported the prompt as a test fixture — the same failure, more
 * explicitly.) Seeding the files is what puts the run back on the path under test.
 */

import { assertStringIncludes } from "@std/assert";
import { assertReviewStarted } from "../lib/matchers.ts";
import { SESSION_MAX_TURNS, SESSION_TIMEOUT_MS } from "../lib/runners/index.ts";
import { runChecked } from "../lib/reporter.ts";
import { MAJOR_PLAN, MINOR_PLAN } from "../lib/sampleInputs.ts";
import { MAJOR_PROJECT, MINOR_PROJECT, projectWith } from "../lib/sampleProjects.ts";

/** The directed invocation — the user names the skill, as the CI entrypoint will. */
const directed = (plan: string): string =>
  `Use Ingrain Security to review this plan before I build it:\n\n${plan}`;

Deno.test("trigger: directed, a security-relevant plan runs the review", async () => {
  const cwd = await projectWith(MAJOR_PROJECT);
  try {
    await runChecked(
      "skill trigger :: directed major plan",
      directed(MAJOR_PLAN),
      { streamJson: true, maxTurns: SESSION_MAX_TURNS, timeoutMs: SESSION_TIMEOUT_MS, cwd },
      async (r) => {
        assertReviewStarted(r);
        // And the artifact says so too — the mint is deterministic where announce wording is
        // the model's: a review that started seeded `.ingrain-security/` in the fixture. This
        // is the case's own non-vacuity floor: announce text alone could be a model mentioning
        // the skill without acting.
        const written = await assessmentsWritten(cwd);
        assertStringIncludes(
          written,
          "## Task",
          "the review started but minted no assessment — the opening batch never ran",
        );
      },
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

/** Every assessment the run minted, concatenated — empty when it minted none. */
async function assessmentsWritten(project: string): Promise<string> {
  let text = "";
  try {
    for await (const entry of Deno.readDir(`${project}/.ingrain-security`)) {
      if (!entry.isFile || !entry.name.startsWith("assessment")) continue;
      text += await Deno.readTextFile(`${project}/.ingrain-security/${entry.name}`);
    }
  } catch {
    // No folder is the same evidence as an empty one: nothing was written.
  }
  return text;
}

Deno.test("trigger: directed, a trivial plan still records `major` and carries on", async () => {
  const cwd = await projectWith(MINOR_PROJECT);
  try {
    await runChecked(
      "skill trigger :: directed minor plan",
      directed(MINOR_PLAN),
      // **The turn budget only fits on paper.** The case above stops once the review has
      // started; this one is the branch where a user ask carries on — mint, triage write,
      // driver chains. 11 turns was the measured run on the claude host; the timeout is the
      // backstop the real work fits inside (scaled per host by the backend).
      { streamJson: true, maxTurns: 11, timeoutMs: 240_000, cwd },
      async () => {
        // **A user-directed run takes `Yes` with no window.** Same fixture and opposite
        // origin to the retired ambient case: `MINOR_PLAN` is the sharp case because its OWN
        // recommendation is `No` — what is pinned is that the run's ORIGIN decides whether to
        // ask, and the recommendation only fills a window that a directed run never opens.
        //
        // Asserted on the artifact rather than on the transcript: whether the model narrates
        // the question it is declining to put comes down to phrasing, and an assertion on
        // phrasing is flaky. A written `major` cannot be reached through the question in a
        // run with no reply channel.
        const written = await assessmentsWritten(cwd);
        assertStringIncludes(
          written,
          "Verdict: major",
          "a review the user asked for must record `major` and carry on, not stop to ask",
        );
        assertStringIncludes(
          written,
          "Security relevant: true",
          "the verdict's companion field must agree with it",
        );
      },
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

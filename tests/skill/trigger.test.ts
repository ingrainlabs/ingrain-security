/**
 * Skill behavior in a full session (skill + agents + hook loaded). Verifies the
 * orchestrator starts the review on a security-relevant plan, and short-circuits
 * on a trivial one. Bounded turns keep these from running the whole cycle.
 *
 * **Each run gets a project the plan actually describes.** These used to run in this
 * repository, where nothing the sample plans name exists — no hero button, no `POST /login`,
 * no README typo. A careful agent handed such a plan does not review it: it looks for the
 * targets, does not find them, and stops before editing rather than inventing them, so the
 * skill's trigger never fires and the assertions read a refusal instead of a verdict. (The
 * minor case additionally found `MINOR_PLAN` itself in `lib/sampleInputs.ts` and reported the
 * prompt as a test fixture — the same failure, more explicitly.) Seeding the files is what
 * puts the run back on the path under test.
 */

import { assertEquals } from "@std/assert";
import { assertContainsAny, assertReviewStarted } from "../lib/matchers.ts";
import { dispatchedWorkers, SESSION_MAX_TURNS, SESSION_TIMEOUT_MS } from "../lib/claudeRunner.ts";
import { runChecked } from "../lib/reporter.ts";
import { MAJOR_PLAN, MINOR_PLAN } from "../lib/sampleInputs.ts";
import { MAJOR_PROJECT, MINOR_PROJECT, projectWith } from "../lib/sampleProjects.ts";

Deno.test("trigger: security-relevant plan starts the review", async () => {
  const cwd = await projectWith(MAJOR_PROJECT);
  try {
    await runChecked(
      "skill trigger :: major plan",
      `Here is my implementation plan, ready to build:\n\n${MAJOR_PLAN}`,
      { streamJson: true, maxTurns: SESSION_MAX_TURNS, timeoutMs: SESSION_TIMEOUT_MS, cwd },
      (r) => assertReviewStarted(r),
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

/** Every `### T<n>` threat entry in the assessment the run minted, if it minted one. */
async function threatsWritten(project: string): Promise<string[]> {
  const found: string[] = [];
  try {
    for await (const entry of Deno.readDir(`${project}/.ingrain-security`)) {
      if (!entry.isFile || !entry.name.startsWith("assessment")) continue;
      const text = await Deno.readTextFile(`${project}/.ingrain-security/${entry.name}`);
      for (const line of text.split("\n")) if (/^### T\d+\b/.test(line)) found.push(line);
    }
  } catch {
    // No folder is the same evidence as an empty one: no threat was written.
  }
  return found;
}

Deno.test("trigger: trivial plan stops at the review question", async () => {
  const cwd = await projectWith(MINOR_PROJECT);
  try {
    await runChecked(
      "skill trigger :: minor plan",
      `Here is my implementation plan, ready to build:\n\n${MINOR_PLAN}`,
      { streamJson: true, maxTurns: SESSION_MAX_TURNS, timeoutMs: SESSION_TIMEOUT_MS, cwd },
      async (r) => {
        // **The question is put, and nothing runs ahead of it.** That is the whole of what a
        // headless run can show, and it is exactly the property worth pinning: the review
        // question is Step 0's first act, before the prior-analysis lookup and before any
        // write.
        //
        // This used to assert the word "minor" instead. The verdict is the USER's answer, and
        // `--print` has no reply channel — so the run halts at the question having recorded
        // nothing, and whether the word appears comes down to whether the model happened to
        // name the option it was recommending. It did on one run and not the next. An
        // assertion on an answer nobody gave can only be flaky.
        assertContainsAny(
          r.text,
          [/run a security review for this change/i],
          "expected the run to reach Step 0's review question",
        );
        assertEquals(
          dispatchedWorkers(r.events).includes("ingrain-threat-generator"),
          false,
          "the review question must halt the run — no threat work before it is answered",
        );
        // And the artifact agrees: an unanswered question leaves the seeded skeleton empty.
        assertEquals(
          await threatsWritten(cwd),
          [],
          "threats were written before the review question was answered",
        );
      },
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

/**
 * Test set for the variant trigger-comparison harness (`tests/skillVariantTest/run.ts`).
 *
 * Each entry is a *simple implementation task* — phrased the way a user kicks off
 * coding work, NOT a finished plan. The point is to exercise the real path: the
 * agent plans the task, and the skill variant under test decides whether and when
 * to trigger the security review. Compare that decision across variants by running
 * the same task in each.
 *
 * Includes deliberately security-relevant tasks (a variant *should* trigger) and a
 * trivial one (a well-formed variant should *stay quiet*), so over- and
 * under-triggering both show up.
 */

/** A single implementation-task prompt to drive a variant run. */
export interface TTaskPrompt {
  /** Stable id used on the command line (`deno task variants -- <id>`). */
  id: string;
  /** Short human label for the summary table. */
  label: string;
  /** The prompt fed to `claude` as the initial user message. */
  prompt: string;
}

export const TASK_PROMPTS: TTaskPrompt[] = [
  {
    id: "login-endpoint",
    label: "Add a login endpoint (security-relevant)",
    prompt: "Add a POST /login endpoint to our API. It should accept an email and password, " +
      "look the user up in the database, verify the password, and on success return a " +
      "session token the client can use for later requests. Plan the implementation.",
  },
  {
    id: "file-upload",
    label: "Add avatar file upload (security-relevant)",
    prompt: "Let users upload a profile avatar image. Add an endpoint that accepts the file, " +
      "stores it on disk under a public uploads folder, and returns its URL. Plan the " +
      "implementation.",
  },
  {
    id: "rename-button",
    label: "Cosmetic copy change (should stay quiet)",
    prompt: "On the settings page, rename the 'Save' button to 'Save changes' and nudge its " +
      "font-size up by 1px. Plan the implementation.",
  },
];

/** Look up a task by id; returns undefined if not found. */
export const findTask = (id: string): TTaskPrompt | undefined =>
  TASK_PROMPTS.find((t) => t.id === id);

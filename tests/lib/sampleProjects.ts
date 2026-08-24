/**
 * Throwaway repositories for the live session tests, paired with the plans in `sampleInputs.ts`.
 *
 * **A plan needs a repo that contains what it describes.** Handed a plan whose targets are
 * nowhere in the working tree, a careful agent does not review it: it looks for them, does not
 * find them, and stops before editing rather than inventing them — so the skill's trigger never
 * fires, or fires and halts, and the assertions read a refusal instead of the behaviour under
 * test. Both live session tiers hit this: `trigger` measured a run that never started, and
 * `orchestration` measured one that never reached its workers.
 *
 * Shared rather than duplicated per test file because the pairing is the point — a plan and the
 * repo it targets drift apart silently, and the symptom (an empty worker list, a refusal) looks
 * nothing like the cause.
 */

/** A disposable git repo holding `files`, ready to be handed to a session as its cwd. */
export async function projectWith(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-session-" });
  for (const [name, body] of Object.entries(files)) {
    await Deno.writeTextFile(`${dir}/${name}`, body);
  }
  // A repo rather than a bare directory: the mint resolves the project root from git and slugs
  // the branch into the assessment's name, so a non-git cwd routes the run somewhere else
  // entirely. git is driven THROUGH the spawned bash, which keeps this inside the live tiers'
  // `--allow-run=claude,bash` profile — Deno gates only directly-spawned processes.
  await new Deno.Command("bash", {
    args: [
      "-c",
      `cd "${dir}" && git init -q -b feature/session . && git add -A && ` +
      `git -c user.email=t@t -c user.name=T commit -qm seed`,
    ],
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: dir },
  }).output();
  return dir;
}

/** What `MAJOR_PLAN` says it will change: a login route and the users table it queries. */
export const MAJOR_PROJECT: Record<string, string> = {
  "server.js": [
    "const express = require('express');",
    "const app = express();",
    "app.get('/health', (req, res) => res.send('ok'));",
    "module.exports = app;",
  ].join("\n"),
  "schema.sql": "CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL);\n",
};

/** What `MINOR_PLAN` says it will change: the hero button's styling and a README typo. */
export const MINOR_PROJECT: Record<string, string> = {
  "README.md": "# Landing\n\nWe recieve your feedback gladly.\n",
  "index.html": '<div class="hero"><button class="hero-btn">Go</button></div>\n',
  "style.css": ".hero-btn { background: #1d4ed8; font-size: 14px; padding: 8px 16px; }\n",
};

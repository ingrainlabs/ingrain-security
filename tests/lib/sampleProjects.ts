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

/**
 * A disposable git repo holding `files`, ready to be handed to a session as its cwd.
 *
 * **Two branches and a real fork point, not one commit.** A single-commit repo on one branch has
 * no branch to diff against: `ingrain delta` reports `fallback: true`, `reason: no-fork-point`,
 * `delta_empty: true`, and the whole Testing half of the skill correctly refuses to run — it
 * says "no changes to verify" and stops, and Phase select routes to `requires_judgement`. Any
 * test whose subject is downstream of a delta then measures a refusal instead, and — worse —
 * an assertion about verification can only pass if the model *disobeys* the skill.
 *
 * So `main` holds the seed and `feature/session` holds one commit on top: `delta_empty: false`
 * with a resolvable merge-base, which is the shape a real pull request has.
 */
/** The session branch, and its slug — what every artifact the CLI writes is named for. */
export const SESSION_BRANCH = "feature/session";
export const SESSION_BRANCH_SLUG = "feature-session";

export async function projectWith(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-session-" });
  await Deno.writeTextFile(`${dir}/README.md`, "# fixture\n");
  // git is driven THROUGH the spawned bash, which keeps this inside the live tiers'
  // `--allow-run=claude,bash` profile — Deno gates only directly-spawned processes.
  const git = (script: string) =>
    new Deno.Command("bash", {
      args: ["-c", `cd "${dir}" && ${script}`],
      clearEnv: true,
      env: { PATH: Deno.env.get("PATH") ?? "", HOME: dir },
    }).output();

  const commit = `git -c user.email=t@t -c user.name=T commit -q`;
  // `main` first, carrying only the README — so every file the caller asked for lands in the
  // branch's own delta rather than in its base.
  await git(`git init -q -b main . && git add -A && ${commit} -m base`);
  await git(`git checkout -q -b ${SESSION_BRANCH}`);
  for (const [name, body] of Object.entries(files)) {
    await Deno.writeTextFile(`${dir}/${name}`, body);
  }
  await git(`git add -A && ${commit} -m work`);
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

/**
 * `MAJOR_PLAN` **already built**, which is the shape CI reviews: a pull request carries the
 * implementation, so Development gates its drivers and Testing has code to judge in the same
 * pass. `MAJOR_PROJECT` is the same repository *before* that work, where a fall-through would
 * verify an implementation that does not exist and report every threat weak for a trivial
 * reason — which is what the model does when handed it, correctly.
 *
 * The implementation is deliberately **flawed in the ways the plan's own threats predict** —
 * interpolated SQL, a plaintext password comparison, a `Math.random` token — so the verifiers
 * have something real to find. A clean implementation would make a passing run indistinguishable
 * from one that verified nothing.
 */
export const MAJOR_PROJECT_IMPLEMENTED: Record<string, string> = {
  "server.js": [
    "const express = require('express');",
    "const db = require('./db');",
    "const app = express();",
    "app.use(express.json());",
    "",
    "app.get('/health', (req, res) => res.send('ok'));",
    "",
    "app.post('/login', async (req, res) => {",
    "  const { email, password } = req.body;",
    "  const user = await db.query(",
    "    `SELECT id, password FROM users WHERE email = '${email}'`,",
    "  );",
    "  if (!user || user.password !== password) return res.status(401).send('no');",
    "  const token = Math.random().toString(36).slice(2);",
    "  await db.query(",
    "    `INSERT INTO sessions (user_id, token) VALUES (${user.id}, '${token}')`,",
    "  );",
    "  res.json({ token });",
    "});",
    "",
    "module.exports = app;",
  ].join("\n"),
  "schema.sql": [
    "CREATE TABLE users (",
    "  id SERIAL PRIMARY KEY,",
    "  email TEXT NOT NULL,",
    "  password TEXT NOT NULL",
    ");",
    "CREATE TABLE sessions (user_id INTEGER NOT NULL, token TEXT NOT NULL);",
  ].join("\n"),
};

/** What `MINOR_PLAN` says it will change: the hero button's styling and a README typo. */
export const MINOR_PROJECT: Record<string, string> = {
  "README.md": "# Landing\n\nWe recieve your feedback gladly.\n",
  "index.html": '<div class="hero"><button class="hero-btn">Go</button></div>\n',
  "style.css": ".hero-btn { background: #1d4ed8; font-size: 14px; padding: 8px 16px; }\n",
};

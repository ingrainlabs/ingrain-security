/**
 * **Every command the skill tells the agent to run must actually run.**
 *
 * The skill's docs and the scripts they invoke are edited independently — a subcommand
 * renamed here, a flag dropped there — and nothing connected the two. The failure is silent
 * on both sides: the script keeps passing its own tests, the markdown keeps rendering, and
 * the first thing that notices is a live run whose opening batch exits 2.
 *
 * So the invocations are marked machine-recognizably. A fence tagged **`ingrain-script`**
 * holds one runnable invocation of a bundled script per line, and this tier does the only
 * check that cannot go stale: it **executes each one** against a throwaway git repo and
 * requires exit 0 and parseable JSON. A renamed script, a renamed subcommand, a dropped flag
 * or a moved path all fail here, on the documentation's own text.
 *
 * The fence tag is the contract. Prose *about* a script is still prose; only a tagged fence
 * claims "this is runnable", and only tagged fences are run.
 */

import { assert, assertEquals, assertGreaterOrEqual } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL_ROOT = `${ROOT}skills/ingrain-security/`;

/** The fence info-string that marks a block as runnable invocations of our own scripts. */
const FENCE_TAG = "ingrain-script";

/**
 * Placeholders the docs use so a command reads generically, and the concrete values this
 * harness substitutes. `<plugin>` is the only one whose value must be real — the rest just
 * have to be well-formed, because what is under test is the script's argument grammar.
 */
const SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
  ["<plugin>", ROOT.replace(/\/$/, "")],
  ["<host>", "claude"],
  ["<task title>", "Parity harness task"],
  ["<same title>", "Parity harness task"],
  // The ref a real run pins from `branch-delta`'s own JSON. `HEAD` is the one value that
  // resolves in any checkout, including this repo's — and left unsubstituted it is not a
  // wrong ref but a bash redirect, so the fence would fail on syntax rather than on grammar.
  ["<diff_ref>", "HEAD"],
  ["path/to/file.ts", "README.md"],
  // The path a real run pastes in from the mint. Relative, so it resolves inside the throwaway
  // project this harness runs each command in — and pointing at a file that is NOT there, which
  // `threat-retag` reports as `retagged: false` with a reason rather than failing. That is the
  // documented degraded case, and it is the one this tier can reach: the fence's job is the
  // argument grammar, while the re-tag's behaviour is `tests/hooks/threat-retag.test.ts`'s.
  ["<assessment_abs>", ".ingrain-security/assessment-parity-harness.md"],
];

interface IInvocation {
  /** Repo-relative path of the doc that carries it. */
  doc: string;
  /** 1-indexed line of the command within that doc. */
  line: number;
  /** The command as written, placeholders intact. */
  source: string;
}

/**
 * Every agent-facing markdown file: `SKILL.md` plus everything under `references/`. Human
 * docs (the repo README) are deliberately out of scope — they describe the plugin to a
 * reader rather than handing an agent a command to run.
 */
async function agentFacingDocs(): Promise<string[]> {
  const docs = [`${SKILL_ROOT}SKILL.md`];
  for await (const entry of walk(`${SKILL_ROOT}references`, { exts: [".md"] })) {
    if (entry.isFile) docs.push(entry.path);
  }
  return docs.sort();
}

/**
 * Pull every line of every `ingrain-script` fence out of one doc.
 *
 * Fences are matched after leading whitespace, because a step written as a numbered list item
 * indents its fence — and a column-0-only scan silently skipped exactly those, which is the
 * whole contract this tier exists to enforce. Commands are trimmed either way, so an indented
 * fence runs the same command a top-level one does.
 */
function invocationsIn(doc: string, text: string): IInvocation[] {
  const found: IInvocation[] = [];
  let inFence = false;
  text.split("\n").forEach((raw, index) => {
    const marker = raw.trimStart();
    if (marker.startsWith("```")) {
      // A closing fence carries no info string, so the tag test also ends the block.
      inFence = !inFence && marker.slice(3).trim() === FENCE_TAG;
      return;
    }
    if (inFence && raw.trim()) {
      found.push({ doc, line: index + 1, source: raw.trim() });
    }
  });
  return found;
}

/** Substitute the doc placeholders for values this harness can actually run. */
function runnable(source: string): string {
  return SUBSTITUTIONS.reduce((cmd, [from, to]) => cmd.replaceAll(from, to), source);
}

/**
 * A throwaway git repo to run against, so a mint writes its skeleton somewhere disposable
 * rather than into this checkout's own `.ingrain-security/`.
 *
 * git is set up THROUGH the spawned bash rather than as its own `Deno.Command`, which keeps
 * the tier inside `--allow-run=bash` — Deno gates only directly-spawned processes.
 */
async function throwawayProject(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-parity-" });
  await new Deno.Command("bash", {
    args: [
      "-c",
      // A tracked file AND an uncommitted edit to it. Both are load-bearing: the documented
      // `diff` invocations name a path, and the script refuses one it cannot find — while a
      // clean tree would make `diff --ref HEAD` legitimately empty, and an empty diff cannot
      // tell "ran correctly" apart from "did nothing".
      // The identity flags are on EVERY commit: HOME points at the temp dir, so there is no
      // global git config to fall back on and an unconfigured commit fails — which, in an
      // `&&` chain, silently skips everything after it.
      `cd "${dir}" && git init -q -b feature/parity . && ` +
      `git -c user.email=t@t -c user.name=T commit -q --allow-empty -m init && ` +
      `printf 'seed\\n' > README.md && git add README.md && ` +
      `git -c user.email=t@t -c user.name=T commit -qm seed && printf 'edit\\n' >> README.md`,
    ],
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: dir },
  }).output();
  return dir;
}

const DOCS = await agentFacingDocs();
const INVOCATIONS: IInvocation[] = [];
for (const doc of DOCS) {
  INVOCATIONS.push(...invocationsIn(relative(ROOT, doc), await Deno.readTextFile(doc)));
}

Deno.test("discovery: the docs carry tagged invocations at all", () => {
  // Without this the whole tier passes by finding nothing — the exact way a parity suite
  // goes green and vacuous when a fence tag is renamed or a doc is restructured.
  assertGreaterOrEqual(
    INVOCATIONS.length,
    4,
    `expected the \`${FENCE_TAG}\` fences to yield commands; found ${INVOCATIONS.length}`,
  );
});

Deno.test("every bundled script is invoked by at least one doc", async () => {
  const invoked = INVOCATIONS.map((i) => i.source).join("\n");
  const missing: string[] = [];
  for await (const entry of Deno.readDir(`${SKILL_ROOT}scripts`)) {
    // `lib/` holds sourced files, which are never invoked directly.
    if (!entry.isFile) continue;
    if (!invoked.includes(`scripts/${entry.name}`)) missing.push(entry.name);
  }
  assertEquals(
    missing,
    [],
    `bundled but named by no \`${FENCE_TAG}\` fence, so nothing tells the agent it exists: ` +
      missing.join(", "),
  );
});

for (const invocation of INVOCATIONS) {
  Deno.test(`runs as documented: ${invocation.doc}:${invocation.line}`, async () => {
    const project = await throwawayProject();
    try {
      const out = await new Deno.Command("bash", {
        args: ["-c", runnable(invocation.source)],
        cwd: project,
        clearEnv: true,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          HOME: project,
          CLAUDE_PROJECT_DIR: project,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      const stdout = new TextDecoder().decode(out.stdout);
      const stderr = new TextDecoder().decode(out.stderr);
      assertEquals(
        out.code,
        0,
        `the documented command failed:\n  ${invocation.source}\n  stderr: ${stderr.trim()}`,
      );
      // Exit 0 alone would pass on a script that printed a usage banner and gave up, so the
      // shape of the answer is asserted too. Two shapes exist deliberately: the facts a caller
      // routes on are JSON, and a diff is text — a unified diff inside a JSON string is
      // unreadable, and a file list as loose text has to be re-parsed. Both are checked; what
      // neither may be is empty, which is what "ran but did nothing" looks like.
      assert(
        stdout.trim().length > 0,
        `the documented command produced no output:\n  ${invocation.source}`,
      );
      if (stdout.trimStart().startsWith("{")) {
        const parsed = JSON.parse(stdout);
        assert(
          parsed && typeof parsed === "object",
          `expected one JSON object from:\n  ${invocation.source}`,
        );
      }
    } finally {
      await Deno.remove(project, { recursive: true });
    }
  });
}

/**
 * **The hook's injected commands must run too.**
 *
 * The fences above cover `SKILL.md` and `references/`. They do not cover the SessionStart hook,
 * which is where the agent actually receives its ready-to-run commands — and that gap let a
 * deleted subcommand survive in the injected text while every tier stayed green. The first tool
 * call of a real run exited 2 (audit C1).
 *
 * So the same contract applies here: harvest what the hook injects, and execute it.
 */
const SESSION_START = `${ROOT}hooks/scripts/session-start`;

/** Run the hook and return the command lines it injects into the session context. */
async function injectedCommands(project: string): Promise<string[]> {
  const { stdout } = await new Deno.Command("bash", {
    args: [SESSION_START, "claude"],
    cwd: project,
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: project, CLAUDE_PROJECT_DIR: project },
    stdout: "piped",
    stderr: "piped",
  }).output();

  // The hook's context block carries its two substituted commands and nothing else — it no
  // longer inlines `SKILL.md`, whose `<plugin>`-placeholder fences the tests above already
  // execute on their own. The placeholder filter is kept regardless: it costs nothing, and it is
  // what stops a re-inlined SKILL.md from quietly feeding unsubstituted fences into this
  // harness. Matching on the script path rather than on the block's framing keeps this working
  // if the surrounding prose is reworded.
  return new TextDecoder().decode(stdout)
    .split("\\n")
    .map((l) => l.replaceAll('\\"', '"').trim())
    .filter((l) =>
      l.startsWith("bash ") &&
      l.includes("skills/ingrain-security/scripts/") &&
      !l.includes("<plugin>")
    );
}

Deno.test("every command the SessionStart hook injects actually runs", async () => {
  const project = await throwawayProject();
  try {
    const commands = await injectedCommands(project);

    // Discovery floor first: without it the test passes by finding nothing, which is exactly
    // how a reworded hook would go green and vacuous.
    assertGreaterOrEqual(
      commands.length,
      2,
      `expected the hook to inject the bundled script commands; found ${commands.length}`,
    );

    for (const command of commands) {
      // The injected form carries a `<task title>` placeholder for the agent to fill.
      const runnable = command.replaceAll("<task title>", "Parity harness task");
      const out = await new Deno.Command("bash", {
        args: ["-c", runnable],
        cwd: project,
        clearEnv: true,
        env: { PATH: Deno.env.get("PATH") ?? "", HOME: project, CLAUDE_PROJECT_DIR: project },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(
        out.code,
        0,
        `the hook injects a command that does not run:\n  ${runnable}\n  stderr: ${
          new TextDecoder().decode(out.stderr).trim()
        }`,
      );
      JSON.parse(new TextDecoder().decode(out.stdout));
    }
  } finally {
    await Deno.remove(project, { recursive: true });
  }
});

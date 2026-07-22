/**
 * Runs ShellCheck over every shell script committed to the repo — the hooks, the
 * assessment-path minter and the release scripts. Offline, no model calls.
 *
 * Discovery is shebang-based rather than extension-based on purpose: the hook scripts
 * are deliberately extensionless (see `hooks/run-hook.cmd` for why), so a `*.sh` glob
 * would silently lint only the three release scripts and miss every hook.
 *
 * Lint settings live in the repo-root `.shellcheckrc` — notably `source-path=SCRIPTDIR`,
 * which lets ShellCheck follow the `# shellcheck source=...` directives the hooks use to
 * pull in their shared libs.
 *
 * Requires `shellcheck` on PATH (`brew install shellcheck`); CI installs a pinned build before
 * running `deno task ci`, so this is the only place the shell lint is defined.
 */

import { assert, assertEquals, assertGreaterOrEqual } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Polyglot bat/bash wrapper for Windows — not a lintable bash script. */
const EXCLUDED = new Set(["hooks/run-hook.cmd"]);

/**
 * Scripts that must always be linted. Guards against a discovery bug quietly
 * shrinking the set to nothing and leaving the suite green but vacuous.
 */
const EXPECTED = [
  ".github/release.sh",
  "hooks/claude/allow-assessment-write",
  "hooks/start/session-start",
  "skills/ingrain-security/scripts/lib/artifact-template.sh",
  "skills/ingrain-security/scripts/lib/project-root.sh",
  "skills/ingrain-security/scripts/lib/mint-path.sh",
  "skills/ingrain-security/scripts/rules-path",
  "skills/ingrain-security/scripts/branch-diff",
];

/**
 * True if the file is shell: it declares a bash/sh shebang, or is named `*.sh` (which
 * catches the sourced libs, who have no shebang by design).
 *
 * Reads the file rather than trusting the path, so an index entry with no file behind it
 * is skipped — `git ls-files` lists staged-but-deleted paths, and mid-rename those would
 * otherwise reach ShellCheck as a "does not exist" fatal.
 */
async function isShellScript(path: string): Promise<boolean> {
  let firstLine: string;
  try {
    firstLine = (await Deno.readTextFile(`${ROOT}${path}`)).split("\n", 1)[0];
  } catch {
    return false; // no file on disk, or unreadable/binary — not ours to lint
  }
  return path.endsWith(".sh") || /^#!.*\b(bash|sh)\b/.test(firstLine);
}

/**
 * Lints one script, returning ShellCheck's exit code and its report.
 *
 * Runs from ROOT so the repo-root `.shellcheckrc` applies whatever the runner's cwd.
 * A missing binary is the one failure worth rewriting: bare `NotFound` says nothing
 * about which of the two spawned commands vanished, or how to fix it.
 */
async function runShellCheck(path: string): Promise<{ code: number; report: string }> {
  try {
    const { code, stdout } = await new Deno.Command("shellcheck", { args: [path], cwd: ROOT })
      .output();
    return { code, report: new TextDecoder().decode(stdout) };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(
        "`shellcheck` is not on PATH — install it (`brew install shellcheck`) and re-run `deno task test:shell`.",
      );
    }
    throw err;
  }
}

/**
 * Every shell script tracked by git. Using `git ls-files` keeps the lint contract at
 * "what is committed", so gitignored scratch scripts under `.helpers/` and
 * `tests/.variant-runs/` are excluded for free.
 */
async function discoverShellScripts(): Promise<string[]> {
  const { stdout } = await new Deno.Command("git", {
    args: ["ls-files"],
    cwd: ROOT,
  }).output();

  const tracked = new TextDecoder().decode(stdout).split("\n").filter(Boolean);

  const scripts: string[] = [];
  for (const path of tracked) {
    if (EXCLUDED.has(path)) continue;
    if (await isShellScript(path)) scripts.push(path);
  }
  return scripts.sort();
}

const scripts = await discoverShellScripts();

Deno.test("discovery: finds the committed shell scripts, and not the polyglot wrapper", () => {
  // The hooks are extensionless, so a healthy scan finds far more than the 3 *.sh
  // release scripts. Anything less means discovery has regressed to extension-matching.
  assertGreaterOrEqual(scripts.length, EXPECTED.length);
  for (const path of EXPECTED) {
    assert(scripts.includes(path), `expected ${path} to be linted, got: ${scripts.join(", ")}`);
  }
  assert(!scripts.includes("hooks/run-hook.cmd"), "the bat/bash polyglot must not be linted");
});

for (const path of scripts) {
  Deno.test(`shellcheck: ${path}`, async () => {
    const { code, report } = await runShellCheck(path);

    // ShellCheck's own report already names the line, column and rule, and links its
    // wiki — surface it verbatim rather than restating it.
    assertEquals(code, 0, `\n${report}`);
  });
}

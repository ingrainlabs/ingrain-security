/**
 * Runs ShellCheck over every shell script committed to the repo — the hooks, the
 * assessment mint and the release scripts. Offline, no model calls.
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
 *
 * Discovery is `git ls-files`, so this list can only name TRACKED files — which is also the
 * gap it once could not close: discovery was `git ls-files`, so an unstaged or freshly renamed
 * script was silently unlinted and equally absent from here. Discovery now walks the tree, so
 * this list names every script regardless of index state — and a file dropping out of it is a
 * real regression rather than a staging artifact.
 */
const EXPECTED = [
  ".github/release.sh",
  "hooks/claude/allow-assessment-write",
  "hooks/codex/allow-assessment-write",
  "hooks/scripts/lib/assessment-write.sh",
  "hooks/scripts/ensure-assessment-dir",
  "hooks/scripts/session-start",
  "skills/ingrain-security/scripts/assessment-mint",
  "skills/ingrain-security/scripts/branch-delta",
  "skills/ingrain-security/scripts/lib/artifact-template.sh",
  "skills/ingrain-security/scripts/lib/assessment-dir.sh",
  "skills/ingrain-security/scripts/lib/fork-point.sh",
  "skills/ingrain-security/scripts/lib/json.sh",
  "skills/ingrain-security/scripts/lib/mint.sh",
  "skills/ingrain-security/scripts/lib/project-root.sh",
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
 * Every shell script in the tree — walked from disk, not asked of git.
 *
 * It used to be `git ls-files`, which scoped the lint contract to "what is committed". That
 * quietly excluded exactly the code most worth linting: a NEW script is unlinted until it is
 * staged, and a RENAMED one is unlinted under both names at once — git tracks the old path as
 * deleted and the new one not at all. Four of the newest files, ~350 lines carrying all of the
 * argv parsing and JSON assembly, were invisible here while the suite reported green.
 *
 * The walk is what `parity/sourceGraph.test.ts` already does, which is why that tier covered
 * them throughout. `SKIPPED_DIRS` replaces what gitignore used to do for free.
 */
const SKIPPED_DIRS = new Set([".git", "node_modules", ".helpers", ".variant-runs"]);

async function discoverShellScripts(dir = ROOT, prefix = ""): Promise<string[]> {
  const scripts: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      scripts.push(...await discoverShellScripts(`${dir}${entry.name}/`, rel));
      continue;
    }
    if (!entry.isFile) continue;
    if (EXCLUDED.has(rel)) continue;
    if (await isShellScript(rel)) scripts.push(rel);
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

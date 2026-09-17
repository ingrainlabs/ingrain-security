/**
 * Runs ShellCheck over every shell script committed to the repo, which since the plugin
 * became prose-only means the three release scripts under `.github/`. Offline, no model
 * calls.
 *
 * **The tier is retained rather than deleted with the scripts it used to lint.** Those
 * scripts are what cut a release, so dropping the tier would silently stop linting the
 * one executable surface the repo still has.
 *
 * Discovery stays shebang-based rather than extension-based: an extensionless script is
 * exactly what a `*.sh` glob misses, and the second test below asserts that none has
 * reappeared. Lint settings live in the repo-root `.shellcheckrc`.
 *
 * Requires `shellcheck` on PATH (`brew install shellcheck`); CI installs a pinned build before
 * running `deno task ci`, so this is the only place the shell lint is defined.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

/**
 * Scripts that must always be linted. Guards against a discovery bug quietly
 * shrinking the set to nothing and leaving the suite green but vacuous.
 *
 * Discovery **walks the tree**, so this list names every script regardless of index state and
 * a file dropping out of it is a real regression rather than a staging artifact. It used to be
 * `git ls-files`, which scoped the contract to "what is committed" and left a new or freshly
 * renamed script unlinted under both names at once.
 */
const EXPECTED = [
  ".github/publish-release.sh",
  ".github/release.sh",
  ".github/version-bump.sh",
];

/**
 * True if the file is shell: it declares a bash/sh shebang, or is named `*.sh` (which
 * catches the sourced libs, who have no shebang by design).
 *
 * Reads the file rather than trusting the path, so anything that disappears between the walk
 * and the read is skipped rather than reaching ShellCheck as a "does not exist" fatal.
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
 * `SKIPPED_DIRS` replaces what gitignore used to do for free.
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
    if (await isShellScript(rel)) scripts.push(rel);
  }
  return scripts.sort();
}

const scripts = await discoverShellScripts();

Deno.test("discovery: finds the release scripts, and the plugin ships no shell at all", () => {
  // **The expected set is now exactly the release scripts.** The plugin's own shell — the
  // three bundled scripts, their seven libs, and the six hooks — moved into the `ingrain`
  // binary or was deleted with the hook system, so what remains to lint is the three files
  // under `.github/` that cut releases. Deleting this tier along with them would have
  // silently stopped linting those.
  assertEquals(
    scripts,
    EXPECTED,
    "the linted set is not exactly the release scripts — a shell file has appeared in the " +
      `plugin, or a release script has stopped being discovered: ${scripts.join(", ")}`,
  );
});

/**
 * **The plugin ships no executable file**, asserted as a property rather than as a claim
 * about one commit.
 *
 * With the hooks gone this is what "prose only" means, and it is the security posture the
 * consolidation bought: a compromise of this repository can mislead an agent, but it cannot
 * execute anything on a developer's machine. A `.sh` reappearing under `skills/` or `hooks/`
 * would quietly undo that.
 */
Deno.test("the plugin ships no executable file", async () => {
  const offenders = scripts.filter((path) => !path.startsWith(".github/"));
  assertEquals(
    offenders,
    [],
    `the plugin must ship markdown only:\n  ${offenders.join("\n  ")}`,
  );

  for (const gone of ["hooks", "skills/ingrain-security/scripts"]) {
    const present = await Deno.stat(`${ROOT}${gone}`).then(() => true, () => false);
    assertEquals(present, false, `${gone}/ was deleted and must not return`);
  }

  const claude = JSON.parse(await Deno.readTextFile(`${ROOT}.claude-plugin/plugin.json`));
  const codex = JSON.parse(await Deno.readTextFile(`${ROOT}.codex-plugin/plugin.json`));
  for (const [host, manifest] of [["Claude", claude], ["Codex", codex]] as const) {
    assertEquals(manifest.hooks, undefined, `${host}'s manifest still registers hooks`);
  }
});

for (const path of scripts) {
  Deno.test(`shellcheck: ${path}`, async () => {
    const { code, report } = await runShellCheck(path);

    // ShellCheck's own report already names the line, column and rule, and links its
    // wiki — surface it verbatim rather than restating it.
    assertEquals(code, 0, `\n${report}`);
  });
}

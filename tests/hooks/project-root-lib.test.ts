/**
 * Behavioral tests for `skills/ingrain-security/scripts/lib/project-root.sh` — the shared
 * helper library that every hook SOURCES rather than executes.
 *
 * Because sourcing runs the functions in the host shell, `normalize_dir` must not move the
 * caller's working directory: its `cd` is confined to a subshell. These tests pin that by
 * calling the functions BARE — never inside `$(…)`, which would supply a subshell of its own
 * and mask the very leak under test — and asserting `$PWD` is untouched.
 *
 * The snippets run under bash against a throwaway dir, so they need the `test:hooks`
 * run+write permissions.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const LIB = `${ROOT}skills/ingrain-security/scripts/lib/project-root.sh`;

/** Base env: PATH for coreutils/git, HOME so git has somewhere to look for config. */
function baseEnv(): Record<string, string> {
  return {
    PATH: Deno.env.get("PATH") ?? "",
    HOME: Deno.env.get("HOME") ?? "",
  };
}

/**
 * Run a shell snippet with the library sourced, from `cwd`. `clearEnv` keeps a stray
 * CLAUDE_PROJECT_DIR in the developer's environment from steering the fallback cases.
 */
async function sourced(snippet: string, cwd: string): Promise<string> {
  const out = await new Deno.Command("bash", {
    args: ["-c", `set -uo pipefail; . "${LIB}"; ${snippet}`],
    cwd,
    clearEnv: true,
    env: baseEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(out.stdout);
}

/** A temp dir outside any git repo, so resolve_project_root lands on its $PWD fallback. */
async function tempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "project-root-lib-" });
}

Deno.test("normalize_dir: a bare call leaves the caller's $PWD alone", async () => {
  const dir = await tempDir();
  const other = await tempDir();
  try {
    const out = await sourced(
      `before="$PWD"; normalize_dir "${other}" >/dev/null; printf '%s\n%s\n' "$before" "$PWD"`,
      dir,
    );
    const [before, after] = out.trimEnd().split("\n");
    assertEquals(after, before, "normalize_dir moved the sourcing shell's working directory");
    assertNotEquals(before, other, "sanity: the temp dirs must differ for this to prove anything");
  } finally {
    await Deno.remove(dir);
    await Deno.remove(other);
  }
});

Deno.test("resolve_project_root: falls back to the cwd, and does not move it", async () => {
  const dir = await tempDir();
  try {
    // No CLAUDE_PROJECT_DIR and no git repo, so resolution reaches `normalize_dir "$PWD"` —
    // the library's one bare (not command-substituted) call. Its cd lands on the directory the
    // shell is already in, so it cannot leak even unfixed; this pins the fallback's RESULT, while
    // the normalize_dir test above is what guards the subshell.
    const out = await sourced(
      `before="$PWD"; root="$(resolve_project_root claude)"; printf '%s\n%s\n%s\n' "$before" "$PWD" "$root"`,
      dir,
    );
    const [before, after, root] = out.trimEnd().split("\n");
    assertEquals(
      after,
      before,
      "resolve_project_root moved the sourcing shell's working directory",
    );
    assertEquals(root, before, "the fallback must resolve to the caller's own cwd");
  } finally {
    await Deno.remove(dir);
  }
});

Deno.test("normalize_dir: an unreachable directory yields empty output and a non-zero status", async () => {
  const dir = await tempDir();
  try {
    const out = await sourced(
      `normalize_dir "${dir}/nope"; printf 'status=%s\n' "$?"; normalize_dir ""; printf 'status=%s\n' "$?"`,
      dir,
    );
    assertEquals(out, "status=1\nstatus=1\n");
  } finally {
    await Deno.remove(dir);
  }
});

Deno.test("normalize_dir: a reachable directory yields its canonical path", async () => {
  const dir = await tempDir();
  try {
    // Compare against the shell's own idea of the canonical path rather than `dir` itself:
    // on macOS the temp root is a symlink, so the two spellings legitimately differ.
    const out = await sourced(
      `expected="$(cd "${dir}" && pwd)"; actual="$(normalize_dir "${dir}")"; printf '%s\n%s\n' "$expected" "$actual"`,
      dir,
    );
    const [expected, actual] = out.trimEnd().split("\n");
    assertEquals(actual, expected);
  } finally {
    await Deno.remove(dir);
  }
});

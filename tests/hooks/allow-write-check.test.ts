/**
 * Behavioral tests for the path canonicalizers the WRITE grant depends on: `physical_dir` from
 * the shared `scripts/lib/path.sh`, and `canonical_assessment_dir` from the grant's own
 * `scripts/write/allow-write-check.sh` — libraries the allow-write-assessment hooks SOURCE
 * rather than execute. The sibling project-root-lib.test.ts covers
 * normalize_dir/resolve_project_root the same way.
 *
 * Because sourcing runs the functions in the host shell, `physical_dir` must not move the
 * caller's working directory: its `cd` is confined to a subshell. These tests pin that by
 * calling the functions BARE — never inside `$(…)`, which would supply a subshell of its
 * own and mask the very leak under test — and asserting `$PWD` is untouched.
 *
 * Worth pinning because `absolutize` resolves a relative path against `${cwd:-$PWD}`. In the
 * Codex hook that call runs AFTER `canonical_assessment_dir`, so a leak there would resolve a
 * relative patch path against a $PWD of `<project>/.ingrain-security` — turning a bare
 * `assessment.md` into an ALLOW the grant never intended. Fail-OPEN, in the one file whose
 * job is deciding what may be auto-written. Every call site wraps these in `$(…)` today, so
 * nothing leaks; that is precisely the problem, since the safety lives at the call sites
 * rather than in the functions, where it is invisible at the point of use.
 *
 * The hook-level tests cannot see any of this: a hook that leaks $PWD internally still emits
 * byte-identical JSON.
 *
 * The snippets run under bash against a throwaway git project, so they need the `test:hooks`
 * run+write permissions.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPTS = `${ROOT}skills/ingrain-security/scripts`;
const LIB = `${SCRIPTS}/lib`;

interface IProbe {
  /** What the bare call printed — the resolved path. */
  output: string;
  pwdBefore: string;
  pwdAfter: string;
}

/**
 * Source the guard and the libs it needs (resolve_project_root, physical_dir), `cd` into `cwd`, then
 * run `call` BARE in the current shell and report what it printed alongside the shell's $PWD
 * either side of it.
 *
 * `call` is a snippet, not a value — it must stay unwrapped for the test to mean anything.
 * The directory it operates on arrives as `$1` rather than interpolated, so a path carrying
 * shell metacharacters cannot break out of the snippet. `clearEnv` keeps a stray
 * CLAUDE_PROJECT_DIR in the developer's environment from retargeting the project root.
 */
async function probe(
  call: string,
  opts: { cwd: string; target: string; projectDir?: string },
): Promise<IProbe> {
  const script = `
    set -uo pipefail
    . "${LIB}/project-root.sh"
    . "${LIB}/hook-input.sh"
    . "${LIB}/path.sh"
    . "${SCRIPTS}/write/allow-write-check.sh"
    printf 'BEFORE:%s\\n' "\${PWD}"
    printf 'OUT:'
    ${call}
    printf 'AFTER:%s\\n' "\${PWD}"
  `;

  const out = await new Deno.Command("bash", {
    args: ["-c", script, "bash", opts.target],
    cwd: opts.cwd,
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "",
      ...(opts.projectDir ? { CLAUDE_PROJECT_DIR: opts.projectDir } : {}),
    },
    stdout: "piped",
    stderr: "piped",
  }).output();

  const stdout = new TextDecoder().decode(out.stdout);
  const field = (name: string): string =>
    stdout.split("\n").find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1) ?? "";

  assertEquals(out.code, 0, `probe failed: ${new TextDecoder().decode(out.stderr)}`);

  return { output: field("OUT"), pwdBefore: field("BEFORE"), pwdAfter: field("AFTER") };
}

/** Run `fn` against a fresh throwaway git project with the assessment folder seeded. */
async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-assessment-write-" });
  await sh(`git init -q "${dir}" && mkdir -p "${dir}/.ingrain-security" "${dir}/src"`);
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Run a shell snippet through bash (stays inside the --allow-run=bash profile). */
async function sh(script: string, cwd?: string): Promise<void> {
  const out = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "" },
    clearEnv: true,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (out.code !== 0) {
    throw new Error(`setup failed: ${new TextDecoder().decode(out.stderr)}`);
  }
}

/**
 * The PHYSICAL path of a directory, every symlink followed — the spelling `physical_dir` and
 * `canonical_assessment_dir` return, and the one bash seeds $PWD with from getcwd(). Resolved
 * through the shell rather than assumed, because on macOS the temp root is a symlink and a
 * temp dir is reached as `/var/…` but reported as `/private/var/…`.
 */
async function physical(dir: string): Promise<string> {
  const out = await new Deno.Command("bash", {
    args: ["-c", 'cd "$1" && pwd -P', "bash", dir],
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "" },
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(out.stdout).trim();
}

Deno.test("physical_dir: a bare call leaves the caller's $PWD alone", async () => {
  await withProject(async (dir) => {
    // Resolve a directory the shell is NOT already in, so a leaked cd would be visible.
    const res = await probe('physical_dir "$1"', {
      cwd: `${dir}/src`,
      target: `${dir}/.ingrain-security`,
    });

    assertEquals(res.pwdAfter, res.pwdBefore, "physical_dir moved the sourcing shell's cwd");
    assertEquals(res.pwdAfter, await physical(`${dir}/src`));
    // Asserted alongside $PWD so a function that simply stopped working cannot pass.
    assertEquals(res.output, await physical(`${dir}/.ingrain-security`));
  });
});

Deno.test("canonical_assessment_dir: a bare call leaves the caller's $PWD alone", async () => {
  await withProject(async (dir) => {
    // The call the Codex hook makes right before it absolutizes a relative patch path
    // against ${cwd:-$PWD}. Its own `physical_dir` call is bare, so it inherits the leak.
    const res = await probe("canonical_assessment_dir claude", {
      cwd: `${dir}/src`,
      target: dir,
      projectDir: dir,
    });

    assertEquals(
      res.pwdAfter,
      res.pwdBefore,
      "canonical_assessment_dir moved the sourcing shell's cwd",
    );
    assertEquals(res.pwdAfter, await physical(`${dir}/src`));
    assertEquals(res.output, await physical(`${dir}/.ingrain-security`));
  });
});

Deno.test("physical_dir: an unreachable directory yields empty output and a non-zero status", async () => {
  await withProject(async (dir) => {
    // The subshell must not swallow the failure: `cd` failing has to still surface as
    // non-zero, since every caller reads that as "defer".
    const res = await probe(
      'physical_dir "$1/nope" || printf "status=%s\\n" "$?"',
      { cwd: `${dir}/src`, target: dir },
    );
    assertEquals(res.output, "status=1");
  });
});

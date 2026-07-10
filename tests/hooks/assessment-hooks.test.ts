/**
 * Behavioral tests for the `hooks/start/ensure-assessment-dir` SessionStart hook.
 * Unlike the static tier these actually EXECUTE the script under bash against a
 * throwaway project dir, so they need run+write permissions (see the `test:hooks`
 * task in deno.json).
 *
 * Focus: the hook's core behavior (seeds the durable folder + README + `.gitignore`)
 * and the project-root resolution documented in its header — `CLAUDE_PROJECT_DIR`
 * and the `$PWD` fallback.
 *
 * Limitation on the Windows `cd && pwd` normalization: the bug it fixes is a
 * native backslash path that MSYS does not convert for env vars, which POSIX bash
 * cannot produce. On this platform `${dir}/.` and `${dir}` resolve to the same
 * inode, so no POSIX input distinguishes the raw form from the normalized one. The
 * "non-canonical project dir" cases below therefore only confirm the hooks still
 * behave when handed a non-canonical (but valid) path — a regression guard around
 * the normalization, NOT a proof of the Windows fix, which stays a manual check.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const HOOKS = `${ROOT}hooks/start`;

interface IHookResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a hook script under bash with a hermetic environment. `clearEnv` keeps the
 * runner's own `CLAUDE_PROJECT_DIR` from leaking in; `PATH` is forwarded so the
 * hook's coreutils (`mkdir`, `printf`) resolve. `hostArg` is forwarded to the
 * script as its positional host token ("claude" | "codex"), mirroring how each
 * hook.json passes it through run-hook.cmd.
 */
async function runHook(
  name: string,
  opts: { projectDir?: string; cwd?: string; hostArg?: string } = {},
): Promise<IHookResult> {
  const out = await new Deno.Command("bash", {
    args: [`${HOOKS}/${name}`, ...(opts.hostArg ? [opts.hostArg] : [])],
    cwd: opts.cwd,
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      ...(opts.projectDir ? { CLAUDE_PROJECT_DIR: opts.projectDir } : {}),
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/** Run `fn` against a fresh throwaway project dir, cleaned up afterwards. */
async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-hook-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// ensure-assessment-dir
// ---------------------------------------------------------------------------

Deno.test("ensure-assessment-dir: creates the folder, README and .gitignore", async () => {
  await withProject(async (dir) => {
    const res = await runHook("ensure-assessment-dir", { projectDir: dir });
    assertEquals(res.code, 0);
    // SessionStart stdout is injected as context; this hook has nothing to add.
    assertEquals(res.stdout, "");

    const base = `${dir}/ingrain-security`;
    assertEquals(await exists(`${base}/README.md`), true);
    assertEquals(await exists(`${base}/.gitignore`), true);
    assertStringIncludes(await Deno.readTextFile(`${base}/README.md`), "Threat assessments");

    // A bare `*` with no negation: the folder is ignored in full, .gitignore included.
    const gitignore = await Deno.readTextFile(`${base}/.gitignore`);
    assertStringIncludes(gitignore, "*");
    assertEquals(gitignore.includes("!.gitignore"), false);
  });
});

Deno.test("ensure-assessment-dir: is idempotent and never clobbers an edited README", async () => {
  await withProject(async (dir) => {
    const base = `${dir}/ingrain-security`;
    await Deno.mkdir(base, { recursive: true });
    await Deno.writeTextFile(`${base}/README.md`, "user edited");

    const res = await runHook("ensure-assessment-dir", { projectDir: dir });
    assertEquals(res.code, 0);
    assertEquals(await Deno.readTextFile(`${base}/README.md`), "user edited");
  });
});

Deno.test("ensure-assessment-dir: falls back to $PWD when CLAUDE_PROJECT_DIR is unset", async () => {
  await withProject(async (dir) => {
    const res = await runHook("ensure-assessment-dir", { cwd: dir });
    assertEquals(res.code, 0);
    assertEquals(await exists(`${dir}/ingrain-security`), true);
  });
});

Deno.test("ensure-assessment-dir: handles a non-canonical project dir", async () => {
  await withProject(async (dir) => {
    // A trailing `/.` is a valid, non-canonical path (see file header: on POSIX
    // this does not distinguish the fix — it guards against a normalization that
    // breaks path building).
    const res = await runHook("ensure-assessment-dir", { projectDir: `${dir}/.` });
    assertEquals(res.code, 0);
    assertEquals(await exists(`${dir}/ingrain-security`), true);
  });
});

Deno.test("ensure-assessment-dir: host=codex resolves the project root from cwd", async () => {
  await withProject(async (dir) => {
    const res = await runHook("ensure-assessment-dir", { hostArg: "codex", cwd: dir });
    assertEquals(res.code, 0);
    assertEquals(await exists(`${dir}/ingrain-security`), true);
  });
});

Deno.test("ensure-assessment-dir: host=codex ignores a leaked CLAUDE_PROJECT_DIR", async () => {
  // Codex must never honor CLAUDE_PROJECT_DIR: if it leaked into the environment
  // (e.g. a shell that also ran Claude Code), the folder must still land in the
  // real cwd, not the leaked project. `projectDir` sets CLAUDE_PROJECT_DIR here.
  await withProject(async (realDir) => {
    await withProject(async (leakedDir) => {
      const res = await runHook("ensure-assessment-dir", {
        hostArg: "codex",
        projectDir: leakedDir,
        cwd: realDir,
      });
      assertEquals(res.code, 0);
      assertEquals(await exists(`${realDir}/ingrain-security`), true);
      assertEquals(await exists(`${leakedDir}/ingrain-security`), false);
    });
  });
});

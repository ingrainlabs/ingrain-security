/**
 * Behavioral tests for the `skills/ingrain-security/scripts/rules-path` script — the
 * twin of `assessment-path` that mints the org-rules sidecar path. It shares all minting
 * logic via `lib/mint-path.sh`, so these mirror `assessment-path.test.ts` but assert the
 * `rules_*` field names and the `rules-<branch>-<task>.md` filenames. Like the sibling
 * suite these EXECUTE the script under bash against a throwaway project dir.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}skills/ingrain-security/scripts/rules-path`;

interface IResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Base env: PATH for coreutils/git, HOME so git has somewhere to look for config. */
function baseEnv(projectDir?: string): Record<string, string> {
  return {
    PATH: Deno.env.get("PATH") ?? "",
    HOME: Deno.env.get("HOME") ?? "",
    ...(projectDir ? { CLAUDE_PROJECT_DIR: projectDir } : {}),
  };
}

/** Run the rules-path script with the given argv. */
async function run(
  args: string[],
  opts: { cwd?: string; projectDir?: string } = {},
): Promise<IResult> {
  const out = await new Deno.Command("bash", {
    args: [SCRIPT, ...args],
    cwd: opts.cwd,
    clearEnv: true,
    env: baseEnv(opts.projectDir),
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/** The fields the mint subcommand emits — twin of assessment-path with rules_* names. */
interface IPathJson {
  host: string;
  project_root: string;
  branch: string;
  branch_slug: string;
  branch_known: boolean;
  task_slug: string;
  rules_dir: string;
  rules_path: string;
  rules_abs: string;
  basename: string;
  file_exists: boolean;
  instruction: string;
}

async function runJson(
  args: string[],
  opts: { cwd?: string; projectDir?: string } = {},
): Promise<IPathJson> {
  const res = await run(args, opts);
  assertEquals(res.code, 0, `expected exit 0, got ${res.code}: ${res.stderr}`);
  return JSON.parse(res.stdout); // throws if the script emitted non-JSON
}

/** Run an arbitrary shell snippet (used only to set up git repos / symlinks). */
async function sh(script: string, cwd: string): Promise<void> {
  const out = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd,
    clearEnv: true,
    env: baseEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (out.code !== 0) {
    throw new Error(`setup failed: ${new TextDecoder().decode(out.stderr)}`);
  }
}

/** Fresh throwaway project dir, cleaned up afterwards. */
async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-rules-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const gitRepo = (branch: string) => `git init -q && git checkout -q -b ${branch}`;

// ---------------------------------------------------------------------------
// mint: path shape & folder — same slug suffix as the assessment file
// ---------------------------------------------------------------------------

Deno.test("rules mint: writes into .ingrain-security/, keyed by branch + task", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    assertEquals(j.branch_slug, "feature-foo");
    assertEquals(j.branch_known, true);
    assertEquals(j.task_slug, "add-jwt-auth");
    assertEquals(j.rules_dir, ".ingrain-security");
    assertEquals(j.rules_path, ".ingrain-security/rules-feature-foo-add-jwt-auth.md");
    assertEquals(j.file_exists, false);
    // Folder + self-ignoring .gitignore are ensured; no host dotfolder is created.
    assertEquals(await exists(`${j.project_root}/.ingrain-security/.gitignore`), true);
    assertEquals(await exists(`${j.project_root}/.claude`), false);
  });
});

Deno.test("rules mint: file_exists reflects an already-present sidecar (resume)", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const first = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    await Deno.writeTextFile(first.rules_abs, "# org rules\n");
    const second = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    assertEquals(second.rules_path, first.rules_path); // same task -> same file
    assertEquals(second.file_exists, true);
  });
});

Deno.test("rules mint: shares the assessment's branch + task slug (twin sidecars)", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const rules = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    const assess = await new Deno.Command("bash", {
      args: [
        `${ROOT}skills/ingrain-security/scripts/assessment-path`,
        "claude",
        "mint",
        "--title",
        "Add JWT auth",
      ],
      clearEnv: true,
      env: baseEnv(dir),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const a = JSON.parse(new TextDecoder().decode(assess.stdout));
    // Same <branch-slug>-<task-slug> suffix, different lead prefix.
    assertEquals(rules.basename, "rules-feature-foo-add-jwt-auth.md");
    assertEquals(a.basename, "assessment-feature-foo-add-jwt-auth.md");
  });
});

// ---------------------------------------------------------------------------
// mint: fallbacks
// ---------------------------------------------------------------------------

Deno.test("rules mint: a non-git dir drops the branch segment", async () => {
  await withProject(async (dir) => {
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], { projectDir: dir });
    assertEquals(j.branch_known, false);
    assertEquals(j.rules_path, ".ingrain-security/rules-add-jwt-auth.md");
  });
});

Deno.test("rules mint: unresolvable segments are dropped (no title, both absent)", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const noTitle = await runJson(["claude", "mint"], { projectDir: dir });
    assertEquals(noTitle.rules_path, ".ingrain-security/rules-feature-foo.md");

    await withProject(async (bare) => {
      const both = await runJson(["claude", "mint"], { projectDir: bare });
      assertEquals(both.branch_known, false);
      assertEquals(both.rules_path, ".ingrain-security/rules.md");
    });
  });
});

// ---------------------------------------------------------------------------
// mint: host resolution & subdir anchoring
// ---------------------------------------------------------------------------

Deno.test("rules mint: host token selects root resolution but not the path", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const base = dir.split("/").pop()!;

    const claude = await runJson(["claude", "mint", "--title", "T"], { projectDir: dir });
    assertStringIncludes(claude.project_root, base);
    assertEquals(claude.rules_path, ".ingrain-security/rules-feature-foo-t.md");

    const codex = await runJson(["codex", "mint", "--title", "T"], {
      cwd: dir,
      projectDir: "/nonexistent/leaked",
    });
    assertEquals(codex.project_root.includes("leaked"), false);
    assertEquals(codex.rules_path, ".ingrain-security/rules-feature-foo-t.md");
  });
});

Deno.test("rules mint: run from a subdirectory still anchors at the git repo root", async () => {
  await withProject(async (dir) => {
    await sh(`${gitRepo("feature/foo")} && mkdir -p docs`, dir);
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      cwd: `${dir}/docs`,
    });
    assertStringIncludes(j.rules_abs, "/.ingrain-security/rules-feature-foo-add-jwt-auth.md");
    assertEquals(await exists(`${dir}/.ingrain-security`), true);
    assertEquals(await exists(`${dir}/docs/.ingrain-security`), false);
  });
});

// ---------------------------------------------------------------------------
// mint: the instruction field
// ---------------------------------------------------------------------------

Deno.test("rules mint: instruction names rules_abs and forbids a second folder", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], { projectDir: dir });
    assertStringIncludes(j.instruction, j.rules_abs);
    assertStringIncludes(j.instruction, "rules_abs");
    assertStringIncludes(j.instruction, "never create an .ingrain-security/ folder anywhere else");
  });
});

// ---------------------------------------------------------------------------
// mint: JSON-escaping, guards & interface
// ---------------------------------------------------------------------------

Deno.test("rules mint: a project path with quotes/backslashes still yields valid JSON", async () => {
  await withProject(async (parent) => {
    const nasty = `${parent}/pr"oj\\ekt`;
    await Deno.mkdir(nasty);
    await sh(gitRepo("feature/foo"), nasty);
    const j = await runJson(["claude", "mint", "--title", "T"], { projectDir: nasty });
    assertStringIncludes(j.project_root, '"');
    assertStringIncludes(j.project_root, "\\");
    assertStringIncludes(j.rules_abs, '"');
    assertEquals(j.basename, "rules-feature-foo-t.md");
  });
});

Deno.test("rules mint: refuses a symlinked .ingrain-security/", async () => {
  await withProject(async (dir) => {
    await withProject(async (elsewhere) => {
      await sh(`ln -s "${elsewhere}" .ingrain-security`, dir);
      const res = await run(["claude", "mint", "--title", "T"], { projectDir: dir });
      assertEquals(res.code, 1);
      assertStringIncludes(res.stderr, "symlink");
    });
  });
});

Deno.test("rules --help: exits 0, prints usage, creates nothing", async () => {
  await withProject(async (dir) => {
    const res = await run(["--help"], { projectDir: dir });
    assertEquals(res.code, 0);
    assertStringIncludes(res.stdout, "Usage:");
    assertEquals(await exists(`${dir}/.ingrain-security`), false);
  });
});

Deno.test("rules usage errors exit 2, tagged with the rules-path program token", async () => {
  await withProject(async (dir) => {
    assertEquals((await run(["claude", "bogus"], { projectDir: dir })).code, 2);
    assertEquals((await run([], { projectDir: dir })).code, 2);

    const noTitle = await run(["claude", "mint", "--title"], { projectDir: dir });
    assertEquals(noTitle.code, 2);
    assertStringIncludes(noTitle.stderr, "rules-path: --title needs a value");

    const badHost = await run(["---", "mint", "--title", "T"], { projectDir: dir });
    assertEquals(badHost.code, 2);
    assertStringIncludes(badHost.stderr, "rules-path: invalid host token");
  });
});

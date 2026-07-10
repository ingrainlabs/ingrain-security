/**
 * Behavioral tests for the `skills/ingrain-security/scripts/assessment-path` script
 * — the single source of truth for the review's assessment-file path. Like the
 * sibling `assessment-hooks.test.ts` these EXECUTE the script under bash against a
 * throwaway project dir, so they need the `test:hooks` run+write permissions.
 *
 * The file is written straight into `ingrain-security/` (no temp file, no copy) and
 * is keyed deterministically by branch + task. git repos are set up THROUGH the
 * spawned bash (`bash -c "git init …"`), which stays inside the `--allow-run=bash`
 * profile — Deno only gates directly-spawned processes.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}skills/ingrain-security/scripts/assessment-path`;

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

/** Run the assessment-path script with the given argv. */
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

/** The fields the mint subcommand emits. */
interface IPathJson {
  host: string;
  project_root: string;
  branch: string;
  branch_slug: string;
  branch_known: boolean;
  task_slug: string;
  assessment_dir: string;
  assessment_path: string;
  assessment_abs: string;
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
  const dir = await Deno.makeTempDir({ prefix: "ingrain-path-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const gitRepo = (branch: string) => `git init -q && git checkout -q -b ${branch}`;

// ---------------------------------------------------------------------------
// mint: path shape & folder
// ---------------------------------------------------------------------------

Deno.test("mint: writes into ingrain-security/, keyed by branch + task", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    assertEquals(j.branch_slug, "feature-foo");
    assertEquals(j.branch_known, true);
    assertEquals(j.task_slug, "add-jwt-auth");
    assertEquals(j.assessment_dir, "ingrain-security");
    assertEquals(j.assessment_path, "ingrain-security/assessment-feature-foo-add-jwt-auth.md");
    assertEquals(j.file_exists, false);
    // Folder and its self-ignoring .gitignore are ensured; no host .temp is created.
    assertEquals(await exists(`${j.project_root}/ingrain-security/.gitignore`), true);
    assertEquals(await exists(`${j.project_root}/.claude`), false);
  });
});

Deno.test("mint: file_exists reflects an already-present file (resume)", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const first = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    // The script does not create the .md; simulate a prior run having written it.
    await Deno.writeTextFile(first.assessment_abs, "# prior\n");
    const second = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    assertEquals(second.assessment_path, first.assessment_path); // same task -> same file
    assertEquals(second.file_exists, true);
  });
});

Deno.test("mint: a different task on the same branch resolves to a different file", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const a = await runJson(["claude", "mint", "--title", "Add JWT auth"], { projectDir: dir });
    const b = await runJson(["claude", "mint", "--title", "Rework logging"], { projectDir: dir });
    assertEquals(a.assessment_path, "ingrain-security/assessment-feature-foo-add-jwt-auth.md");
    assertEquals(b.assessment_path, "ingrain-security/assessment-feature-foo-rework-logging.md");
  });
});

// ---------------------------------------------------------------------------
// mint: fallbacks
// ---------------------------------------------------------------------------

Deno.test("mint: a non-git dir drops the branch segment", async () => {
  await withProject(async (dir) => {
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], { projectDir: dir });
    assertEquals(j.branch_known, false);
    assertEquals(j.assessment_path, "ingrain-security/assessment-add-jwt-auth.md");
  });
});

Deno.test("mint: unresolvable segments are dropped (no title, both absent)", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const noTitle = await runJson(["claude", "mint"], { projectDir: dir });
    assertEquals(noTitle.assessment_path, "ingrain-security/assessment-feature-foo.md");

    await withProject(async (bare) => {
      const both = await runJson(["claude", "mint"], { projectDir: bare });
      assertEquals(both.branch_known, false);
      assertEquals(both.assessment_path, "ingrain-security/assessment.md");
    });
  });
});

// ---------------------------------------------------------------------------
// mint: host resolution & slug rules
// ---------------------------------------------------------------------------

Deno.test("mint: host token selects root resolution but not the path", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    // Compare on the temp dir's basename — the /var vs /private/var symlink makes an
    // exact project_root equality flaky on macOS (the documented cd && pwd area).
    const base = dir.split("/").pop()!;

    const claude = await runJson(["claude", "mint", "--title", "T"], { projectDir: dir });
    assertStringIncludes(claude.project_root, base);
    assertEquals(claude.assessment_path, "ingrain-security/assessment-feature-foo-t.md");

    // codex resolves the root from cwd and ignores a leaked CLAUDE_PROJECT_DIR.
    const codex = await runJson(["codex", "mint", "--title", "T"], {
      cwd: dir,
      projectDir: "/nonexistent/leaked",
    });
    assertStringIncludes(codex.project_root, base);
    assertEquals(codex.project_root.includes("leaked"), false);
    assertEquals(codex.assessment_path, "ingrain-security/assessment-feature-foo-t.md");

    // A future host token still resolves and lands in ingrain-security/.
    const future = await runJson(["future", "mint", "--title", "T"], { projectDir: dir });
    assertEquals(future.assessment_dir, "ingrain-security");
    assertEquals(future.assessment_path, "ingrain-security/assessment-feature-foo-t.md");
  });
});

// ---------------------------------------------------------------------------
// mint: project-root anchoring
//
// The reported bug: a mint run from a subdirectory seeded `ingrain-security/` in
// THAT subdirectory. The root now comes from `git rev-parse --show-toplevel`, which
// answers the same from anywhere inside the repo.
// ---------------------------------------------------------------------------

Deno.test("mint: run from a subdirectory still anchors at the git repo root", async () => {
  await withProject(async (dir) => {
    await sh(`${gitRepo("feature/foo")} && mkdir -p docs`, dir);
    const base = dir.split("/").pop()!;

    // No CLAUDE_PROJECT_DIR: the root can only come from git.
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], {
      cwd: `${dir}/docs`,
    });
    assertStringIncludes(j.project_root, base);
    assertEquals(j.project_root.endsWith("/docs"), false);
    assertStringIncludes(
      j.assessment_abs,
      "/ingrain-security/assessment-feature-foo-add-jwt-auth.md",
    );

    // The folder lands at the root, and nowhere near the cwd we were invoked from.
    assertEquals(await exists(`${dir}/ingrain-security`), true);
    assertEquals(await exists(`${dir}/docs/ingrain-security`), false);
  });
});

Deno.test("mint: host=codex run from a subdirectory anchors at the git repo root", async () => {
  await withProject(async (dir) => {
    await sh(`${gitRepo("feature/foo")} && mkdir -p docs`, dir);
    // A leaked CLAUDE_PROJECT_DIR must stay ignored even now that git outranks $PWD.
    const j = await runJson(["codex", "mint", "--title", "T"], {
      cwd: `${dir}/docs`,
      projectDir: "/nonexistent/leaked",
    });
    assertEquals(j.project_root.includes("leaked"), false);
    assertEquals(await exists(`${dir}/ingrain-security`), true);
    assertEquals(await exists(`${dir}/docs/ingrain-security`), false);
  });
});

Deno.test("mint: CLAUDE_PROJECT_DIR outranks a nested git repo at the cwd", async () => {
  // A vendored dependency with its own .git must never retarget the assessment folder.
  await withProject(async (dir) => {
    await sh(`${gitRepo("feature/foo")} && mkdir -p vendor/lib`, dir);
    await sh(gitRepo("main"), `${dir}/vendor/lib`);
    const base = dir.split("/").pop()!;

    const j = await runJson(["claude", "mint", "--title", "T"], {
      cwd: `${dir}/vendor/lib`,
      projectDir: dir,
    });
    assertStringIncludes(j.project_root, base);
    assertEquals(j.project_root.endsWith("/vendor/lib"), false);
    assertEquals(await exists(`${dir}/vendor/lib/ingrain-security`), false);
  });
});

Deno.test("mint: a non-git dir falls back to $PWD", async () => {
  await withProject(async (dir) => {
    const base = dir.split("/").pop()!;
    const j = await runJson(["claude", "mint", "--title", "T"], { cwd: dir });
    assertStringIncludes(j.project_root, base);
    assertEquals(j.branch_known, false);
    assertEquals(await exists(`${dir}/ingrain-security`), true);
  });
});

// ---------------------------------------------------------------------------
// mint: the instruction field
//
// It is what actually reaches the orchestrator's context alongside the path, so it
// must carry the absolute path and say the folder must not be recreated elsewhere.
// ---------------------------------------------------------------------------

Deno.test("mint: instruction names assessment_abs and forbids a second folder", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], { projectDir: dir });
    assertStringIncludes(j.instruction, j.assessment_abs);
    assertStringIncludes(j.instruction, "assessment_abs");
    assertStringIncludes(j.instruction, "never create an ingrain-security/ folder anywhere else");
  });
});

Deno.test("mint: slug rules, and --branch-slug is honored verbatim", async () => {
  await withProject(async (dir) => {
    // A git-valid ref that exercises casing + disallowed chars: Feature/Foo_Bar.
    await sh(gitRepo("Feature/Foo_Bar"), dir);
    const j = await runJson(["claude", "mint", "--title", "T"], { projectDir: dir });
    assertEquals(j.branch_slug, "feature-foo-bar");

    const forced = await runJson(
      ["claude", "mint", "--title", "T", "--branch-slug", "other-branch"],
      { projectDir: dir },
    );
    assertEquals(forced.branch_slug, "other-branch");
    assertEquals(forced.assessment_path, "ingrain-security/assessment-other-branch-t.md");
  });
});

Deno.test("mint: raw branch field carries the un-slugified name", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude", "mint", "--title", "T"], { projectDir: dir });
    // branch_slug is the filename-safe form; branch is the git ref verbatim.
    assertEquals(j.branch, "feature/foo");
    assertEquals(j.branch_slug, "feature-foo");
    // When --branch-slug is supplied the git branch is not consulted, so it is empty.
    const forced = await runJson(
      ["claude", "mint", "--title", "T", "--branch-slug", "other-branch"],
      { projectDir: dir },
    );
    assertEquals(forced.branch, "");
    assertEquals(forced.branch_slug, "other-branch");
  });
});

Deno.test("mint: a detached HEAD drops the branch segment", async () => {
  await withProject(async (dir) => {
    // One commit to detach onto, then check out its SHA -> HEAD is detached.
    await sh(
      `${gitRepo("main")} && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init` +
        ` && git checkout -q --detach HEAD`,
      dir,
    );
    const j = await runJson(["claude", "mint", "--title", "Add JWT auth"], { projectDir: dir });
    assertEquals(j.branch, "");
    assertEquals(j.branch_known, false);
    assertEquals(j.assessment_path, "ingrain-security/assessment-add-jwt-auth.md");
  });
});

// ---------------------------------------------------------------------------
// mint: JSON-escaping robustness
// ---------------------------------------------------------------------------

Deno.test("mint: a project path with quotes/backslashes still yields valid JSON", async () => {
  await withProject(async (parent) => {
    // The title is slugified before output, so it never reaches escape_for_json; the
    // raw-passed fields (project_root, assessment_abs) are. Drive one through a dir
    // whose name carries a double-quote and a backslash — chars git refs cannot hold.
    const nasty = `${parent}/pr"oj\\ekt`;
    await Deno.mkdir(nasty);
    await sh(gitRepo("feature/foo"), nasty);
    // runJson's JSON.parse succeeding at all proves the output stayed well-formed;
    // then confirm the escaped chars survived round-trip into the parsed strings.
    const j = await runJson(["claude", "mint", "--title", "T"], { projectDir: nasty });
    assertStringIncludes(j.project_root, '"');
    assertStringIncludes(j.project_root, "\\");
    assertStringIncludes(j.assessment_abs, '"');
    assertEquals(j.basename, "assessment-feature-foo-t.md");
  });
});

// ---------------------------------------------------------------------------
// mint: guards & interface
// ---------------------------------------------------------------------------

Deno.test("mint: refuses a symlinked ingrain-security/", async () => {
  await withProject(async (dir) => {
    await withProject(async (elsewhere) => {
      await sh(`ln -s "${elsewhere}" ingrain-security`, dir);
      const res = await run(["claude", "mint", "--title", "T"], { projectDir: dir });
      assertEquals(res.code, 1);
      assertStringIncludes(res.stderr, "symlink");
    });
  });
});

Deno.test("--help: exits 0, prints usage, creates nothing", async () => {
  await withProject(async (dir) => {
    const res = await run(["--help"], { projectDir: dir });
    assertEquals(res.code, 0);
    assertStringIncludes(res.stdout, "Usage:");
    assertEquals(await exists(`${dir}/ingrain-security`), false);
  });
});

Deno.test("usage errors exit 2 (unknown subcommand / missing host / bad flag)", async () => {
  await withProject(async (dir) => {
    assertEquals((await run(["claude", "bogus"], { projectDir: dir })).code, 2);
    assertEquals((await run([], { projectDir: dir })).code, 2);
    assertEquals((await run(["claude", "mint", "--nope"], { projectDir: dir })).code, 2);
  });
});

Deno.test("usage errors exit 2 (missing subcommand after a host)", async () => {
  await withProject(async (dir) => {
    const res = await run(["claude"], { projectDir: dir });
    assertEquals(res.code, 2);
    assertStringIncludes(res.stderr, "subcommand");
  });
});

Deno.test("usage errors exit 2 (a flag given as the last arg has no value)", async () => {
  await withProject(async (dir) => {
    const noTitle = await run(["claude", "mint", "--title"], { projectDir: dir });
    assertEquals(noTitle.code, 2);
    assertStringIncludes(noTitle.stderr, "--title needs a value");

    const noSlug = await run(["claude", "mint", "--branch-slug"], { projectDir: dir });
    assertEquals(noSlug.code, 2);
    assertStringIncludes(noSlug.stderr, "--branch-slug needs a value");
  });
});

Deno.test("usage errors exit 2 (a host token that slugifies to empty)", async () => {
  await withProject(async (dir) => {
    // "---" has no alphanumerics, so host_slug is empty and mint rejects it.
    const res = await run(["---", "mint", "--title", "T"], { projectDir: dir });
    assertEquals(res.code, 2);
    assertStringIncludes(res.stderr, "invalid host token");
  });
});

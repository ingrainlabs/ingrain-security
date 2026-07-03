/**
 * Behavioral tests for the two assessment hooks — `hooks/scripts/ensure-assessment-dir`
 * and `hooks/scripts/save-assessment`. Unlike the static tier these actually EXECUTE the
 * scripts under bash against a throwaway project dir, so they need run+write
 * permissions (see the `test:hooks` task in deno.json).
 *
 * Focus: the hooks' core behavior and the project-root resolution documented in
 * their headers — `CLAUDE_PROJECT_DIR` and the `$PWD` fallback.
 *
 * Limitation on the Windows `cd && pwd` normalization: the bug it fixes is a
 * native backslash path that MSYS does not convert for env vars, which POSIX bash
 * cannot produce. On this platform `${dir}/.` and `${dir}` resolve to the same
 * inode, so no POSIX input distinguishes the raw form from the normalized one. The
 * "non-canonical project dir" cases below therefore only confirm the hooks still
 * behave when handed a non-canonical (but valid) path — a regression guard around
 * the normalization, NOT a proof of the Windows fix, which stays a manual check.
 */

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const HOOKS = `${ROOT}hooks/scripts`;

interface IHookResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a hook script under bash with a hermetic environment. `clearEnv` keeps the
 * runner's own `CLAUDE_PROJECT_DIR` from leaking in; `PATH` is forwarded so the
 * hook's coreutils (`mkdir`, `cp`, `grep`, `tr`, `date`) resolve.
 */
async function runHook(
  name: string,
  opts: { projectDir?: string; cwd?: string } = {},
): Promise<IHookResult> {
  const out = await new Deno.Command("bash", {
    args: [`${HOOKS}/${name}`],
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

/** Write a working assessment file under the project's `.claude/.temp`. */
async function seedAssessment(project: string, name: string, body: string): Promise<string> {
  const tempDir = `${project}/.claude/.temp`;
  await Deno.mkdir(tempDir, { recursive: true });
  const path = `${tempDir}/${name}`;
  await Deno.writeTextFile(path, body);
  return path;
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

    const base = `${dir}/ingrain-securityAssessment`;
    assertEquals(await exists(`${base}/README.md`), true);
    assertEquals(await exists(`${base}/.gitignore`), true);
    assertStringIncludes(await Deno.readTextFile(`${base}/README.md`), "Security assessments");
    assertStringIncludes(await Deno.readTextFile(`${base}/.gitignore`), "!.gitignore");
  });
});

Deno.test("ensure-assessment-dir: is idempotent and never clobbers an edited README", async () => {
  await withProject(async (dir) => {
    const base = `${dir}/ingrain-securityAssessment`;
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
    assertEquals(await exists(`${dir}/ingrain-securityAssessment`), true);
  });
});

Deno.test("ensure-assessment-dir: handles a non-canonical project dir", async () => {
  await withProject(async (dir) => {
    // A trailing `/.` is a valid, non-canonical path (see file header: on POSIX
    // this does not distinguish the fix — it guards against a normalization that
    // breaks path building).
    const res = await runHook("ensure-assessment-dir", { projectDir: `${dir}/.` });
    assertEquals(res.code, 0);
    assertEquals(await exists(`${dir}/ingrain-securityAssessment`), true);
  });
});

// ---------------------------------------------------------------------------
// save-assessment
// ---------------------------------------------------------------------------

Deno.test("save-assessment: copies the temp assessment into a slugged snapshot", async () => {
  await withProject(async (dir) => {
    const body = "## Task\nTitle: Add File Upload\n\n## Threats\n- something\n";
    await seedAssessment(dir, "assessment-run.md", body);

    const res = await runHook("save-assessment", { projectDir: dir });
    assertEquals(res.code, 0);

    const base = `${dir}/ingrain-securityAssessment`;
    const names = [...Deno.readDirSync(base)].map((e) => e.name);
    const snapshot = names.find((n) => n.startsWith("assessment-"));
    assertMatch(snapshot ?? "", /^assessment-add-file-upload-\d{8}-\d{6}\.md$/);
    assertEquals(await Deno.readTextFile(`${base}/${snapshot}`), body);
  });
});

Deno.test("save-assessment: picks the most-recently-modified assessment file", async () => {
  await withProject(async (dir) => {
    const older = await seedAssessment(dir, "assessment-old.md", "Title: Older Task\n");
    const newer = await seedAssessment(dir, "assessment-new.md", "Title: Newer Task\n");
    // Set deterministic mtimes so selection can't hinge on same-second ties.
    Deno.utimeSync(older, new Date(1_000_000), new Date(1_000_000));
    Deno.utimeSync(newer, new Date(2_000_000), new Date(2_000_000));

    const res = await runHook("save-assessment", { projectDir: dir });
    assertEquals(res.code, 0);

    const names = [...Deno.readDirSync(`${dir}/ingrain-securityAssessment`)]
      .map((e) => e.name)
      .filter((n) => n.startsWith("assessment-"));
    assertEquals(names.length, 1);
    assertMatch(names[0], /^assessment-newer-task-\d{8}-\d{6}\.md$/);
  });
});

Deno.test("save-assessment: falls back to a timestamp-only name without a usable Title", async () => {
  await withProject(async (dir) => {
    await seedAssessment(dir, "assessment-run.md", "## Task\n(no title line here)\n");

    const res = await runHook("save-assessment", { projectDir: dir });
    assertEquals(res.code, 0);

    const names = [...Deno.readDirSync(`${dir}/ingrain-securityAssessment`)]
      .map((e) => e.name)
      .filter((n) => n.startsWith("assessment-"));
    assertEquals(names.length, 1);
    assertMatch(names[0], /^assessment-\d{8}-\d{6}\.md$/);
  });
});

Deno.test("save-assessment: no-ops when there is no temp assessment", async () => {
  await withProject(async (dir) => {
    await Deno.mkdir(`${dir}/.claude/.temp`, { recursive: true });

    const res = await runHook("save-assessment", { projectDir: dir });
    assertEquals(res.code, 0);
    assertStringIncludes(res.stderr, "nothing to sync");
    assertEquals(await exists(`${dir}/ingrain-securityAssessment`), false);
  });
});

Deno.test("save-assessment: handles a non-canonical project dir end-to-end", async () => {
  await withProject(async (dir) => {
    await seedAssessment(dir, "assessment-run.md", "Title: Normalized Path\n");

    const res = await runHook("save-assessment", { projectDir: `${dir}/.` });
    assertEquals(res.code, 0);

    // Copy still lands correctly despite the non-canonical input (see file header:
    // a regression guard, not a proof of the Windows-specific fix).
    const names = [...Deno.readDirSync(`${dir}/ingrain-securityAssessment`)]
      .map((e) => e.name)
      .filter((n) => n.startsWith("assessment-"));
    assertEquals(names.length, 1);
    assertMatch(names[0], /^assessment-normalized-path-\d{8}-\d{6}\.md$/);
  });
});

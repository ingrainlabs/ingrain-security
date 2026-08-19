/**
 * Behavioral tests for the `skills/ingrain-security/scripts/assessment-mint` script
 * — the single source of truth for the review's assessment-file path. Like the
 * sibling `assessment-hooks.test.ts` these EXECUTE the script under bash against a
 * throwaway project dir, so they need the `test:hooks` run+write permissions.
 *
 * The file is written straight into `.ingrain-security/` (no temp file, no copy) and
 * is keyed deterministically by branch + task. git repos are set up THROUGH the
 * spawned bash (`bash -c "git init …"`), which stays inside the `--allow-run=bash`
 * profile — Deno only gates directly-spawned processes.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}skills/ingrain-security/scripts/assessment-mint`;

interface IResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Base env: PATH for coreutils/git, HOME for the tools that expect one — and git's
 * identity and config supplied by the test rather than by the machine.
 *
 * A bare `git commit` takes its author from `~/.gitconfig`, which a developer has and a
 * CI runner does not, so it passes here and fails there with "Author identity unknown".
 * The repository under test is disposable; the config git reads about it has to be too.
 */
function baseEnv(projectDir?: string): Record<string, string> {
  return {
    PATH: Deno.env.get("PATH") ?? "",
    HOME: Deno.env.get("HOME") ?? "",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    ...(projectDir ? { CLAUDE_PROJECT_DIR: projectDir } : {}),
  };
}

/** Run the assessment-mint script with the given argv. */
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
  plugin_root: string;
  project_root: string;
  branch: string;
  branch_slug: string;
  branch_known: boolean;
  task_slug: string;
  assessment_dir: string;
  assessment_path: string;
  assessment_abs: string;
  basename: string;
  has_content: boolean;
  /** Per-axis gated-driver counts — Phase select's third signal. */
  selected_threats: number;
  selected_rules: number;
  /** The resolved route, and which state produced it. */
  phase: "development" | "testing" | "requires_judgement";
  phase_reason: string;
  template_seeded: boolean;
  template_only: boolean;
  siblings: string[];
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

Deno.test("mint: writes into .ingrain-security/, keyed by branch + task", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    assertEquals(j.branch_slug, "feature-foo");
    assertEquals(j.branch_known, true);
    assertEquals(j.task_slug, "add-jwt-auth");
    assertEquals(j.assessment_dir, ".ingrain-security");
    assertEquals(j.assessment_path, ".ingrain-security/assessment-feature-foo-add-jwt-auth.md");
    assertEquals(j.has_content, false);
    // Folder and its self-ignoring .gitignore are ensured; no host .temp is created.
    assertEquals(await exists(`${j.project_root}/.ingrain-security/.gitignore`), true);
    assertEquals(await exists(`${j.project_root}/.claude`), false);
  });
});

Deno.test("mint: has_content reflects an already-WRITTEN file (resume)", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const first = await runJson(["claude", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    // The mint seeds a skeleton, which does not count as an assessment; simulate a prior
    // run having written real analysis into it.
    await Deno.writeTextFile(first.assessment_abs, "# prior\n");
    const second = await runJson(["claude", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    assertEquals(second.assessment_path, first.assessment_path); // same task -> same file
    assertEquals(second.has_content, true);
    assertEquals(second.template_seeded, false);
    assertEquals(second.template_only, false);
  });
});

// ---------------------------------------------------------------------------
// mint: the seeded skeleton
// ---------------------------------------------------------------------------

Deno.test("mint: seeds the empty skeleton, structure only", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude", "--title", "Add JWT auth"], { projectDir: dir });
    assertEquals(j.template_seeded, true);
    assertEquals(j.template_only, true);
    assertEquals(j.has_content, false); // a skeleton is not an assessment

    const md = await Deno.readTextFile(j.assessment_abs);
    assertStringIncludes(md, "# Security assessment — Add JWT auth");
    assertStringIncludes(md, "Title: Add JWT auth");
    assertStringIncludes(md, "Latest stage: development");
    for (
      const section of [
        "## Task",
        "## Triage",
        "## Threats",
        "## Risk score",
        "## Org rules",
        "## Implementation guidance",
        "## Rule adherence",
        "## Maintenance (for the implementing agent)",
      ]
    ) {
      assertStringIncludes(md, `\n${section}\n`);
    }
    // `## Coverage / open items` is gone: its definition was a join over a per-guidance
    // Selection that no longer exists, and both halves of what it recorded survive elsewhere —
    // the guidance critic flags an unaddressed driver before finalize, Testing proves it after.
    assertEquals(
      md.includes("## Coverage"),
      false,
      "the coverage join is deleted — the skeleton must not seed its heading",
    );
    // Every entry-bearing section is seeded as a bare heading — the writers add the entries.
    // Org rules and Rule adherence are the strictest cases: their cards are the ones describing
    // an id-keyed `### <rule-id> — <title>` entry, so a card line beginning with `###` would
    // make an untouched skeleton read as though a rule had already been retrieved or judged.
    assertEquals(
      /^### /m.test(md),
      false,
      "skeleton must hold no example entries",
    );
  });
});

Deno.test("mint: re-minting leaves an untouched skeleton byte-identical", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const first = await runJson(["claude", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    const seeded = await Deno.readTextFile(first.assessment_abs);
    const second = await runJson(["claude", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    assertEquals(second.template_seeded, false); // already there — not rewritten
    assertEquals(second.template_only, true);
    assertEquals(second.has_content, false);
    assertEquals(await Deno.readTextFile(first.assessment_abs), seeded);
  });
});

Deno.test("mint: an appended line makes the file written, and is not clobbered", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const first = await runJson(["claude", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    const written = await Deno.readTextFile(first.assessment_abs) + "\nVerdict: major\n";
    await Deno.writeTextFile(first.assessment_abs, written);
    const second = await runJson(["claude", "--title", "Add JWT auth"], {
      projectDir: dir,
    });
    assertEquals(second.has_content, true);
    assertEquals(second.template_only, false);
    assertEquals(await Deno.readTextFile(first.assessment_abs), written);
  });
});

Deno.test("mint: with no title the skeleton drops the title, not the structure", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude"], { projectDir: dir });
    const md = await Deno.readTextFile(j.assessment_abs);
    assertEquals(md.startsWith("# Security assessment\n"), true);
    assertStringIncludes(md, "\nTitle:\n");
    assertStringIncludes(md, "\n## Implementation guidance\n");
  });
});

Deno.test("mint: a different task on the same branch resolves to a different file", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const a = await runJson(["claude", "--title", "Add JWT auth"], { projectDir: dir });
    const b = await runJson(["claude", "--title", "Rework logging"], { projectDir: dir });
    assertEquals(a.assessment_path, ".ingrain-security/assessment-feature-foo-add-jwt-auth.md");
    assertEquals(b.assessment_path, ".ingrain-security/assessment-feature-foo-rework-logging.md");
  });
});

// ---------------------------------------------------------------------------
// mint: fallbacks
// ---------------------------------------------------------------------------

Deno.test("mint: a non-git dir drops the branch segment", async () => {
  await withProject(async (dir) => {
    const j = await runJson(["claude", "--title", "Add JWT auth"], { projectDir: dir });
    assertEquals(j.branch_known, false);
    assertEquals(j.assessment_path, ".ingrain-security/assessment-add-jwt-auth.md");
  });
});

Deno.test("mint: unresolvable segments are dropped (no title, both absent)", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const noTitle = await runJson(["claude"], { projectDir: dir });
    assertEquals(noTitle.assessment_path, ".ingrain-security/assessment-feature-foo.md");

    await withProject(async (bare) => {
      const both = await runJson(["claude"], { projectDir: bare });
      assertEquals(both.branch_known, false);
      assertEquals(both.assessment_path, ".ingrain-security/assessment.md");
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

    const claude = await runJson(["claude", "--title", "T"], { projectDir: dir });
    assertStringIncludes(claude.project_root, base);
    assertEquals(claude.assessment_path, ".ingrain-security/assessment-feature-foo-t.md");

    // codex resolves the root from cwd and ignores a leaked CLAUDE_PROJECT_DIR.
    const codex = await runJson(["codex", "--title", "T"], {
      cwd: dir,
      projectDir: "/nonexistent/leaked",
    });
    assertStringIncludes(codex.project_root, base);
    assertEquals(codex.project_root.includes("leaked"), false);
    assertEquals(codex.assessment_path, ".ingrain-security/assessment-feature-foo-t.md");

    // A future host token still resolves and lands in .ingrain-security/.
    const future = await runJson(["future", "--title", "T"], { projectDir: dir });
    assertEquals(future.assessment_dir, ".ingrain-security");
    assertEquals(future.assessment_path, ".ingrain-security/assessment-feature-foo-t.md");
  });
});

// ---------------------------------------------------------------------------
// mint: project-root anchoring
//
// The reported bug: a mint run from a subdirectory seeded `.ingrain-security/` in
// THAT subdirectory. The root now comes from `git rev-parse --show-toplevel`, which
// answers the same from anywhere inside the repo.
// ---------------------------------------------------------------------------

Deno.test("mint: run from a subdirectory still anchors at the git repo root", async () => {
  await withProject(async (dir) => {
    await sh(`${gitRepo("feature/foo")} && mkdir -p docs`, dir);
    const base = dir.split("/").pop()!;

    // No CLAUDE_PROJECT_DIR: the root can only come from git.
    const j = await runJson(["claude", "--title", "Add JWT auth"], {
      cwd: `${dir}/docs`,
    });
    assertStringIncludes(j.project_root, base);
    assertEquals(j.project_root.endsWith("/docs"), false);
    assertStringIncludes(
      j.assessment_abs,
      "/.ingrain-security/assessment-feature-foo-add-jwt-auth.md",
    );

    // The folder lands at the root, and nowhere near the cwd we were invoked from.
    assertEquals(await exists(`${dir}/.ingrain-security`), true);
    assertEquals(await exists(`${dir}/docs/.ingrain-security`), false);
  });
});

Deno.test("mint: host=codex run from a subdirectory anchors at the git repo root", async () => {
  await withProject(async (dir) => {
    await sh(`${gitRepo("feature/foo")} && mkdir -p docs`, dir);
    // A leaked CLAUDE_PROJECT_DIR must stay ignored even now that git outranks $PWD.
    const j = await runJson(["codex", "--title", "T"], {
      cwd: `${dir}/docs`,
      projectDir: "/nonexistent/leaked",
    });
    assertEquals(j.project_root.includes("leaked"), false);
    assertEquals(await exists(`${dir}/.ingrain-security`), true);
    assertEquals(await exists(`${dir}/docs/.ingrain-security`), false);
  });
});

Deno.test("mint: CLAUDE_PROJECT_DIR outranks a nested git repo at the cwd", async () => {
  // A vendored dependency with its own .git must never retarget the assessment folder.
  await withProject(async (dir) => {
    await sh(`${gitRepo("feature/foo")} && mkdir -p vendor/lib`, dir);
    await sh(gitRepo("main"), `${dir}/vendor/lib`);
    const base = dir.split("/").pop()!;

    const j = await runJson(["claude", "--title", "T"], {
      cwd: `${dir}/vendor/lib`,
      projectDir: dir,
    });
    assertStringIncludes(j.project_root, base);
    assertEquals(j.project_root.endsWith("/vendor/lib"), false);
    assertEquals(await exists(`${dir}/vendor/lib/.ingrain-security`), false);
  });
});

Deno.test("mint: a non-git dir falls back to $PWD", async () => {
  await withProject(async (dir) => {
    const base = dir.split("/").pop()!;
    const j = await runJson(["claude", "--title", "T"], { cwd: dir });
    assertStringIncludes(j.project_root, base);
    assertEquals(j.branch_known, false);
    assertEquals(await exists(`${dir}/.ingrain-security`), true);
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
    const j = await runJson(["claude", "--title", "Add JWT auth"], { projectDir: dir });
    assertStringIncludes(j.instruction, j.assessment_abs);
    assertStringIncludes(j.instruction, "assessment_abs");
    assertStringIncludes(j.instruction, "never create an .ingrain-security/ folder anywhere else");
  });
});

Deno.test("mint: the slug rules, applied to a branch that exercises all of them", async () => {
  await withProject(async (dir) => {
    // A git-valid ref that exercises casing + disallowed chars: Feature/Foo_Bar.
    await sh(gitRepo("Feature/Foo_Bar"), dir);
    const j = await runJson(["claude", "--title", "T"], { projectDir: dir });
    assertEquals(j.branch_slug, "feature-foo-bar");
    assertEquals(j.assessment_path, ".ingrain-security/assessment-feature-foo-bar-t.md");
  });
});

Deno.test("mint: raw branch field carries the un-slugified name", async () => {
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude", "--title", "T"], { projectDir: dir });
    // branch_slug is the filename-safe form; branch is the git ref verbatim. Both derive
    // from ONE read, so the name in the path and the branch the delta was measured on
    // cannot disagree — which the deleted `--branch-slug` override could have made them.
    assertEquals(j.branch, "feature/foo");
    assertEquals(j.branch_slug, "feature-foo");
  });
});

Deno.test("mint: a detached HEAD drops the branch segment", async () => {
  await withProject(async (dir) => {
    // One commit to detach onto, then check out its SHA -> HEAD is detached.
    await sh(
      `${gitRepo("main")} && git commit -q --allow-empty -m init && git checkout -q --detach HEAD`,
      dir,
    );
    const j = await runJson(["claude", "--title", "Add JWT auth"], { projectDir: dir });
    assertEquals(j.branch, "");
    assertEquals(j.branch_known, false);
    assertEquals(j.assessment_path, ".ingrain-security/assessment-add-jwt-auth.md");
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
    const j = await runJson(["claude", "--title", "T"], { projectDir: nasty });
    assertStringIncludes(j.project_root, '"');
    assertStringIncludes(j.project_root, "\\");
    assertStringIncludes(j.assessment_abs, '"');
    assertEquals(j.basename, "assessment-feature-foo-t.md");
  });
});

// ---------------------------------------------------------------------------
// mint: guards & interface
// ---------------------------------------------------------------------------

Deno.test("mint: refuses a symlinked .ingrain-security/", async () => {
  await withProject(async (dir) => {
    await withProject(async (elsewhere) => {
      await sh(`ln -s "${elsewhere}" .ingrain-security`, dir);
      const res = await run(["claude", "--title", "T"], { projectDir: dir });
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
    assertEquals(await exists(`${dir}/.ingrain-security`), false);
  });
});

Deno.test("usage errors exit 2 (unknown flag, missing host)", async () => {
  await withProject(async (dir) => {
    // With no subcommand layer, everything after <host> is a flag — so a stray bare word
    // is refused by the flag parser rather than by a subcommand check.
    assertEquals((await run(["claude", "bogus"], { projectDir: dir })).code, 2);
    assertEquals((await run([], { projectDir: dir })).code, 2);
    assertEquals((await run(["claude", "--nope"], { projectDir: dir })).code, 2);
  });
});

Deno.test("a bare host mints the title-less fallback rather than erroring", async () => {
  // The one behavior change from dropping the subcommand: `<script> claude` used to exit 2
  // as "missing subcommand". It now reaches the fallback the usage text already documented
  // and the branch/title cases below already exercise — so nothing new became possible, it
  // just became reachable without a ceremonial token.
  await withProject(async (dir) => {
    await sh(gitRepo("feature/foo"), dir);
    const j = await runJson(["claude"], { projectDir: dir });
    assertEquals(j.assessment_path, ".ingrain-security/assessment-feature-foo.md");
  });
});

Deno.test("usage errors exit 2 (a flag given as the last arg has no value)", async () => {
  await withProject(async (dir) => {
    const noTitle = await run(["claude", "--title"], { projectDir: dir });
    assertEquals(noTitle.code, 2);
    assertStringIncludes(noTitle.stderr, "--title needs a value");
  });
});

Deno.test("usage errors exit 2 (a host token that slugifies to empty)", async () => {
  await withProject(async (dir) => {
    // "---" has no alphanumerics, so host_slug is empty and mint rejects it.
    const res = await run(["---", "--title", "T"], { projectDir: dir });
    assertEquals(res.code, 2);
    assertStringIncludes(res.stderr, "invalid host token");
  });
});

Deno.test("plugin_root points at the plugin, not the project — a dispatch cannot derive it", async () => {
  // A dispatched subagent's cwd is the USER'S project, so a relative `references/…` in a
  // worker dispatch resolves to `<project>/references/…` and the read fails on the
  // worker's first action. The dispatch pastes this in, exactly as it pastes
  // assessment_abs for the write target — and the two are different directories, which
  // is the whole reason a second key is needed.
  await withProject(async (dir) => {
    const json = await runJson(["claude", "--title", "T"], { projectDir: dir });

    assertEquals(json.plugin_root, ROOT.replace(/\/$/, ""));
    assertEquals(await exists(`${json.plugin_root}/skills/ingrain-security/SKILL.md`), true);
    // The two roots are unrelated: no amount of project-root arithmetic reaches the plugin.
    assertEquals(json.plugin_root === json.project_root, false);
  });
});

Deno.test("siblings reports written assessments this title did not mint, and never guesses", async () => {
  // The mint is deterministic in branch + title, so a later session that PARAPHRASES the
  // title resolves to a fresh path and reports has_content:false — and Phase select then
  // routes an implemented change back into plan review, silently. Listing what is there
  // lets the router ask "is one of these yours?" without the minter picking, which would
  // risk writing into another task's assessment.
  await withProject(async (dir) => {
    await sh("git init -q . && git symbolic-ref HEAD refs/heads/feat-x", dir);

    const first = await runJson(["claude", "--title", "Add refresh token rotation"], {
      projectDir: dir,
    });
    assertEquals(first.siblings, [], "an empty folder has no siblings");

    // An UNTOUCHED skeleton is not an assessment — `has_content` says so, and offering it
    // would send the router to an empty file.
    const paraphrase = await runJson(["claude", "--title", "Rotate refresh tokens"], {
      projectDir: dir,
    });
    assertEquals(paraphrase.siblings, [], "a seeded skeleton is not a sibling");

    // Now give the first real content. The paraphrase must surface it.
    await Deno.writeTextFile(
      first.assessment_abs,
      "## Task\nTitle: Add refresh token rotation\nLatest stage: development\nDescription: real\n",
    );
    const found = await runJson(["claude", "--title", "Rotate refresh tokens v2"], {
      projectDir: dir,
    });
    assertEquals(found.siblings.includes(first.basename), true);
    // Reported, never chosen: the mint still returns ITS OWN path, so nothing writes into
    // the sibling by accident.
    assertStringIncludes(found.instruction, "re-run this mint with that Title VERBATIM");
    assertEquals(found.assessment_abs === first.assessment_abs, false);

    // And once the title matches again, the recovery hint is gone.
    const exact = await runJson(["claude", "--title", "Add refresh token rotation"], {
      projectDir: dir,
    });
    assertEquals(exact.has_content, true);
    assertEquals(exact.siblings, [], "a found assessment needs no recovery hint");
  });
});

Deno.test("siblings stays on this branch — another branch's assessment is another task", async () => {
  await withProject(async (dir) => {
    await sh("git init -q . && git symbolic-ref HEAD refs/heads/feat-x", dir);
    const mine = await runJson(["claude", "--title", "T"], { projectDir: dir });
    await Deno.writeTextFile(
      `${dir}/.ingrain-security/assessment-other-branch-other-task.md`,
      "## Task\nTitle: Other\nDescription: real\n",
    );

    const next = await runJson(["claude", "--title", "T2"], { projectDir: dir });
    assertEquals(next.siblings.includes("assessment-other-branch-other-task.md"), false);
    assertEquals(next.branch_slug, "feat-x");
    assertEquals(mine.branch_slug, "feat-x");
  });
});

Deno.test("selected_threats / selected_rules: the third Phase-select signal, counted not read", async () => {
  // Phase select routes on these, so a miscount silently sends a reviewed-and-implemented
  // change back into plan review, or a half-gated one into verification. The two traps are
  // the field CARDS — which spell the allowed values out inside each section — and the
  // shared field name across the two axes.
  await withProject(async (dir) => {
    await sh("git init -q . && git symbolic-ref HEAD refs/heads/feat-x", dir);
    const mint = await runJson(["claude", "--title", "Counting"], { projectDir: dir });

    // The skeleton carries both field cards and no entries. A looser match than a
    // line-anchored one reads `Selection (selected|excluded)` as a decision and reports
    // every fresh review as already gated.
    assertEquals(mint.selected_threats, 0, "an untouched skeleton has gated nothing");
    assertEquals(mint.selected_rules, 0, "an untouched skeleton has gated nothing");
    const skeleton = await Deno.readTextFile(mint.assessment_abs);
    assertEquals(
      skeleton.includes("Selection (selected"),
      true,
      "card text must still be present — it is the thing the count has to ignore",
    );

    // One selected threat of two, and one selected rule: written into their OWN sections,
    // because a whole-file count would report either axis as the other.
    const put = (md: string, heading: string, block: string): string => {
      const lines = md.split("\n");
      let i = lines.indexOf(heading) + 1;
      while (i < lines.length && !lines[i].startsWith("## ")) i++;
      return [...lines.slice(0, i), ...block.split("\n"), ...lines.slice(i)].join("\n");
    };
    let md = skeleton;
    md = put(
      md,
      "## Threats",
      "### T01 — a\nSelection: selected\n\n### T02 — b\nSelection: excluded\n",
    );
    md = put(md, "## Org rules", "### 1111 — r\nSelection: selected\n");
    await Deno.writeTextFile(mint.assessment_abs, md);

    const counted = await runJson(["claude", "--title", "Counting"], { projectDir: dir });
    assertEquals(counted.has_content, true);
    assertEquals(counted.selected_threats, 1, "excluded must not count as selected");
    assertEquals(counted.selected_rules, 1, "the rule axis is counted in its own section");
  });
});

Deno.test("phase: the script resolves the route, and says when it cannot", async () => {
  // The route used to be four prose cases the orchestrator evaluated. It is measured here
  // instead — so what needs guarding is that each state still reaches its own verdict, and
  // that the two genuinely ambiguous ones refuse to answer rather than guessing.
  const gateOneThreat = async (path: string) => {
    const lines = (await Deno.readTextFile(path)).split("\n");
    let i = lines.indexOf("## Threats") + 1;
    while (i < lines.length && !lines[i].startsWith("## ")) i++;
    await Deno.writeTextFile(
      path,
      [...lines.slice(0, i), "### T01 — a", "Selection: selected", "", ...lines.slice(i)].join(
        "\n",
      ),
    );
  };

  await withProject(async (dir) => {
    await sh("git init -q -b feat/x . && git commit -q --allow-empty -m base", dir);
    await sh("git checkout -q -b feat/y", dir);

    const fresh = await runJson(["claude", "--title", "Task A"], { projectDir: dir });
    assertEquals(fresh.phase, "development");
    assertEquals(fresh.phase_reason, "fresh_task");

    // Written, but nothing gated yet — the analysis is mid-flight.
    await Deno.writeTextFile(fresh.assessment_abs, "## Task\nTitle: Task A\nDescription: real\n");
    const resumed = await runJson(["claude", "--title", "Task A"], { projectDir: dir });
    assertEquals(resumed.phase_reason, "resume_analysis");

    // Gated driver, clean tree, fork point resolves — the implementation is still ahead.
    await runJson(["claude", "--title", "Task B"], { projectDir: dir });
    const bPath = `${dir}/.ingrain-security/assessment-feat-y-task-b.md`;
    await gateOneThreat(bPath);
    const ahead = await runJson(["claude", "--title", "Task B"], { projectDir: dir });
    assertEquals(ahead.phase, "development");
    assertEquals(ahead.phase_reason, "implementation_ahead");

    // Same assessment, now with a committed delta — the only Testing route.
    await sh("echo impl > code.txt && git add code.txt && git commit -q -m impl", dir);
    const verify = await runJson(["claude", "--title", "Task B"], { projectDir: dir });
    assertEquals(verify.phase, "testing");
    assertEquals(verify.phase_reason, "verify_now");

    // A paraphrased title: mechanically indistinguishable from a fresh task, which is why
    // the script must NOT answer. Guessing here re-reviews already-written code.
    const para = await runJson(["claude", "--title", "Task B reworded"], {
      projectDir: dir,
    });
    assertEquals(para.phase, "requires_judgement");
    assertEquals(para.phase_reason, "siblings_present");
  });

  // No other ref to diff against: commits exist but `delta_empty` measured only the working
  // tree, so a clean tree can hide a finished implementation. The one fallback that is
  // genuinely ambiguous — `no-divergence` and `no-commits` stay mechanical.
  await withProject(async (dir) => {
    await sh("git init -q -b solo . && echo impl > code.txt && git add code.txt", dir);
    await sh("git commit -q -m impl", dir);
    const mint = await runJson(["claude", "--title", "T"], { projectDir: dir });
    await gateOneThreat(mint.assessment_abs);
    const doubt = await runJson(["claude", "--title", "T"], { projectDir: dir });
    assertEquals(doubt.phase, "requires_judgement");
    assertEquals(doubt.phase_reason, "delta_unreliable");
  });
});

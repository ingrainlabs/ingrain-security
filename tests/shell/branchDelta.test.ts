/**
 * Behavioural tests for `scripts/branch-delta` — the review's diff basis.
 *
 * Everything else about this script is covered statically (shellcheck, and the
 * static tier's reads of its documented contract), which left the one thing that
 * actually matters untested: **which commit it decides this branch was cut from**.
 * That answer sizes the whole review — a basis that is too recent means committed
 * implementation is invisible to the verifiers, and the run reports a resolved
 * fork point either way, so the narrowing is silent.
 *
 * Each test builds a throwaway repository, so nothing here touches the working
 * tree and no state carries between cases.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/** True when the path exists — used to prove a write did NOT happen. */
const exists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
};

const SCRIPT = fromFileUrl(
  new URL("../../skills/ingrain-security/scripts/branch-delta", import.meta.url),
);

const runGit = async (
  cwd: string,
  env: Record<string, string>,
  args: string[],
): Promise<string> => {
  const { code, stdout, stderr } = await new Deno.Command("git", {
    args,
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`);
  return new TextDecoder().decode(stdout).trim();
};

const git = (cwd: string, ...args: string[]): Promise<string> => runGit(cwd, {}, args);

/** git with a fixed author/committer date, so commit order is deterministic. */
const gitAt = (cwd: string, date: string, ...args: string[]): Promise<string> =>
  runGit(cwd, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, args);

interface IChangedFile {
  readonly path: string;
  readonly status: string;
}

interface IBranchDiff {
  readonly base_ref: string;
  readonly diff_ref: string;
  readonly fallback: boolean;
  readonly reason: string;
  readonly commits_ahead: number;
  readonly uncommitted: boolean;
  readonly shallow: boolean;
  readonly delta_empty: boolean;
  /** The resolved changed-file set — the review's entry point, not a command to run. */
  readonly changed_files: readonly IChangedFile[];
}

/** Run the script against a repo, as the orchestrator does: `codex` host, so the
 *  project root resolves from git rather than from a Claude env var. */
const resolve = async (root: string): Promise<IBranchDiff> => {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [SCRIPT, "codex"],
    cwd: root,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: root, PWD: root },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(`branch-delta exited ${code}: ${new TextDecoder().decode(stderr)}`);
  }
  return JSON.parse(new TextDecoder().decode(stdout));
};

/**
 * Commit with an explicit, strictly increasing date.
 *
 * Load-bearing, not incidental: the fork point is chosen by **most recent
 * merge-base commit date**, so commits sharing a timestamp — which is what
 * happens when a test writes them back to back — collapse the comparison into a
 * stable-sort tie-break and the wrong candidate no longer wins. The bug these
 * tests exist for would then be invisible and every case would pass regardless.
 */
const commit = async (
  root: string,
  path: string,
  body: string,
  message: string,
  day: number,
): Promise<void> => {
  await Deno.mkdir(join(root, path, ".."), { recursive: true });
  await Deno.writeTextFile(join(root, path), body);
  await git(root, "add", ".");
  const date = `2020-01-${String(day).padStart(2, "0")}T00:00:00Z`;
  await gitAt(root, date, "commit", "-m", message);
};

/** `main` with one commit, then `feature` with two more. */
const seed = async (root: string): Promise<void> => {
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  await commit(root, "README.md", "# seed\n", "base", 1);
  await git(root, "checkout", "-b", "feature");
  await commit(root, "services/auth/token.ts", "export const a = 1;\n", "first", 2);
  await commit(root, "services/billing/invoice.ts", "export const b = 2;\n", "second", 3);
};

const withRepo = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await Deno.makeTempDir({ prefix: "branch-delta-" });
  try {
    await seed(root);
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
};

Deno.test("branch-delta: the basis is the fork point, not this branch's last push", async () => {
  await withRepo(async (root) => {
    // A pushed-then-committed-again branch. `origin/feature` is not a parent — it
    // is this same branch as the server last saw it — so its merge-base is the
    // last push. Counted as a candidate it wins the most-recent contest, and the
    // review shrinks to the unpushed tail while still reporting a fork point.
    await git(root, "remote", "add", "origin", "git@github.com:acme/widgets.git");
    const firstCommit = await git(root, "rev-parse", "HEAD~1");
    await git(root, "update-ref", "refs/remotes/origin/feature", firstCommit);
    await git(root, "update-ref", "refs/remotes/origin/main", "main");

    const result = await resolve(root);

    assertEquals(result.fallback, false);
    assertEquals(result.diff_ref, await git(root, "rev-parse", "main"));
    assertEquals(result.base_ref, "main");
    // Both feature commits are in scope, not just the unpushed one.
    assertEquals(result.commits_ahead, 2);
  });
});

Deno.test("branch-delta: the parent is never assumed to be main", async () => {
  await withRepo(async (root) => {
    // Cut from `feature`, not from `main`. Work already on `feature` is not this
    // task's delta, so the basis must be the nearer branch point.
    await git(root, "checkout", "-b", "feature-child");
    await commit(root, "services/reporting/export.ts", "export const c = 3;\n", "child", 4);

    const result = await resolve(root);

    assertEquals(result.fallback, false);
    assertEquals(result.base_ref, "feature");
    assertEquals(result.commits_ahead, 1);
  });
});

Deno.test("branch-delta: a branch cut with no commits yet reports no-divergence, not a fork point", async () => {
  // Needs a repo where EVERY other ref's merge-base is HEAD, so `main` alone —
  // in a repo that also has `feature`, a freshly cut branch still diverges from
  // `main` and a real fork point resolves.
  const root = await Deno.makeTempDir({ prefix: "branch-delta-" });
  try {
    await git(root, "init", "--initial-branch=main");
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "Test");
    await commit(root, "README.md", "# seed\n", "base", 1);
    await git(root, "checkout", "-b", "feature-fresh");

    // HEAD still captures everything, so this fallback is complete rather than
    // narrowed — which is why the reason field distinguishes it from the others.
    const result = await resolve(root);

    assertEquals(result.fallback, true);
    assertEquals(result.reason, "no-divergence");
    assertEquals(result.diff_ref, "HEAD");
    assertEquals(result.delta_empty, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("branch-delta: a dirty tree is reported as delta in its own right", async () => {
  await withRepo(async (root) => {
    // Asserted on `uncommitted`, and against a clean baseline first.
    //
    // This case used to assert only `delta_empty === false` — but `seed()` puts TWO commits
    // on `feature`, so that was already false before the write, and the test passed with its
    // own subject deleted. `uncommitted` was then the one emitted field nothing anywhere
    // read: the test named for it measured something else.
    const clean = await resolve(root);
    assertEquals(clean.uncommitted, false);
    assertEquals(clean.delta_empty, false, "the seeded commits alone make the delta non-empty");

    await Deno.writeTextFile(join(root, "services/auth/token.ts"), "export const a = 99;\n");

    const dirty = await resolve(root);
    assertEquals(dirty.uncommitted, true);
    assertEquals(dirty.delta_empty, false);
    assert(!dirty.fallback);
  });
});

/** Run the script raw, without the non-zero-exit throw `resolve` applies. */
const runRaw = async (root: string, args: string[]): Promise<{ code: number; stderr: string }> => {
  const { code, stderr } = await new Deno.Command("bash", {
    args: [SCRIPT, ...args],
    cwd: root,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: root, PWD: root },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, stderr: new TextDecoder().decode(stderr) };
};

Deno.test("branch-delta: argv errors exit 2, and --help exits 0", async () => {
  await withRepo(async (root) => {
    // An unknown subcommand is REFUSED, never quietly treated as the default: a typo that
    // returned facts would look like it worked while handing back an entirely different
    // shape than the caller asked for.
    const bogus = await runRaw(root, ["codex", "bogus"]);
    assertEquals(bogus.code, 2);
    assertStringIncludes(bogus.stderr, "unknown subcommand");

    const noRef = await runRaw(root, ["codex", "diff", "--ref"]);
    assertEquals(noRef.code, 2);
    assertStringIncludes(noRef.stderr, "--ref needs a value");

    // A path that is neither tracked nor on disk is an error rather than empty output —
    // empty is what a diff of an untracked file looks like, and the two must not read alike.
    const missing = await runRaw(root, ["codex", "diff", "nope.ts"]);
    assertEquals(missing.code, 1);
    assertStringIncludes(missing.stderr, "no such path");

    assertEquals((await runRaw(root, [])).code, 2);
    assertEquals((await runRaw(root, ["--help"])).code, 0);
  });
});

/** stdout of a `diff` invocation; throws on a non-zero exit, like `resolve`. */
const runDiff = async (root: string, args: string[]): Promise<string> => {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [SCRIPT, "codex", "diff", ...args],
    cwd: root,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: root, PWD: root },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(`branch-delta diff exited ${code}: ${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder().decode(stdout);
};

/** A tracked edit plus a never-seen-by-git file — the two halves the merge has to join. */
const seedWorkingChanges = async (root: string): Promise<void> => {
  await Deno.writeTextFile(join(root, "services/auth/token.ts"), "export const a = 99;\n");
  await Deno.writeTextFile(join(root, "services/auth/session.ts"), "export const s = 1;\n");
};

Deno.test("branch-delta: changed_files merges all four states no single git command reports", async () => {
  // Its own repository, because `withRepo`'s base commit holds one file and the four states
  // need two: `modified` and `deleted` are only reachable for a path that EXISTS at the fork
  // point. A file created on this branch and then edited still reads `added` — the diff is
  // taken against the merge-base, not against the branch tip.
  const root = await Deno.makeTempDir({ prefix: "branch-delta-" });
  try {
    await git(root, "init", "--initial-branch=main");
    await git(root, "config", "user.email", "test@example.com");
    await git(root, "config", "user.name", "Test");
    await commit(root, "README.md", "# seed\n", "base", 1);
    await commit(root, "services/legacy/guard.ts", "export const g = 1;\n", "guard", 2);
    await git(root, "checkout", "-b", "feature");
    await commit(root, "services/auth/token.ts", "export const a = 1;\n", "added", 3);

    await Deno.writeTextFile(join(root, "services/legacy/guard.ts"), "export const g = 2;\n");
    await git(root, "rm", "-q", "README.md");
    await Deno.writeTextFile(join(root, "services/auth/session.ts"), "export const s = 1;\n");

    const byPath = new Map(
      (await resolve(root)).changed_files.map((f) => [f.path, f.status] as const),
    );

    // Each of these is what one half of the old two-command merge would have dropped:
    // `git diff` never lists the untracked file, `git status` never lists a path that is
    // only committed, and neither alone carries the status that tells them apart.
    assertEquals(byPath.get("services/auth/token.ts"), "added");
    assertEquals(byPath.get("services/legacy/guard.ts"), "modified");
    assertEquals(byPath.get("README.md"), "deleted");
    assertEquals(byPath.get("services/auth/session.ts"), "untracked");
    assertEquals(byPath.size, 4);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("branch-delta: changed_files reports a path git would have octal-escaped", async () => {
  await withRepo(async (root) => {
    // Under core.quotePath — git's DEFAULT — `git diff --name-only` renders this as
    // "services/auth/f\303\266o.ts": quoted, escaped, and unusable as a path without
    // decoding. The command form this replaced handed that string to the agent, which had
    // nowhere to undo it. `-z` is what makes the resolved form give back the real name.
    const name = "services/auth/föo.ts";
    await Deno.writeTextFile(join(root, name), "export const f = 1;\n");

    const paths = (await resolve(root)).changed_files.map((f) => f.path);

    assert(
      paths.includes(name),
      `expected the literal path; got ${JSON.stringify(paths)}`,
    );
  });
});

Deno.test("branch-delta: changed_files honours .gitignore, so the skill's own folder drops out", async () => {
  await withRepo(async (root) => {
    // `.ingrain-security/` self-ignores with a bare `*`. Without --exclude-standard the
    // assessment file the review is writing shows up as part of the change under review.
    await Deno.mkdir(join(root, ".ingrain-security"), { recursive: true });
    await Deno.writeTextFile(join(root, ".ingrain-security/.gitignore"), "*\n");
    await Deno.writeTextFile(join(root, ".ingrain-security/assessment-x.md"), "# a\n");

    const paths = (await resolve(root)).changed_files.map((f) => f.path);

    assertEquals(paths.filter((p) => p.startsWith(".ingrain-security/")), []);
  });
});

Deno.test("branch-delta diff: renders the whole delta, and narrows to a path", async () => {
  await withRepo(async (root) => {
    await seedWorkingChanges(root);
    const { diff_ref } = await resolve(root);

    const whole = await runDiff(root, ["--ref", diff_ref]);
    assertStringIncludes(whole, "services/auth/token.ts");
    assertStringIncludes(whole, "export const a = 99;");

    const narrowed = await runDiff(root, ["--ref", diff_ref, "services/auth/token.ts"]);
    assertStringIncludes(narrowed, "services/auth/token.ts");
    assert(
      !narrowed.includes("services/billing/invoice.ts"),
      "a narrowed diff still carried another path's hunk",
    );
  });
});

Deno.test("branch-delta diff: an untracked file prints its contents, not nothing", async () => {
  await withRepo(async (root) => {
    await seedWorkingChanges(root);
    const { diff_ref } = await resolve(root);

    // The case a diff CANNOT report: git has no blob to compare against, so `git diff` on
    // an untracked path prints nothing at all — indistinguishable from "unchanged" for the
    // files most likely to BE the change. Both routes to it are covered.
    const alone = await runDiff(root, ["--ref", diff_ref, "services/auth/session.ts"]);
    assertStringIncludes(alone, "NEW FILE (untracked): services/auth/session.ts");
    assertStringIncludes(alone, "export const s = 1;");

    const whole = await runDiff(root, ["--ref", diff_ref]);
    assertStringIncludes(whole, "NEW FILE (untracked): services/auth/session.ts");
    assertStringIncludes(whole, "export const s = 1;");
  });
});

Deno.test("branch-delta diff: --ref pins the basis the caller was given", async () => {
  await withRepo(async (root) => {
    // Pinning is what holds a multi-verifier run to ONE change while the tree keeps moving.
    // Diffing against this branch's tip must show none of the branch's own commits, where
    // diffing against the fork point shows all of them — so a --ref that were ignored, or
    // silently replaced by a re-resolve, fails here rather than passing quietly.
    const tip = await git(root, "rev-parse", "HEAD");
    const { diff_ref } = await resolve(root);
    assert(tip !== diff_ref, "the fixture must make the two refs differ for this to mean anything");

    assertStringIncludes(await runDiff(root, ["--ref", diff_ref]), "services/auth/token.ts");
    assertEquals(await runDiff(root, ["--ref", tip]), "");
  });
});

Deno.test("branch-delta diff: output stays plain when the repo config would colour it", async () => {
  await withRepo(async (root) => {
    // The repo's own config otherwise decides what the agent reads. Centralizing the
    // commands buys nothing if each one still renders per-machine, so the script pins
    // --no-pager/--no-color/--no-ext-diff and this is what holds that pinning in place.
    await git(root, "config", "color.ui", "always");
    await git(root, "config", "color.diff", "always");
    const { diff_ref } = await resolve(root);

    const out = await runDiff(root, ["--ref", diff_ref]);

    assert(out.length > 0, "the fixture produced no diff, so the assertion below is vacuous");
    assert(
      !out.includes("["),
      `ANSI escapes reached the agent: ${JSON.stringify(out.slice(0, 120))}`,
    );
  });
});

Deno.test("branch-delta diff: a bad ref fails loudly instead of reading as an empty change", async () => {
  await withRepo(async (root) => {
    // Audit H3. Every git failure used to be swallowed by the trailing `while` loop, so a stale
    // `diff_ref` gave exit 0 and zero bytes — which a verifier reads as "nothing changed" and
    // reports a clean verdict on a change it never saw.
    const bad = await runRaw(root, ["codex", "diff", "--ref", "no-such-ref-xyz"]);
    assert(bad.code !== 0, "a bad ref exited 0; a verifier would read that as an empty change");

    // The other half: a fix that simply failed on everything would satisfy the line above.
    const { diff_ref } = await resolve(root);
    assert((await runDiff(root, ["--ref", diff_ref])).length > 0);
  });
});

Deno.test("branch-delta diff: refuses a symlink and a traversal, and still renders ordinary files", async () => {
  await withRepo(async (root) => {
    // Audit H4. `cat "$root/$path"` followed symlinks, so a repo carrying `notes -> ~/.ssh/id_rsa`
    // read that key into the review context under a "NEW FILE" banner.
    await Deno.symlink("/etc/hostname", join(root, "leak"));
    await Deno.writeTextFile(join(root, "services/auth/ordinary.ts"), "export const o = 1;\n");
    const { diff_ref } = await resolve(root);

    const whole = await runDiff(root, ["--ref", diff_ref]);
    assert(
      !whole.includes("=== NEW FILE (untracked): leak"),
      "a symlink was rendered as a new file",
    );
    // The third assertion is the one that matters: a fix that dropped ALL untracked output would
    // pass the two above.
    assertStringIncludes(whole, "=== NEW FILE (untracked): services/auth/ordinary.ts");

    const outside = await runRaw(root, ["codex", "diff", "--ref", diff_ref, "../escape.ts"]);
    assert(outside.code !== 0, "a `..` path argument was rendered as part of the change");
  });
});

Deno.test("branch-delta diff: --ref refuses a value git would read as an option", async () => {
  await withRepo(async (root) => {
    // Audit M10's symptom: `--ref --output=FILE` reached git as an option and created the file,
    // from a script whose header claimed it writes nothing.
    const marker = join(root, "written-by-git");
    const injected = await runRaw(root, ["codex", "diff", "--ref", `--output=${marker}`]);
    assertEquals(injected.code, 2);
    assertStringIncludes(injected.stderr, "must be a revision");
    assert(!(await exists(marker)), "the script wrote a file through an injected git option");
  });
});

Deno.test("branch-delta: a path in both the diff and the untracked set appears exactly once", async () => {
  await withRepo(async (root) => {
    // Audit M2. `git rm --cached` — the standard way to untrack a wrongly-committed secret —
    // leaves a path in BOTH queries, falsifying the "disjoint by construction" claim that
    // justified dropping `sort -u`. The reviewer was told "deleted" about a file still on disk.
    await git(root, "rm", "-q", "--cached", "services/auth/token.ts");

    const entries = (await resolve(root)).changed_files
      .filter((f) => f.path === "services/auth/token.ts");

    // The COUNT is the assertion — it stays valid whichever status wins the collision.
    assertEquals(entries.length, 1, `expected one entry, got ${JSON.stringify(entries)}`);
  });
});

Deno.test("branch-delta: origin/HEAD does not become the fork point", async () => {
  await withRepo(async (root) => {
    // Audit H5. `%(refname:short)` renders `refs/remotes/origin/HEAD` as bare `origin`, which
    // matched neither exclusion — so the last push won the most-recent contest and every pushed
    // commit vanished from the review, with `fallback: false` and no caveat.
    await git(root, "remote", "add", "origin", "git@github.com:acme/widgets.git");
    await git(root, "update-ref", "refs/remotes/origin/feature", "HEAD");
    await git(root, "update-ref", "refs/remotes/origin/main", "main");
    await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/feature");

    const result = await resolve(root);

    // Both exact values matter: before the fix this was `origin` and 1, so a change that merely
    // stopped emitting the bare remote name would still fail on the count.
    assertEquals(result.base_ref, "main");
    assertEquals(result.commits_ahead, 2);
  });
});

/**
 * Behavioral tests for the `hooks/claude/allow-assessment-write` PreToolUse hook —
 * the one thing standing between the user and a permission prompt on every assessment
 * write. Like its siblings these EXECUTE the script under bash against a throwaway
 * project dir, so they need the `test:hooks` run+write permissions.
 *
 * The hook has exactly two outcomes, and the tests are organised around them:
 *   ALLOW  — stdout carries `permissionDecision: "allow"`; the prompt is skipped.
 *   DEFER  — stdout is empty; the user's normal permission prompt stands.
 *
 * DEFER is the safe outcome, so every ambiguous, malformed or hostile input must land
 * there. The hook must NEVER emit "deny" (it can only remove a prompt, never add a
 * block) and must always exit 0 — a hook error must not break the user's tool call.
 * Those two invariants are asserted on every case via `runHook`.
 *
 * git repos are set up THROUGH the spawned bash (`bash -c "git init …"`), which stays
 * inside the `--allow-run=bash` profile — Deno only gates directly-spawned processes.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const HOOK = `${ROOT}hooks/claude/allow-assessment-write`;
const MINT = `${ROOT}skills/ingrain-security/scripts/assessment-path`;
const MINT_RULES = `${ROOT}skills/ingrain-security/scripts/rules-path`;

interface IHookResult {
  code: number;
  stdout: string;
  allowed: boolean;
}

/**
 * Pipe a hook payload to the hook and classify the verdict. `clearEnv` keeps the
 * runner's own `CLAUDE_PROJECT_DIR` from leaking in and retargeting the project root.
 *
 * Asserts the two invariants on every single call, so no individual test has to
 * remember them: exit 0 always, and "deny" never appears in stdout.
 */
async function runHook(
  payload: string,
  opts: { projectDir?: string; cwd?: string } = {},
): Promise<IHookResult> {
  const proc = new Deno.Command("bash", {
    args: [HOOK],
    cwd: opts.cwd,
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "",
      ...(opts.projectDir ? { CLAUDE_PROJECT_DIR: opts.projectDir } : {}),
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(payload));
  await writer.close();

  const out = await proc.output();
  const stdout = new TextDecoder().decode(out.stdout);

  assertEquals(out.code, 0, "the hook must always exit 0");
  assertEquals(stdout.includes("deny"), false, 'the hook must never emit "deny"');

  return { code: out.code, stdout, allowed: stdout.includes('"permissionDecision":"allow"') };
}

/** A PreToolUse payload for a file-editing tool. */
function payload(
  toolName: string,
  filePath: string,
  cwd: string,
  extra: Record<string, string> = {},
): string {
  return JSON.stringify({
    session_id: "test",
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { file_path: filePath, ...extra },
  });
}

/** Run `fn` against a fresh throwaway git project with the assessment folder seeded. */
async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-allow-" });
  await sh(`git init -q "${dir}" && mkdir -p "${dir}/.ingrain-security" "${dir}/src"`);
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/**
 * Run a shell snippet through bash (stays inside the --allow-run=bash profile). Pass
 * `cwd` rather than interpolating a path into the script when the path may carry shell
 * metacharacters — a quote in the path would otherwise break out of the snippet.
 */
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

// ---------------------------------------------------------------------------
// ALLOW — the assessment file itself
// ---------------------------------------------------------------------------

Deno.test("allow: the path the minter actually produces", async () => {
  await withProject(async (dir) => {
    // Drive the REAL minter rather than hand-building the path: if the two ever
    // disagree on naming or location, the whole feature silently stops working and
    // this is the test that catches it.
    const out = await new Deno.Command("bash", {
      args: [MINT, "claude", "mint", "--title", "Add authn"],
      clearEnv: true,
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        HOME: Deno.env.get("HOME") ?? "",
        CLAUDE_PROJECT_DIR: dir,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const minted = JSON.parse(new TextDecoder().decode(out.stdout)) as { assessment_abs: string };

    const res = await runHook(payload("Write", minted.assessment_abs, dir), { projectDir: dir });
    assertEquals(res.allowed, true);
    assertStringIncludes(res.stdout, '"hookEventName":"PreToolUse"');
    assertStringIncludes(res.stdout, "ingrain-security assessment file");
  });
});

Deno.test("allow: every file-editing tool, on both naming forms", async () => {
  await withProject(async (dir) => {
    for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
      for (
        const name of [
          "assessment.md",
          "assessment-main-add-authn.md",
          "rules.md",
          "rules-main-add-authn.md",
        ]
      ) {
        const res = await runHook(
          payload(tool, `${dir}/.ingrain-security/${name}`, dir),
          { projectDir: dir },
        );
        assertEquals(res.allowed, true, `${tool} on ${name} should be allowed`);
      }
    }
  });
});

Deno.test("allow: the rules sidecar path the minter actually produces", async () => {
  await withProject(async (dir) => {
    // Same contract as the assessment case: drive the REAL rules-path minter so a naming
    // drift between the minter and the grant is caught here.
    const out = await new Deno.Command("bash", {
      args: [MINT_RULES, "claude", "mint", "--title", "Add authn"],
      clearEnv: true,
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        HOME: Deno.env.get("HOME") ?? "",
        CLAUDE_PROJECT_DIR: dir,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const minted = JSON.parse(new TextDecoder().decode(out.stdout)) as { rules_abs: string };

    const res = await runHook(payload("Write", minted.rules_abs, dir), { projectDir: dir });
    assertEquals(res.allowed, true);
  });
});

Deno.test("allow: a relative file_path, resolved against the payload's cwd", async () => {
  await withProject(async (dir) => {
    const res = await runHook(
      payload("Write", ".ingrain-security/assessment.md", dir),
      { projectDir: dir },
    );
    assertEquals(res.allowed, true);
  });
});

Deno.test("allow: project root from the git root when CLAUDE_PROJECT_DIR is unset", async () => {
  await withProject(async (dir) => {
    // No projectDir: the hook must fall back to the git root, exactly as the
    // SessionStart hook and the minter do.
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/assessment.md`, dir),
      { cwd: dir },
    );
    assertEquals(res.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// DEFER — outside the grant
// ---------------------------------------------------------------------------

Deno.test("defer: a file in the folder that is neither an assessment nor a rules file", async () => {
  await withProject(async (dir) => {
    // The grant covers only assessment*.md and rules*.md — a `.bak` suffix, a decoy
    // basename, or an unrelated name must all still fall through to the user's prompt.
    for (
      const name of [
        "README.md",
        ".gitignore",
        "notes.txt",
        "assessment.md.bak",
        "rules.md.bak",
        "evil.md",
      ]
    ) {
      const res = await runHook(
        payload("Write", `${dir}/.ingrain-security/${name}`, dir),
        { projectDir: dir },
      );
      assertEquals(res.allowed, false, `${name} must not be auto-approved`);
    }
  });
});

Deno.test("defer: a nested path under the folder", async () => {
  await withProject(async (dir) => {
    await sh(`mkdir -p "${dir}/.ingrain-security/notes"`);
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/notes/assessment.md`, dir),
      { projectDir: dir },
    );
    assertEquals(res.allowed, false);
  });
});

Deno.test("defer: a `..` traversal out of the folder", async () => {
  await withProject(async (dir) => {
    // The literal string contains `<root>/.ingrain-security/`, so a naive prefix check
    // would approve a write to the project's source tree. The parent is canonicalized
    // before the containment test precisely to stop this.
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/../src/app.ts`, dir),
      { projectDir: dir },
    );
    assertEquals(res.allowed, false);
  });
});

Deno.test("defer: an assessment path in a DIFFERENT project", async () => {
  await withProject(async (dir) => {
    await withProject(async (other) => {
      const res = await runHook(
        payload("Write", `${other}/.ingrain-security/assessment.md`, dir),
        { projectDir: dir },
      );
      assertEquals(res.allowed, false);
    });
  });
});

Deno.test("defer: any path outside the folder", async () => {
  await withProject(async (dir) => {
    for (const p of [`${dir}/src/app.ts`, `${dir}/assessment.md`, "/etc/passwd"]) {
      const res = await runHook(payload("Write", p, dir), { projectDir: dir });
      assertEquals(res.allowed, false, `${p} must not be auto-approved`);
    }
  });
});

Deno.test("defer: the target is a symlink", async () => {
  await withProject(async (dir) => {
    // Correctly named and in the right folder, but the write would follow the link
    // straight out of the tree.
    await sh(`ln -s /etc/passwd "${dir}/.ingrain-security/assessment-evil.md"`);
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/assessment-evil.md`, dir),
      { projectDir: dir },
    );
    assertEquals(res.allowed, false);
  });
});

Deno.test("defer: a symlinked rules-* target", async () => {
  await withProject(async (dir) => {
    // The widened grant must apply the same symlink guard to rules*.md as to assessment*.md.
    await sh(`ln -s /etc/passwd "${dir}/.ingrain-security/rules-evil.md"`);
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/rules-evil.md`, dir),
      { projectDir: dir },
    );
    assertEquals(res.allowed, false);
  });
});

Deno.test("defer: a rules-named `..` traversal out of the folder", async () => {
  await withProject(async (dir) => {
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/../src/rules-x.md`, dir),
      { projectDir: dir },
    );
    assertEquals(res.allowed, false);
  });
});

Deno.test("defer: the assessment folder itself is a symlink", async () => {
  await withProject(async (dir) => {
    const outside = await Deno.makeTempDir({ prefix: "ingrain-outside-" });
    await sh(
      `rm -rf "${dir}/.ingrain-security" && ln -s "${outside}" "${dir}/.ingrain-security"`,
    );
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/assessment.md`, dir),
      { projectDir: dir },
    );
    assertEquals(res.allowed, false);
    await Deno.remove(outside, { recursive: true });
  });
});

Deno.test("defer: a tool that is not a file-editing tool", async () => {
  await withProject(async (dir) => {
    // The hook.json matcher is a convenience filter, not a security boundary, so the
    // script re-checks the tool name itself.
    for (const tool of ["Bash", "Read", "Task"]) {
      const res = await runHook(
        payload(tool, `${dir}/.ingrain-security/assessment.md`, dir),
        { projectDir: dir },
      );
      assertEquals(res.allowed, false, `${tool} must not be auto-approved`);
    }
  });
});

// ---------------------------------------------------------------------------
// DEFER — hostile and malformed payloads
// ---------------------------------------------------------------------------

Deno.test("defer: a decoy file_path planted in the tool's content", async () => {
  await withProject(async (dir) => {
    // THE attack this hook has to survive. `content` is attacker-influenceable text; a
    // decoy `"file_path":"…/assessment.md"` inside it must not win the match and turn
    // the hook into an approve-anything primitive for the REAL target (src/app.ts).
    const hostile = payload("Write", `${dir}/src/app.ts`, dir, {
      content: `"file_path":"${dir}/.ingrain-security/assessment.md"`,
    });
    const res = await runHook(hostile, { projectDir: dir });
    assertEquals(res.allowed, false);
  });
});

Deno.test("defer: a decoy file_path key placed BEFORE the real one", async () => {
  await withProject(async (dir) => {
    // The sharpest version of the attack. Hand-built (not via JSON.stringify) so both
    // `file_path` keys are genuinely unescaped, with the decoy first — a leftmost-match
    // text scan would read the assessment path, approve, and let the tool write to
    // src/app.ts instead. Addressing `.tool_input.file_path` structurally reads the real
    // target, which is outside the grant, so the hook defers.
    const hostile = '{"tool_name":"Write","tool_input":{' +
      `"nested":{"file_path":"${dir}/.ingrain-security/assessment.md"},` +
      `"file_path":"${dir}/src/app.ts"},"cwd":"${dir}"}`;
    const res = await runHook(hostile, { projectDir: dir });
    assertEquals(res.allowed, false);
  });
});

Deno.test("allow: hostile-looking content does not taint a legitimate target", async () => {
  await withProject(async (dir) => {
    // The mirror image: a decoy sitting inside `content` is just a string value, never a
    // key the parse looks at. The write targets the real assessment file, which is exactly
    // the sanctioned action — the content it carries is none of this hook's business.
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/assessment.md`, dir, {
        content: `an assessment discussing "file_path":"/etc/passwd" in a hook`,
      }),
      { projectDir: dir },
    );
    assertEquals(res.allowed, true);
  });
});

Deno.test("defer: malformed, empty, or incomplete payloads", async () => {
  await withProject(async (dir) => {
    const bad = [
      "",
      "{not json",
      "{}",
      '{"tool_name":"Write"}', // no file_path
      '{"tool_input":{"file_path":"x"}}', // no tool_name
      '{"tool_name":"Write","tool_input":{"file_path":""}}', // empty file_path
    ];
    for (const p of bad) {
      const res = await runHook(p, { projectDir: dir });
      assertEquals(res.allowed, false, `payload ${JSON.stringify(p)} must defer`);
    }
  });
});

Deno.test("defer: the assessment folder does not exist yet", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-bare-" });
  try {
    await sh(`git init -q "${dir}"`);
    const res = await runHook(
      payload("Write", `${dir}/.ingrain-security/assessment.md`, dir),
      { projectDir: dir },
    );
    assertEquals(res.allowed, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Path escaping
// ---------------------------------------------------------------------------

Deno.test("a project path with quotes and backslashes is extracted intact", async () => {
  const parent = await Deno.makeTempDir({ prefix: "ingrain-quote-" });
  // Chars that a JSON string must escape. Built with Deno.mkdir and a cwd-scoped git
  // init — interpolating this path into a shell snippet is what the quote would break.
  const weird = `${parent}/pr"oj\\ekt`;
  try {
    await Deno.mkdir(`${weird}/.ingrain-security`, { recursive: true });
    await sh("git init -q .", weird);
    // JSON.stringify escapes the quote and the backslash; the hook must unescape them
    // back to the real path rather than truncating at the embedded quote.
    const res = await runHook(
      payload("Write", `${weird}/.ingrain-security/assessment.md`, weird),
      { projectDir: weird },
    );
    assertEquals(res.allowed, true);
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

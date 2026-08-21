/**
 * **Behavioral tests for `hooks/scripts/require-review-before-write` — the review gate.**
 *
 * The gate is the only hook in this plugin that can BLOCK, so its two failure directions are
 * not symmetric and both are covered here:
 *
 * - **Failing shut where it should stand aside** strands a session. Every ambiguity — a
 *   malformed payload, an unresolvable branch, a tool it does not handle — must defer, and the
 *   skill's own writes must never be gated or the flow a denial routes to cannot complete.
 * - **Failing open where it should block** is the gate quietly not existing. The sharpest case
 *   is the seeded skeleton: its `## Triage` field card spells out `Verdict (minor|major)` in
 *   its own prose, so a loose match reads the card as a decision and reports every untouched
 *   assessment as reviewed. That case is exercised against a skeleton produced by the REAL
 *   `assessment-mint`, not a hand-written stand-in, because a stand-in that omits the card
 *   would pass while the gate was inverted in production.
 *
 * Both hosts run the same script, so each case that depends on payload shape is stated twice:
 * Claude names one target in `tool_input.file_path`, Codex hands over an apply_patch envelope.
 *
 * Runs the script under bash against a throwaway git project — the `test:hooks` permissions.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const GATE = `${ROOT}hooks/scripts/require-review-before-write`;
const MINT = `${ROOT}skills/ingrain-security/scripts/assessment-mint`;

type TDecision = "deny" | "defer";

interface IGateResult {
  decision: TDecision;
  /** The parsed denial envelope, present only when the gate denied. */
  // deno-lint-ignore no-explicit-any
  json?: any;
}

/** Run a shell snippet through bash (stays inside the --allow-run=bash profile). */
async function sh(script: string, cwd?: string): Promise<void> {
  const out = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd,
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "" },
    stdout: "null",
    stderr: "piped",
  }).output();
  if (out.code !== 0) throw new Error(new TextDecoder().decode(out.stderr));
}

/**
 * Feed `payload` to the gate and report what it decided.
 *
 * Empty stdout IS the defer signal — the gate's "no opinion" is silence, not a JSON verdict —
 * so the absence of output is asserted as a decision rather than treated as a missing result.
 */
async function runGate(
  payload: Record<string, unknown>,
  opts: { projectDir: string; host?: string },
): Promise<IGateResult> {
  const host = opts.host ?? "claude";
  const out = await new Deno.Command("bash", {
    args: [GATE, host],
    cwd: opts.projectDir,
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      // Claude resolves the root from this; Codex ignores it by design and uses the git root,
      // which is why every project here is a real repo.
      CLAUDE_PROJECT_DIR: opts.projectDir,
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const writer = out.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(payload)));
  await writer.close();

  const res = await out.output();
  assertEquals(res.code, 0, "the gate must always exit 0");
  const stdout = new TextDecoder().decode(res.stdout).trim();
  if (stdout === "") return { decision: "defer" };
  return { decision: "deny", json: JSON.parse(stdout) };
}

/** A Claude file-write payload. */
const claudeWrite = (filePath: string, dir: string) => ({
  tool_name: "Write",
  tool_input: { file_path: filePath },
  cwd: dir,
});

/** A Codex apply_patch payload updating each of `files`. */
const codexPatch = (files: string[], dir: string) => ({
  tool_name: "apply_patch",
  tool_input: {
    command: [
      "apply_patch",
      "*** Begin Patch",
      ...files.flatMap((f) => [`*** Update File: ${f}`, "@@", "-old", "+new"]),
      "*** End Patch",
    ].join("\n"),
  },
  cwd: dir,
});

/** Fresh throwaway git project on `branch`, with the assessment folder seeded. */
async function withProject(
  branch: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "review-gate-" });
  await sh(
    `git init -q . && git checkout -q -b "${branch}" && mkdir -p .ingrain-security src`,
    dir,
  );
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Write a minimal assessment carrying `verdict` (empty string = an unanswered skeleton). */
async function writeAssessment(dir: string, slug: string, verdict: string): Promise<void> {
  await Deno.writeTextFile(
    `${dir}/.ingrain-security/assessment-${slug}-task.md`,
    `# Security assessment\n\n## Task\nTitle: t\n\n## Triage\nVerdict: ${verdict}\nSecurity relevant:\n`,
  );
}

// ---------------------------------------------------------------------------
// It blocks where no answer is recorded
// ---------------------------------------------------------------------------

Deno.test("gate: denies a code write when no assessment exists at all", async () => {
  await withProject("feature/thing", async (dir) => {
    const res = await runGate(claudeWrite("src/app.ts", dir), { projectDir: dir });
    assertEquals(res.decision, "deny");
  });
});

Deno.test("gate: denies when the Verdict field is present but unanswered", async () => {
  await withProject("feature/thing", async (dir) => {
    await writeAssessment(dir, "feature-thing", "");
    const res = await runGate(claudeWrite("src/app.ts", dir), { projectDir: dir });
    assertEquals(res.decision, "deny");
  });
});

Deno.test("gate: denies against a REAL seeded skeleton, whose card names both verdicts", async () => {
  // The inversion case, and the reason this suite exists. `assessment-mint` seeds the genuine
  // template, whose `## Triage` card contains the literal text `Verdict (minor|major)`. A
  // whole-file or unanchored match reads that prose as a recorded decision and lets every
  // untouched skeleton through — the gate silently ceasing to exist while staying green
  // against any hand-written fixture that happens to omit the card.
  await withProject("feature/real", async (dir) => {
    await sh(`CLAUDE_PROJECT_DIR="${dir}" bash "${MINT}" claude --title "real skeleton"`, dir);

    const seeded = [...Deno.readDirSync(`${dir}/.ingrain-security`)]
      .map((e) => e.name).filter((n) => n.startsWith("assessment-"));
    assertEquals(seeded.length, 1, "the mint should have seeded exactly one skeleton");
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/.ingrain-security/${seeded[0]}`),
      "Verdict (minor|major)",
      "fixture is vacuous: the seeded card no longer carries the text that can be misread",
    );

    const res = await runGate(claudeWrite("src/app.ts", dir), { projectDir: dir });
    assertEquals(res.decision, "deny", "a seeded skeleton must read as 'not asked'");
  });
});

Deno.test("gate: denies when the only recorded answer belongs to another branch", async () => {
  // The gate is branch-scoped: a review answered on some other branch says nothing about
  // whether the user was asked about THIS change.
  await withProject("feature/thing", async (dir) => {
    await writeAssessment(dir, "some-other-branch", "major");
    const res = await runGate(claudeWrite("src/app.ts", dir), { projectDir: dir });
    assertEquals(res.decision, "deny");
  });
});

// ---------------------------------------------------------------------------
// It stands aside once the user has answered
// ---------------------------------------------------------------------------

Deno.test("gate: defers once the user declined — Verdict: minor", async () => {
  // `minor` is an ANSWER, not a gap: the user was asked and said no. This is the in-band
  // decline, and it is why the hook ships no opt-out flag.
  await withProject("feature/thing", async (dir) => {
    await writeAssessment(dir, "feature-thing", "minor");
    const res = await runGate(claudeWrite("src/app.ts", dir), { projectDir: dir });
    assertEquals(res.decision, "defer");
  });
});

Deno.test("gate: defers once the user accepted — Verdict: major", async () => {
  await withProject("feature/thing", async (dir) => {
    await writeAssessment(dir, "feature-thing", "major");
    const res = await runGate(claudeWrite("src/app.ts", dir), { projectDir: dir });
    assertEquals(res.decision, "defer");
  });
});

Deno.test("gate: never blocks a write to the assessment file itself", async () => {
  // Without this the gate deadlocks the flow it routes to: the skill has to write the very
  // Verdict the gate reads before the gate will stand aside.
  await withProject("feature/thing", async (dir) => {
    await writeAssessment(dir, "feature-thing", "");
    const res = await runGate(
      claudeWrite(".ingrain-security/assessment-feature-thing-task.md", dir),
      { projectDir: dir },
    );
    assertEquals(res.decision, "defer");
  });
});

Deno.test("gate: never blocks an assessment write outside the resolved project root", async () => {
  // The regression the live agent tier caught, and the reason the exemption is lexical.
  // A dispatched worker's assessment can sit in a different tree — a temp dir, a second
  // checkout, a git worktree — and the exemption has to hold there too. Resolving the caller's
  // project root first made it conditional on the write landing under that root, so a worker
  // was denied the one write it is permitted and the review deadlocked: the gate demanding a
  // Verdict that only the blocked write could record.
  await withProject("feature/thing", async (dir) => {
    const elsewhere = await Deno.makeTempDir({ prefix: "review-gate-elsewhere-" });
    try {
      await Deno.mkdir(`${elsewhere}/.ingrain-security`);
      const target = `${elsewhere}/.ingrain-security/assessment-worker-task.md`;
      await Deno.writeTextFile(target, "# elsewhere\n");
      const res = await runGate(claudeWrite(target, dir), { projectDir: dir });
      assertEquals(res.decision, "defer");
    } finally {
      await Deno.remove(elsewhere, { recursive: true });
    }
  });
});

Deno.test("gate: the exemption does not extend to other files in the folder", async () => {
  // Permissive on location, still narrow on identity — otherwise `.ingrain-security/` becomes
  // a folder you can drop any file into unreviewed.
  await withProject("feature/thing", async (dir) => {
    const res = await runGate(claudeWrite(".ingrain-security/notes.md", dir), {
      projectDir: dir,
    });
    assertEquals(res.decision, "deny");
  });
});

Deno.test("gate: the exemption does not extend to an assessment-named file elsewhere", async () => {
  // Both halves are required: the name AND the containing folder. Otherwise `src/assessment.md`
  // is a free pass.
  await withProject("feature/thing", async (dir) => {
    const res = await runGate(claudeWrite("src/assessment-x.md", dir), { projectDir: dir });
    assertEquals(res.decision, "deny");
  });
});

// ---------------------------------------------------------------------------
// It fails open on anything it cannot judge
// ---------------------------------------------------------------------------

Deno.test("gate: defers on a detached HEAD", async () => {
  // An unresolvable branch is "cannot tell", never "not reviewed" — blocking on doubt is the
  // one failure mode a guardrail must not have.
  await withProject("feature/thing", async (dir) => {
    await sh(
      `git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git checkout -q --detach`,
      dir,
    );
    const res = await runGate(claudeWrite("src/app.ts", dir), { projectDir: dir });
    assertEquals(res.decision, "defer");
  });
});

Deno.test("gate: defers on a malformed payload", async () => {
  await withProject("feature/thing", async (dir) => {
    const out = await new Deno.Command("bash", {
      args: [GATE, "claude"],
      cwd: dir,
      clearEnv: true,
      env: { PATH: Deno.env.get("PATH") ?? "", CLAUDE_PROJECT_DIR: dir },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = out.stdin.getWriter();
    await writer.write(new TextEncoder().encode("not json at all"));
    await writer.close();
    const res = await out.output();
    assertEquals(res.code, 0);
    assertEquals(new TextDecoder().decode(res.stdout).trim(), "");
  });
});

Deno.test("gate: defers on a tool it does not handle", async () => {
  // The matcher is a convenience filter; the script re-checks. Bash is deliberately outside
  // the gate's reach — this is a workflow guardrail, not a containment boundary.
  await withProject("feature/thing", async (dir) => {
    const res = await runGate(
      { tool_name: "Bash", tool_input: { command: "cat > src/app.ts" }, cwd: dir },
      { projectDir: dir },
    );
    assertEquals(res.decision, "defer");
  });
});

// ---------------------------------------------------------------------------
// Codex payload shape
// ---------------------------------------------------------------------------

Deno.test("gate: denies a Codex patch touching a source file", async () => {
  await withProject("feature/thing", async (dir) => {
    const res = await runGate(codexPatch(["src/app.ts"], dir), {
      projectDir: dir,
      host: "codex",
    });
    assertEquals(res.decision, "deny");
  });
});

Deno.test("gate: defers a Codex patch touching only the assessment", async () => {
  await withProject("feature/thing", async (dir) => {
    await writeAssessment(dir, "feature-thing", "");
    const res = await runGate(
      codexPatch([".ingrain-security/assessment-feature-thing-task.md"], dir),
      { projectDir: dir, host: "codex" },
    );
    assertEquals(res.decision, "defer");
  });
});

Deno.test("gate: denies a Codex patch mixing the assessment with a source file", async () => {
  // All-or-nothing, matching the Codex allow-hook. Otherwise "edit the assessment in the same
  // patch" is a one-line bypass of the whole gate.
  await withProject("feature/thing", async (dir) => {
    await writeAssessment(dir, "feature-thing", "");
    const res = await runGate(
      codexPatch([".ingrain-security/assessment-feature-thing-task.md", "src/app.ts"], dir),
      { projectDir: dir, host: "codex" },
    );
    assertEquals(res.decision, "deny");
  });
});

// ---------------------------------------------------------------------------
// The denial envelope
// ---------------------------------------------------------------------------

Deno.test("gate: the denial carries both a user reason and agent context, and never allows", async () => {
  await withProject("feature/thing", async (dir) => {
    const res = await runGate(claudeWrite("src/app.ts", dir), { projectDir: dir });
    assertEquals(res.decision, "deny");

    const out = res.json.hookSpecificOutput;
    assertEquals(out.hookEventName, "PreToolUse");
    assertEquals(out.permissionDecision, "deny");

    // Two readers, two fields: on Claude the reason is shown to the USER and only
    // additionalContext reaches the model, so a denial carrying just one of them is half a
    // message to somebody.
    assertStringIncludes(out.permissionDecisionReason, "ingrain-security");
    assertStringIncludes(out.additionalContext, "ingrain-security");
    assertStringIncludes(out.additionalContext, "Skill tool");

    // The escape hatch has to be IN the denial. There is no opt-out flag, so a denial that
    // does not say how to decline reads as a wall to a user who does not want a review.
    assertStringIncludes(out.additionalContext, "Verdict: minor");
  });
});

Deno.test("gate: the script can never emit an allow", async () => {
  // The inverse of allow-assessment-write's invariant, and asserted the same way — on the
  // source. That hook may only lift a prompt; this one may only add a block. Neither can
  // drift into the other's power without this failing.
  const source = await Deno.readTextFile(GATE);
  assertStringIncludes(source, '"permissionDecision":"deny"');
  assertEquals(source.includes('"permissionDecision":"allow"'), false);
  assertEquals(source.includes('"behavior":"allow"'), false);
});

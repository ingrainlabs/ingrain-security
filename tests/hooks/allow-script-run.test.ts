/**
 * Behavioral tests for the `hooks/claude/allow-script-run` PreToolUse hook — the grant
 * that keeps a review from stopping at a permission prompt every time it re-validates the
 * assessment. Like its siblings these EXECUTE the script under bash, so they need the
 * `test:hooks` run+write permissions.
 *
 * The hook has exactly two outcomes, and the tests are organised around them:
 *   ALLOW  — stdout carries `permissionDecision: "allow"`; the prompt is skipped.
 *   DEFER  — stdout is empty; the user's normal permission prompt stands.
 *
 * DEFER is the safe outcome, so every ambiguous, malformed or hostile command must land
 * there. The hook must NEVER emit "deny" (it can only remove a prompt, never add a block)
 * and must always exit 0 — a hook error must not break the user's tool call. Those two
 * invariants are asserted on every case via `runHook`.
 *
 * Approving a COMMAND is a wider grant than approving a file write, so the DEFER half
 * carries the weight here: it is the escape-the-grant catalogue (chaining, substitution,
 * redirection, expansion, an interpreter flag, a path out of the plugin).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const HOOK = `${ROOT}hooks/claude/allow-script-run`;
const SCRIPTS = `${ROOT}skills/ingrain-security/scripts`;

/** The four read-only scripts the grant covers. */
const ALLOWED = ["assessment-path", "rules-path", "branch-diff", "validate-assessment"];

interface IHookResult {
  code: number;
  stdout: string;
  allowed: boolean;
}

/**
 * Pipe a hook payload to the hook and classify the verdict. `clearEnv` keeps the runner's
 * own environment from leaking in.
 *
 * Asserts the two invariants on every single call, so no individual test has to remember
 * them: exit 0 always, and "deny" never appears in stdout.
 */
async function runHook(payload: string, hook = HOOK): Promise<IHookResult> {
  const proc = new Deno.Command("bash", {
    args: [hook],
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "" },
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

/** A PreToolUse payload for a Bash call. */
function payload(command: string, toolName = "Bash", cwd = ROOT): string {
  return JSON.stringify({
    session_id: "test",
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { command },
  });
}

/** Run a setup snippet through bash (stays inside the `--allow-run=bash` profile). */
async function sh(script: string): Promise<void> {
  const out = await new Deno.Command("bash", {
    args: ["-c", script],
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "" },
    clearEnv: true,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (out.code !== 0) {
    throw new Error(`setup failed: ${new TextDecoder().decode(out.stderr)}`);
  }
}

/** Assert a command is approved. */
async function assertAllowed(command: string, why = ""): Promise<void> {
  const res = await runHook(payload(command));
  assertEquals(res.allowed, true, `should be allowed: ${command} ${why}`);
}

/** Assert a command falls through to the normal prompt. */
async function assertDeferred(command: string, why = ""): Promise<void> {
  const res = await runHook(payload(command));
  assertEquals(res.stdout, "", `should defer: ${command} ${why}`);
}

// ---------------------------------------------------------------------------
// ALLOW — the invocations the skill actually documents
// ---------------------------------------------------------------------------

Deno.test("allow: the exact command the skill tells the agent to run", async () => {
  const res = await runHook(
    payload(`bash "${SCRIPTS}/validate-assessment" "/tmp/assessment-main-add-authn.md" --lenient`),
  );
  assertEquals(res.allowed, true);
  assertStringIncludes(res.stdout, '"hookEventName":"PreToolUse"');
  assertStringIncludes(res.stdout, "ingrain-security bundled script");
});

Deno.test("allow: every script on the allowlist, with and without the bash prefix", async () => {
  for (const name of ALLOWED) {
    await assertAllowed(`bash ${SCRIPTS}/${name} claude`);
    await assertAllowed(`${SCRIPTS}/${name} claude`, "(bare exec)");
  }
});

Deno.test("allow: quoting and spacing variants of the same call", async () => {
  await assertAllowed(`bash '${SCRIPTS}/validate-assessment' /tmp/a.md`, "(single quotes)");
  await assertAllowed(`bash  "${SCRIPTS}/validate-assessment"   /tmp/a.md `, "(extra spaces)");
  await assertAllowed(
    `bash "${SCRIPTS}/assessment-path" claude mint --title "Add authn"`,
    "(quoted argument with a space)",
  );
});

Deno.test("allow: a path that resolves into the scripts dir the long way", async () => {
  await assertAllowed(`bash ${SCRIPTS}/lib/../validate-assessment /tmp/a.md`);
});

// ---------------------------------------------------------------------------
// DEFER — anything that could carry a second command
// ---------------------------------------------------------------------------

Deno.test("defer: a second command riding along on the approval", async () => {
  const base = `bash ${SCRIPTS}/validate-assessment /tmp/a.md`;
  for (
    const rider of [
      `${base}; id`,
      `${base} && id`,
      `${base} || id`,
      `${base} | tee /tmp/x`,
      `${base}\nid`,
      `id; ${base}`,
      `${base} > /tmp/x`,
      `${base} < /tmp/x`,
      `${base} & id`,
    ]
  ) {
    await assertDeferred(rider);
  }
});

Deno.test("defer: substitution, expansion and globbing in the command", async () => {
  for (
    const command of [
      `bash ${SCRIPTS}/validate-assessment $(id)`,
      "bash ${HOME}/scripts/validate-assessment",
      `bash ${SCRIPTS}/validate-assessment \`id\``,
      `bash ${SCRIPTS}/validate-assessment*`,
      `bash ${SCRIPTS}/validate-assessment /tmp/*.md`,
      `bash ${SCRIPTS}/validate-assessment ~/a.md`,
      `bash ${SCRIPTS}/validate-assessment /tmp/a.md # ok`,
      `bash ${SCRIPTS}/validate-assessment /tmp/a.md \\`,
    ]
  ) {
    await assertDeferred(command);
  }
});

Deno.test("defer: an interpreter flag, whose argument was never parsed", async () => {
  await assertDeferred(`bash -c ${SCRIPTS}/validate-assessment`);
  await assertDeferred(`bash -lc "${SCRIPTS}/validate-assessment /tmp/a.md"`);
});

Deno.test("defer: an unterminated quote", async () => {
  await assertDeferred(`bash "${SCRIPTS}/validate-assessment /tmp/a.md`);
});

// ---------------------------------------------------------------------------
// DEFER — anything that is not one of the four scripts
// ---------------------------------------------------------------------------

Deno.test("defer: a sourceable lib, which is not on the allowlist", async () => {
  await assertDeferred(`bash ${SCRIPTS}/lib/validate-md.sh`);
  await assertDeferred(`bash ${SCRIPTS}/lib/project-root.sh`);
});

Deno.test("defer: an allowlisted NAME living outside the plugin", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-script-run-" });
  try {
    await Deno.writeTextFile(`${dir}/validate-assessment`, "#!/usr/bin/env bash\nid\n");
    await assertDeferred(`bash ${dir}/validate-assessment /tmp/a.md`, "(impostor)");
    await assertDeferred(`bash ${SCRIPTS}/../../../hooks/claude/allow-script-run`, "(escape)");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("defer: a symlink in the scripts dir standing in for a file outside it", async () => {
  // Runs against a THROWAWAY COPY of the plugin: the case only exists if an allowlisted
  // name is a symlink, and the repo's own copy must not be mutated to produce one.
  const plugin = await Deno.makeTempDir({ prefix: "ingrain-plugin-" });
  try {
    await sh(
      `mkdir -p "${plugin}/hooks" "${plugin}/skills/ingrain-security" &&` +
        ` cp -R "${ROOT}hooks/claude" "${plugin}/hooks/" &&` +
        ` cp -R "${SCRIPTS}" "${plugin}/skills/ingrain-security/" &&` +
        ` rm "${plugin}/skills/ingrain-security/scripts/validate-assessment" &&` +
        ` ln -s /bin/echo "${plugin}/skills/ingrain-security/scripts/validate-assessment"`,
    );
    const copiedScripts = `${plugin}/skills/ingrain-security/scripts`;

    // The same command is approved through the repo's real hook and deferred through the
    // copy — so the verdict turns on the symlink, not on anything else about the path.
    await assertAllowed(`bash ${SCRIPTS}/validate-assessment /tmp/a.md`, "(control)");

    const res = await runHook(
      payload(`bash ${copiedScripts}/validate-assessment /tmp/a.md`),
      `${plugin}/hooks/claude/allow-script-run`,
    );
    assertEquals(res.stdout, "", "an allowlisted name that is a symlink must defer");
  } finally {
    await Deno.remove(plugin, { recursive: true });
  }
});

Deno.test("defer: a relative script name resolved against a foreign cwd", async () => {
  const res = await runHook(payload("bash validate-assessment /tmp/a.md", "Bash", "/tmp"));
  assertEquals(res.stdout, "");
});

// ---------------------------------------------------------------------------
// DEFER — payloads this hook has no opinion on
// ---------------------------------------------------------------------------

Deno.test("defer: any tool that is not Bash", async () => {
  for (const tool of ["Write", "Edit", "shell", "mcp__fs__write"]) {
    const res = await runHook(payload(`bash ${SCRIPTS}/validate-assessment`, tool));
    assertEquals(res.stdout, "", `${tool} is not this hook's business`);
  }
});

Deno.test("defer: a malformed or incomplete payload", async () => {
  for (
    const raw of [
      "",
      "not json",
      "{}",
      '{"tool_name":"Bash"}',
      '{"tool_name":"Bash","tool_input":{}}',
      '{"tool_name":"Bash","tool_input":{"command":""}}',
      '{"tool_name":"Bash","tool_input":{"command":["bash"]}}',
      '{"tool_name":"Bash","tool_input":{"command":null}}',
    ]
  ) {
    const res = await runHook(raw);
    assertEquals(res.stdout, "", `should defer on: ${raw}`);
  }
});

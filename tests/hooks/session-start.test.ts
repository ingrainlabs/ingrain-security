/**
 * **Behavioral tests for `hooks/scripts/session-start` — the injected context itself.**
 *
 * Nothing asserted this before. `tests/static/skill.test.ts` greps the script's SOURCE and
 * `tests/parity/scriptInvocations.test.ts` harvests the commands out of it and runs them, so
 * both read the hook without ever measuring what it emits. That gap let the payload grow to
 * 21,994 characters against the hosts' documented 10,000-character `additionalContext` cap,
 * which silently truncated everything past ~10k — including the `<INGRAIN-ASSESSMENT-PATHS>`
 * block at character 19,429, the one part that cannot live in `SKILL.md` because `plugin_root`
 * resolves at runtime. SKILL.md meanwhile promises that block is in context. The promise held
 * in the source and failed in the payload, which is exactly the class of defect a source grep
 * cannot see.
 *
 * So these tests execute the hook and assert on its output.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const HOOKS = `${ROOT}hooks/scripts`;

/**
 * Hosts cap a hook's output strings at 10,000 characters ("Hook output strings, including
 * `additionalContext`, `systemMessage`, and plain stdout, are capped at 10,000 characters").
 * The hook budgets itself to 9,000; the headroom between the two is deliberate.
 */
const HOST_CAP = 10_000;

/** Run the hook hermetically and return the context it injects. */
async function injectedContext(hostArg = "claude"): Promise<string> {
  const out = await new Deno.Command("bash", {
    args: [`${HOOKS}/session-start`, hostArg],
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "" },
    stdout: "piped",
    stderr: "piped",
  }).output();

  assertEquals(out.code, 0, "session-start must exit 0");
  const parsed = JSON.parse(new TextDecoder().decode(out.stdout));
  assertEquals(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  return parsed.hookSpecificOutput.additionalContext;
}

/** The `bash "<abs path>" <host> …` command lines the context carries. */
function injectedCommands(context: string): string[] {
  return context.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("bash "));
}

Deno.test("session-start: emits valid JSON in the SessionStart shape", async () => {
  // injectedContext asserts the envelope; this names it as its own case so a shape break
  // reports as a shape break rather than as whichever content assertion ran first.
  const context = await injectedContext();
  assertEquals(typeof context, "string");
});

Deno.test("session-start: injected context stays under the host cap", async () => {
  // The regression guard for the 21,994-character overflow. Asserted against the HOST's cap,
  // not the hook's own budget: the budget is an implementation choice and may be retuned, while
  // this is the number that actually truncates.
  const context = await injectedContext();
  assertEquals(
    context.length < HOST_CAP,
    true,
    `injected context is ${context.length} chars, at or over the ${HOST_CAP} cap`,
  );
});

Deno.test("session-start: carries the assessment-paths block", async () => {
  // The block that must survive: it holds the only copy of the substituted script commands,
  // and SKILL.md's Phase select tells the orchestrator to expect it here.
  const context = await injectedContext();
  assertStringIncludes(context, "<INGRAIN-ASSESSMENT-PATHS>");
  assertStringIncludes(context, "</INGRAIN-ASSESSMENT-PATHS>");
});

Deno.test("session-start: both runners are substituted to absolute paths", async () => {
  // The whole point of injecting the commands rather than letting SKILL.md state them: a
  // subagent's cwd is the user's project, so a relative `skills/…` path resolves against the
  // wrong root and the read fails outright.
  const commands = injectedCommands(await injectedContext());
  assertEquals(commands.length, 2, `expected mint + branch-delta, got ${commands.length}`);

  for (const command of commands) {
    const path = command.match(/^bash "([^"]+)"/)?.[1];
    assertEquals(typeof path, "string", `no quoted script path in: ${command}`);
    assertEquals(path!.startsWith("/"), true, `not an absolute path: ${path}`);
  }
  assertStringIncludes(commands.join("\n"), "scripts/assessment-mint");
  assertStringIncludes(commands.join("\n"), "scripts/branch-delta");
});

Deno.test("session-start: does not inline SKILL.md", async () => {
  // The fix itself. The Skill tool loads SKILL.md on invoke, so a second copy here bought
  // nothing and cost the paths block its place under the cap. `# Security review loop` is a
  // body heading that appears only in SKILL.md, never in the directive.
  const context = await injectedContext();
  assertEquals(
    context.includes("# Security review loop"),
    false,
    "SKILL.md body is inlined again — this is what overflowed the cap",
  );
  assertEquals(context.includes("<SUBAGENT-STOP>"), false);
});

Deno.test("session-start: the directive names both trigger moments", async () => {
  // Two routes reach code — a finished plan, and an ad-hoc edit with no plan behind it. The
  // ad-hoc one has no PostToolUse backstop on Codex at all, so the directive is where both are
  // stated. Keyed on the skill name plus each moment's distinguishing phrase rather than on
  // whole sentences, so the prose can be reworded without a test edit.
  const context = await injectedContext();
  assertStringIncludes(context, "ingrain-security");
  assertStringIncludes(context, "Skill tool");
  assertStringIncludes(context, "plan is finished");
  assertStringIncludes(context, "about to edit code");
});

Deno.test("session-start: passes the host token through to both runners", async () => {
  // Mirrors how each hook.json invokes it. The token selects project-root resolution, so a
  // dropped one sends Codex down Claude's path.
  for (const host of ["claude", "codex"]) {
    const commands = injectedCommands(await injectedContext(host));
    for (const command of commands) {
      assertStringIncludes(command, `" ${host}`);
    }
  }
});

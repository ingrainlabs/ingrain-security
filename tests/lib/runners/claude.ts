/**
 * The Claude Code backend — the host this tier has driven since Phase 3, unchanged in
 * behaviour. Its output tap is `--output-format stream-json`, parsed into events and
 * normalized into `uses`; its permission story is `--dangerously-skip-permissions`; its
 * credential is the caller's own Claude Code login.
 */

import { AGENT_TIMEOUT_MS, BASH_TOOL_NAMES, commandsFromUses, PLUGIN_DIR } from "./shared.ts";
import type { IRunBackend, RunOptions, RunResult, StreamEvent, TToolUse } from "../types.ts";

/**
 * The tier every live case runs on.
 *
 * Set explicitly because the harness otherwise inherits whatever the invoking CLI defaulted to,
 * so the same suite measured a different model from a laptop than from CI. The moving alias is
 * deliberate: it tracks the current Sonnet rather than needing a bump each release.
 */
export const AGENT_MODEL = "sonnet";

/**
 * Turn caps. These bound a run so a trigger test cannot wander into the whole review cycle;
 * they are not an assertion about how FEW turns the skill should need.
 *
 * `SESSION_MAX_TURNS` was 4, calibrated back when a session hook inlined `SKILL.md` and the
 * agent could route straight from context. Nothing injects context any more — the plugin ships
 * no hooks — so the skill body arrives only when the Skill tool loads it. That is one extra
 * round trip before the run can reach a verdict, and at 4 the minor-plan test ran out of turns
 * mid-tool-call and returned no text at all. The cap absorbs the round trip; the cycle guard
 * still holds well inside ORCHESTRATION_MAX_TURNS.
 *
 * `ORCHESTRATION_MAX_TURNS` was 30, calibrated on runs that never dispatched a worker at all —
 * the subagent gate went unanswered, so the run stopped at the questions and 30 was generous.
 * With the request supplied in the prompt the tier finally reaches the fan-out it exists to
 * check, and a measured run spent its 30 turns still writing the threat list. This is the
 * budget to the gates plus room for the one conditional revision round; a run that needs more
 * than this has a real problem worth failing on.
 */
export const SESSION_MAX_TURNS = 8;
export const ORCHESTRATION_MAX_TURNS = 60;

/**
 * The host's subagent primitive, under every name it has shipped under.
 *
 * **Both, not just the current one.** The name is the host's, not ours, and this detector is
 * what every dispatch assertion in the suite reads — so a rename it does not know about turns
 * each positive assertion red and, far worse, each NEGATIVE one vacuous. That is exactly what
 * happened: the tool became `Agent`, nothing emitted `Task` any more, and `dispatchedWorkers`
 * returned `[]` for every run — so "the review halted before dispatching a worker" passed
 * whether or not it had. The same hazard `lib/workers.ts` documents for the roster, reaching
 * the suite through the host instead.
 */
export const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** Flatten all tool_use content blocks across assistant events. */
const toolUsesFromStream = (events: StreamEvent[]): TToolUse[] => {
  const uses: TToolUse[] = [];
  for (const ev of events) {
    if (ev.type !== "assistant") continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_use") {
        uses.push({ name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      }
    }
  }
  return uses;
};

/** Concatenate assistant text blocks from stream-json events. */
export const streamText = (events: StreamEvent[]): string => {
  const parts: string[] = [];
  for (const ev of events) {
    if (ev.type !== "assistant") continue;
    const content = ev.message?.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
      }
    }
  }
  return parts.join("\n");
};

/**
 * Run `claude -p` with the given prompt and options.
 *
 * The prompt goes in on stdin, not as a trailing positional argument: variadic
 * flags like `--allowed-tools` otherwise swallow it, and the CLI then exits 1
 * with "Input must be provided either through stdin or as a prompt argument".
 */
export const runClaude = async (prompt: string, opts: RunOptions = {}): Promise<RunResult> => {
  const args = ["--print", "--dangerously-skip-permissions"];
  args.push("--plugin-dir", opts.pluginDir ?? PLUGIN_DIR);
  args.push("--model", opts.model ?? AGENT_MODEL);
  if (opts.streamJson) args.push("--output-format", "stream-json", "--verbose");
  if (opts.maxTurns !== undefined) args.push("--max-turns", String(opts.maxTurns));
  if (opts.allowedTools?.length) args.push("--allowed-tools", opts.allowedTools.join(","));

  const signal = AbortSignal.timeout(opts.timeoutMs ?? AGENT_TIMEOUT_MS);
  const cmd = new Deno.Command("claude", {
    args,
    cwd: opts.cwd,
    // Merged over the inherited environment rather than replacing it: the session needs the
    // caller's PATH, HOME and credentials to run at all, and `opts.env` only ever adds the
    // one or two variables a case is about.
    env: opts.env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    signal,
  });

  const out = await (async () => {
    const child = cmd.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(prompt));
    await writer.close();
    return await child.output();
  })().catch((e) => {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(`claude timed out after ${opts.timeoutMs ?? AGENT_TIMEOUT_MS}ms`);
    }
    throw e;
  });

  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  const events = opts.streamJson ? parseStreamJson(stdout) : [];
  const uses = events.length > 0 ? toolUsesFromStream(events) : [];
  const text = opts.streamJson ? streamText(events) : stdout;

  return { code: out.code, stdout, stderr, host: "claude", events, uses, text };
};

/** The Claude Code spelling of the backend contract. */
export const claudeBackend: IRunBackend = {
  host: "claude",
  run: runClaude,
  bashCommands: (uses) => commandsFromUses(uses, BASH_TOOL_NAMES.claude),
};

// ── Stream-shape helpers, Claude-native ─────────────────────────────────────
// StreamEvent shapes and the accessors over them are this host's own; nothing
// shared should grow a dependency on them.

/** Parse newline-delimited JSON, skipping non-JSON lines. */
export const parseStreamJson = (raw: string): StreamEvent[] => {
  const events: StreamEvent[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      // ignore partial/non-JSON lines
    }
  }
  return events;
};

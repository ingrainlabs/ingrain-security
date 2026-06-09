/**
 * Runner for the `claude` CLI in headless (`--print`) mode.
 *
 * Returns structured data and parses `--output-format stream-json` into events
 * so tests can assert on tool calls (skill triggering, subagent dispatch)
 * rather than only on text.
 */

import { fromFileUrl } from "@std/path";
import type { RunOptions, RunResult, StreamEvent } from "./types.ts";

/** Repo root = two levels up from this file (tests/lib/claudeRunner.ts). */
export const PLUGIN_DIR = fromFileUrl(new URL("../..", import.meta.url));

/** Per-call timeouts (ms). */
export const TRIAGE_TIMEOUT_MS = 90_000; // triage — fast
export const AGENT_TIMEOUT_MS = 120_000; // single-agent default
export const SESSION_TIMEOUT_MS = 180_000; // full session (skill + agents)
export const ORCHESTRATION_TIMEOUT_MS = 600_000; // full gated cycle

/** Turn caps. */
export const SESSION_MAX_TURNS = 4;
export const ORCHESTRATION_MAX_TURNS = 30;

/** Flatten all tool_use content blocks across assistant events. */
// deno-lint-ignore no-explicit-any
const toolUses = (events: StreamEvent[]): any[] => {
  // deno-lint-ignore no-explicit-any
  const uses: any[] = [];
  for (const ev of events) {
    if (ev.type !== "assistant") continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_use") uses.push(block);
    }
  }
  return uses;
};

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

/** Subagent types dispatched via the Task tool, in order of appearance. */
export const dispatchedAgents = (events: StreamEvent[]): string[] => {
  const agents: string[] = [];
  for (const block of toolUses(events)) {
    if (block.name === "Task" && typeof block.input?.subagent_type === "string") {
      agents.push(block.input.subagent_type);
    }
  }
  return agents;
};

/** Names of all tools the model invoked, in order. */
export const toolNames = (events: StreamEvent[]): string[] =>
  toolUses(events).map((b) => b.name).filter((n): n is string => typeof n === "string");

/** Run `claude -p` with the given prompt and options. */
export const runClaude = async (prompt: string, opts: RunOptions = {}): Promise<RunResult> => {
  const args = ["--print", "--dangerously-skip-permissions"];
  args.push("--plugin-dir", opts.pluginDir ?? PLUGIN_DIR);
  if (opts.agent) args.push("--agent", opts.agent);
  if (opts.streamJson) args.push("--output-format", "stream-json", "--verbose");
  if (opts.maxTurns !== undefined) args.push("--max-turns", String(opts.maxTurns));
  if (opts.allowedTools?.length) args.push("--allowed-tools", opts.allowedTools.join(","));
  args.push(prompt);

  const signal = AbortSignal.timeout(opts.timeoutMs ?? AGENT_TIMEOUT_MS);
  const cmd = new Deno.Command("claude", {
    args,
    stdout: "piped",
    stderr: "piped",
    signal,
  });

  let out: Deno.CommandOutput;
  try {
    out = await cmd.output();
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(`claude timed out after ${opts.timeoutMs ?? AGENT_TIMEOUT_MS}ms`);
    }
    throw e;
  }

  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  const events = opts.streamJson ? parseStreamJson(stdout) : [];
  const text = opts.streamJson ? streamText(events) : stdout;

  return { code: out.code, stdout, stderr, events, text };
};

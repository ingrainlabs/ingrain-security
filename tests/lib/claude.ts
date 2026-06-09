/**
 * Spawn helper around the `claude` CLI in headless (`--print`) mode.
 *
 * Returns structured data and parses `--output-format stream-json` into events
 * so tests can assert on tool calls (skill triggering, subagent dispatch)
 * rather than only on text.
 */

import { fromFileUrl } from "@std/path";

/** Repo root = two levels up from this file (tests/lib/claude.ts). */
export const PLUGIN_DIR = fromFileUrl(new URL("../..", import.meta.url));

export interface RunOptions {
  /** Run the whole session AS this subagent (`--agent <name>`). */
  agent?: string;
  /** Plugin dir to load (skill + agents + hooks). Defaults to repo root. */
  pluginDir?: string;
  /** Use `--output-format stream-json`; populates `events`. */
  streamJson?: boolean;
  /** Cap agentic turns (`--max-turns`). */
  maxTurns?: number;
  /** Per-call timeout in ms (default 120s). Aborts the subprocess. */
  timeoutMs?: number;
  /** Restrict tools (`--allowed-tools`). */
  allowedTools?: string[];
}

export interface StreamEvent {
  type?: string;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Parsed JSONL events when streamJson was set; else []. */
  events: StreamEvent[];
  /** Assistant text, concatenated. With streamJson, derived from events. */
  text: string;
}

/** Run `claude -p` with the given prompt and options. */
export async function runClaude(prompt: string, opts: RunOptions = {}): Promise<RunResult> {
  const args = ["--print", "--dangerously-skip-permissions"];
  args.push("--plugin-dir", opts.pluginDir ?? PLUGIN_DIR);
  if (opts.agent) args.push("--agent", opts.agent);
  if (opts.streamJson) args.push("--output-format", "stream-json", "--verbose");
  if (opts.maxTurns !== undefined) args.push("--max-turns", String(opts.maxTurns));
  if (opts.allowedTools?.length) args.push("--allowed-tools", opts.allowedTools.join(","));
  args.push(prompt);

  const signal = AbortSignal.timeout(opts.timeoutMs ?? 120_000);
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
      throw new Error(`claude timed out after ${opts.timeoutMs ?? 120_000}ms`);
    }
    throw e;
  }

  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  const events = opts.streamJson ? parseStreamJson(stdout) : [];
  const text = opts.streamJson ? streamText(events) : stdout;

  return { code: out.code, stdout, stderr, events, text };
}

/** Parse newline-delimited JSON, skipping non-JSON lines. */
export function parseStreamJson(raw: string): StreamEvent[] {
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
}

/** Concatenate assistant text blocks from stream-json events. */
export function streamText(events: StreamEvent[]): string {
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
}

/** Subagent types dispatched via the Task tool, in order of appearance. */
export function dispatchedAgents(events: StreamEvent[]): string[] {
  const agents: string[] = [];
  for (const block of toolUses(events)) {
    if (block.name === "Task" && typeof block.input?.subagent_type === "string") {
      agents.push(block.input.subagent_type);
    }
  }
  return agents;
}

/** Names of all tools the model invoked, in order. */
export function toolNames(events: StreamEvent[]): string[] {
  return toolUses(events).map((b) => b.name).filter((n): n is string => typeof n === "string");
}

/** Flatten all tool_use content blocks across assistant events. */
// deno-lint-ignore no-explicit-any
function toolUses(events: StreamEvent[]): any[] {
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
}

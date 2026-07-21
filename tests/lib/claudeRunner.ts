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

/** The seven worker skills the orchestrator dispatches. */
export const WORKERS = [
  "ingrain-relevance-triage",
  "ingrain-threat-generator",
  "ingrain-threat-critic",
  "ingrain-risk-scorer",
  "ingrain-mitigation-generator",
  "ingrain-rule-expander",
  "ingrain-mitigation-critic",
] as const;

/**
 * Workers dispatched by the orchestrator, in order of appearance.
 *
 * Workers are reference files under the single ingrain-security skill now, not
 * platform-native agents, so dispatch no longer shows up as a
 * `Task.subagent_type`. The orchestrator dispatches a generic subagent told to
 * read `references/development/<name>.md`, so we recover the worker from the Task prompt. The
 * sequential in-context fallback reads the same reference via the Skill tool, so
 * we count that too.
 */
export const dispatchedWorkers = (events: StreamEvent[]): string[] => {
  const workers: string[] = [];
  for (const block of toolUses(events)) {
    if (block.name === "Task" && typeof block.input?.prompt === "string") {
      const m = block.input.prompt.match(/references\/development\/([a-z-]+)\.md/);
      if (m && (WORKERS as readonly string[]).includes(m[1])) {
        workers.push(m[1]);
        continue;
      }
    }
    if (block.name === "Skill" && typeof block.input?.skill === "string") {
      const skill = block.input.skill.split(":").pop() ?? "";
      if ((WORKERS as readonly string[]).includes(skill)) workers.push(skill);
    }
  }
  return workers;
};

/**
 * Build the dispatch prompt for a single worker, mirroring what the orchestrator
 * sends: the worker's own reference-file body (frontmatter stripped) as the
 * system prompt, then the INPUT. Lets a live test exercise one worker in
 * isolation without a platform-native agent definition.
 *
 * `assessmentAbs` supplies the per-run write target the orchestrator pastes into
 * every dispatch (SKILL.md § How to dispatch a worker). It is the one thing a worker
 * cannot learn from its own reference file, so without it the worker has nowhere to
 * write and answers inline instead.
 */
export const workerDispatchPrompt = async (
  name: string,
  input: string,
  assessmentAbs?: string,
): Promise<string> => {
  const md = await Deno.readTextFile(
    `${PLUGIN_DIR}/skills/ingrain-security/references/development/${name}.md`,
  );
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const writeTarget = assessmentAbs
    ? [
      "",
      `Your ONE permitted write is your own section of the stored analysis file for`,
      `this run at ${assessmentAbs}, written to the schema in`,
      `references/formatting/assessment-file.md — use exactly its fields and enum values.`,
      `Write to that exact absolute path, character for character as pasted above.`,
    ]
    : [];
  return [
    `You have been dispatched as the \`${name}\` worker of the ingrain-security`,
    `review. Follow the instructions below as your system prompt, act on the`,
    `INPUT, and return only what the Output section specifies.`,
    ...writeTarget,
    "",
    body,
    "",
    "INPUT:",
    input,
  ].join("\n");
};

/** Path to the bundled assessment-path minter, the single source of truth for the file's name. */
const MINT_SCRIPT = `${PLUGIN_DIR}/skills/ingrain-security/scripts/assessment-path`;

/**
 * Mint a real assessment file in a throwaway project dir and return both paths.
 *
 * Drives the bundled minter rather than hand-building a path or a skeleton, so a live
 * worker fills the same seeded structure it would fill in a real run.
 */
export const mintAssessment = async (
  projectDir: string,
  title: string,
): Promise<{ assessmentAbs: string }> => {
  const out = await new Deno.Command("bash", {
    args: [MINT_SCRIPT, "claude", "mint", "--title", title],
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "",
      CLAUDE_PROJECT_DIR: projectDir,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (out.code !== 0) {
    throw new Error(`assessment mint failed: ${new TextDecoder().decode(out.stderr)}`);
  }
  const minted = JSON.parse(new TextDecoder().decode(out.stdout)) as { assessment_abs: string };
  return { assessmentAbs: minted.assessment_abs };
};

/** Names of all tools the model invoked, in order. */
export const toolNames = (events: StreamEvent[]): string[] =>
  toolUses(events).map((b) => b.name).filter((n): n is string => typeof n === "string");

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
  if (opts.streamJson) args.push("--output-format", "stream-json", "--verbose");
  if (opts.maxTurns !== undefined) args.push("--max-turns", String(opts.maxTurns));
  if (opts.allowedTools?.length) args.push("--allowed-tools", opts.allowedTools.join(","));

  const signal = AbortSignal.timeout(opts.timeoutMs ?? AGENT_TIMEOUT_MS);
  const cmd = new Deno.Command("claude", {
    args,
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
  const text = opts.streamJson ? streamText(events) : stdout;

  return { code: out.code, stdout, stderr, events, text };
};

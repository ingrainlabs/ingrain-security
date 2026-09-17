/**
 * Shared types for the test harness — the public contract every live tier runs against.
 *
 * The harness has two backends (Claude Code and OpenCode) behind one registry
 * (`lib/runners/index.ts`). This file is the boundary between them: shared modules import
 * only these shapes, never a backend module.
 */

/** The agent hosts the live tier can drive. */
export type THostBackend = "claude" | "opencode";

/**
 * One tool call, in host-neutral form.
 *
 * Each backend normalizes its own event stream into these (`RunResult.uses`), so the shared
 * matchers (`dispatchedWorkers`, `usesSkill`, `toolNames`) never parse a host's shapes.
 */
export interface TToolUse {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** What each backend requires on the machine it runs on, and where overrides land. */
export interface IRunBackend {
  /** The host this backend drives. */
  readonly host: THostBackend;
  /** Run one headless prompt to completion. */
  run(prompt: string, opts: RunOptions): Promise<RunResult>;
  /** Shell commands the run executed through the host's Bash-equivalent tool. */
  bashCommands(uses: readonly TToolUse[]): string[];
}

export interface RunOptions {
  /**
   * Which backend drives the run. Defaults to `INGRAIN_TESTS_AGENT_HOST`, then `claude` — so
   * every existing call site keeps its host, and the deno.json twins select one per run.
   */
  host?: THostBackend;
  /** Plugin dir to load. **Claude Code only** (`--plugin-dir`). */
  pluginDir?: string;
  /**
   * Model override. Claude Code takes its moving alias (`sonnet`); OpenCode takes
   * `provider/model` **only when given** — by default it runs the machine's configured
   * resolution, exactly as a developer's session does.
   */
  model?: string;
  /** Opt into the host's structured event stream; populates `events` and `uses`. */
  streamJson?: boolean;
  /**
   * Cap agentic turns (`--max-turns`). **Claude Code only** — OpenCode ships no turn flag at
   * 1.18.31, so its runs are bounded by `timeoutMs` alone.
   */
  maxTurns?: number;
  /** Per-call timeout in ms (default 120s). Aborts the subprocess. */
  timeoutMs?: number;
  /** Restrict tools (`--allowed-tools`). **Claude Code only**; OpenCode's grants live in the staged config. */
  allowedTools?: string[];
  /**
   * Working directory for the spawned session. Defaults to the harness's own cwd — this
   * repository — which is the wrong place for any test whose prompt describes work on files:
   * the agent looks for them, does not find them, and stops before editing rather than
   * inventing targets, so the skill's trigger never fires. Point it at a project that actually
   * holds what the prompt names.
   */
  cwd?: string;
  /**
   * Extra environment for the spawned session, merged over the harness's own.
   *
   * The unattended signal reaches the skill through `ingrain assessment mint`, which the session
   * spawns for itself — so it has to be on the session's environment rather than passed as a
   * flag. Set per call rather than with `Deno.env.set`: that mutates the whole test process,
   * and Deno runs test files in parallel, so one unattended case would silently make every
   * other run unattended too.
   */
  env?: Record<string, string>;
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
  /** The backend that produced this result. */
  host: THostBackend;
  /** Parsed events when streamJson was set; else []. Shapes are host-native. */
  events: StreamEvent[];
  /** Tool calls normalized across hosts, in order. Empty whenever events is. */
  uses: TToolUse[];
  /** Assistant text, concatenated. */
  text: string;
}

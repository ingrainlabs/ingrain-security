/**
 * Shared types for the test harness — the public shape of the `claudeRunner`
 * spawn helper (`lib/claudeRunner.ts`), consumed across `matchers.ts`, `reporter.ts`, and the
 * test files. Kept type-only so importers can use `import type`.
 */

export interface RunOptions {
  /** Plugin dir to load (skills + hooks). Defaults to repo root. */
  pluginDir?: string;
  /** Use `--output-format stream-json`; populates `events`. */
  streamJson?: boolean;
  /** Cap agentic turns (`--max-turns`). */
  maxTurns?: number;
  /** Per-call timeout in ms (default 120s). Aborts the subprocess. */
  timeoutMs?: number;
  /** Restrict tools (`--allowed-tools`). */
  allowedTools?: string[];
  /**
   * Working directory for the spawned session. Defaults to the harness's own cwd — this
   * repository — which is the wrong place for any test whose prompt describes work on files:
   * the agent looks for them, does not find them, and stops before editing rather than
   * inventing targets, so the skill's trigger never fires. Point it at a project that actually
   * holds what the prompt names.
   */
  cwd?: string;
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

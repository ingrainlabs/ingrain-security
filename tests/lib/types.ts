/**
 * Shared types for the test harness — the public shape of the `claude` spawn
 * helper (`lib/claude.ts`), consumed across `assert.ts`, `report.ts`, and the
 * test files. Kept type-only so importers can use `import type`.
 */

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

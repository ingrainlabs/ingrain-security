/**
 * Live-test reporter. Wraps a `runClaude` call so every live test prints the
 * exact INPUT (prompt) and OUTPUT (model response) it exercised, letting you
 * validate the model's actual replies by eye alongside the automated verdict.
 *
 * Console-only and always-on. Deno streams each test's console output live (in
 * its own `----- output -----` markers), so these blocks appear as tests run.
 */

import { dispatchedAgents, runClaude } from "./claudeRunner.ts";
import type { RunOptions, RunResult } from "./types.ts";

const indent = (text: string, pad = "    "): string => {
  const body = text.trimEnd();
  if (!body) return `${pad}(empty)`;
  return body.split("\n").map((line) => pad + line).join("\n");
};

/**
 * Run a prompt, print an INPUT/OUTPUT/VERDICT block, then run `check`.
 * The block is printed BEFORE `check` so the response is visible even when an
 * assertion fails; `check` failures are reported and re-thrown so Deno still
 * fails the test.
 */
export const runChecked = async (
  label: string,
  prompt: string,
  opts: RunOptions,
  check: (r: RunResult) => void,
): Promise<RunResult> => {
  const started = performance.now();
  const r = await runClaude(prompt, opts);
  const secs = ((performance.now() - started) / 1000).toFixed(1);

  const lines: string[] = [
    "",
    `===== ${label} =====`,
    "INPUT:",
    indent(prompt),
    "OUTPUT:",
    indent(r.text),
  ];

  const dispatched = dispatchedAgents(r.events);
  if (dispatched.length) lines.push(`DISPATCHED: [${dispatched.join(", ")}]`);

  try {
    check(r);
    lines.push(`VERDICT: ok  (exit ${r.code}, ${secs}s)`);
    console.log(lines.join("\n"));
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lines.push(`VERDICT: FAIL  (exit ${r.code}, ${secs}s) — ${msg}`);
    console.log(lines.join("\n"));
    throw e;
  }
};

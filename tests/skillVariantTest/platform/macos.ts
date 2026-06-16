/**
 * macOS implementation of the terminal-launcher seam.
 *
 * - Session capture uses BSD `script` (`script -q <log> <cmd…>`).
 * - Windows are opened with AppleScript via `osascript`: one `do script` per
 *   variant, each given a custom title.
 *
 * This is the ONLY OS-specific code for the variant runner; a Linux counterpart
 * would be a sibling module implementing the same `ITerminalLauncher`.
 */

import { shQuote } from "../../lib/shell.ts";
import type { ITerminalLauncher, TTerminalJob } from "./types.ts";

export class MacOsTerminalLauncher implements ITerminalLauncher {
  readonly name = "macOS Terminal.app";

  /** BSD arg order: the command and its args follow the log file. */
  captureCommand(inner: string, logPath: string): string {
    return `script -q ${shQuote(logPath)} ${inner}`;
  }

  async openWindows(jobs: TTerminalJob[]): Promise<void> {
    const script = buildAppleScript(jobs);
    const cmd = new Deno.Command("osascript", { args: ["-e", script], stderr: "piped" });
    const out = await cmd.output();
    if (!out.success) {
      const err = new TextDecoder().decode(out.stderr).trim();
      throw new Error(`osascript failed: ${err}`);
    }
  }
}

/** Build the AppleScript that opens one titled Terminal window per launch.sh. */
const buildAppleScript = (jobs: TTerminalJob[]): string => {
  const lines = ['tell application "Terminal"', "  activate"];
  jobs.forEach((job, i) => {
    const cmd = `bash ${shQuote(job.launchPath)}`;
    // e.g. "variant: baseline·plan · SKILL.md" — names both the mode and the skill file under test.
    const title = `variant: ${job.label} · ${job.skillFile}`;
    // JSON.stringify yields a valid AppleScript double-quoted string literal.
    lines.push(`  set t${i} to do script ${JSON.stringify(cmd)}`);
    lines.push(`  set custom title of t${i} to ${JSON.stringify(title)}`);
  });
  lines.push("end tell");
  return lines.join("\n");
};

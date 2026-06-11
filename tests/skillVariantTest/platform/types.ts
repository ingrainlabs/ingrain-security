/**
 * Platform seam for the variant runner.
 *
 * The runner (`tests/skillVariantTest/run.ts`) is platform-neutral; everything that
 * differs between operating systems lives behind `ITerminalLauncher`. Today only
 * macOS is implemented (`./macos.ts`); a Linux launcher would be a second
 * implementation registered in `./index.ts`. This file is the contract both
 * sides agree on.
 */

/** One variant's window: its label and the launch.sh to run in it. */
export interface TTerminalJob {
  /** Variant label, used as the window title (e.g. `baseline`, `SKILL1`). */
  label: string;
  /** Absolute path to the launch.sh that runs this variant's claude session. */
  launchPath: string;
}

/** Per-OS strategy for the two things that differ between platforms. */
export interface ITerminalLauncher {
  /** Human name for messages/summary (e.g. `macOS Terminal.app`). */
  readonly name: string;

  /**
   * Wrap an inner shell command so it runs interactively while capturing the
   * session to `logPath`.
   *
   * `inner` is already a bash command line — any `$(cat …)` / quoting in it is
   * expanded by the shell that runs launch.sh, before the wrapper command sees
   * it. Implementations only prepend their platform's session-capture tool:
   * - macOS (BSD): `script -q <log> <inner>`
   * - Linux (util-linux, future): `script -q -c "<inner>" <log>`
   */
  captureCommand(inner: string, logPath: string): string;

  /** Open one titled terminal window per job, all at once. */
  openWindows(jobs: TTerminalJob[]): Promise<void>;
}

/** Thrown by the launcher factory when no launcher exists for the current OS. */
export class UnsupportedPlatformError extends Error {
  override readonly name = "UnsupportedPlatformError";
}

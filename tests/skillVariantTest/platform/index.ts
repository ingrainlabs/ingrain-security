/**
 * Launcher factory — the single place that knows which `ITerminalLauncher` fits
 * the current OS. Adding a platform means writing its launcher module and adding
 * one `case` here; nothing in `run.ts` changes.
 */

import { type ITerminalLauncher, UnsupportedPlatformError } from "./types.ts";
import { MacOsTerminalLauncher } from "./macos.ts";

export type { ITerminalLauncher, TTerminalJob } from "./types.ts";
export { UnsupportedPlatformError } from "./types.ts";

/**
 * Resolve the terminal launcher for the host OS.
 *
 * @param os defaults to the real host; pass an explicit value to probe the
 *           mapping (e.g. confirm the unsupported-OS error) without a test rig.
 * @throws UnsupportedPlatformError when no launcher exists for `os`.
 */
export const getTerminalLauncher = (
  os: typeof Deno.build.os = Deno.build.os,
): ITerminalLauncher => {
  switch (os) {
    case "darwin":
      return new MacOsTerminalLauncher();
    default:
      throw new UnsupportedPlatformError(
        `The variants harness currently supports macOS only (detected: ${os}). ` +
          `To add support, implement ITerminalLauncher in tests/skillVariantTest/platform/linux.ts ` +
          `and register it in tests/skillVariantTest/platform/index.ts.`,
      );
  }
};

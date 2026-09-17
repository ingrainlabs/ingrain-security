/**
 * The backend registry — the one module allowed to import a host backend.
 *
 * Everything else in the tier reaches the hosts through `runPrompt` / `getRunner` /
 * `resolveHost` from `shared.ts`, so a shared module never grows a dependency on a host's
 * spawn flags, event shapes or staging. The static tier asserts that boundary
 * (`static/harness.test.ts`).
 */

import { claudeBackend } from "./claude.ts";
import { opencodeBackend } from "./opencode.ts";
import { installRegistry } from "./shared.ts";
import type { IRunBackend, THostBackend } from "../types.ts";

const BACKENDS: Record<THostBackend, IRunBackend> = {
  claude: claudeBackend,
  opencode: opencodeBackend,
};

/** @internal — wires the shared core's lazy lookup. */
installRegistry((host) => BACKENDS[host]);

export const getRunner = (host: THostBackend): IRunBackend => BACKENDS[host];

// The tier's single import surface.
export * from "./shared.ts";

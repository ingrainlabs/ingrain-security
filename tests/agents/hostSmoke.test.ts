/**
 * The host-answering smoke — the case that fails fast, with the remedy, when the selected
 * backend has no working credential or configuration, instead of letting the first scenario
 * case spend its budget on a run that dies late.
 *
 * **Completion is the signal, never content.** On OpenCode this rides the machine's own
 * provider configuration (see `lib/runners/opencode.ts`): a logged-in provider must resolve a
 * default model and return text, under the real spawn shape — the harness's `OPENCODE_CONFIG`
 * contribution included, because OpenCode hard-fails on invalid config at startup. On Claude
 * Code the caller's login is the credential. Either host that cannot complete one bare run is
 * a runbook problem, not a review problem.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { getRunner, resolveHost } from "../lib/runners/index.ts";

const HOST = resolveHost();

Deno.test(`host smoke [${HOST}]`, async () => {
  const r = await getRunner(HOST).run("Reply with the word PONG and nothing else.", {
    // Intentionally minimal: no project work, no stream opt-in. The subject is the host
    // answering at all, under the same spawn shape every scenario case uses.
    timeoutMs: 180_000,
  });
  assertEquals(r.code, 0, `the ${HOST} run exited non-zero — stderr:\n${r.stderr.slice(0, 400)}`);
  assertStringIncludes(r.text, "PONG");
});

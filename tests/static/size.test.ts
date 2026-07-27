/**
 * Advisory token-budget check on the skill's markdown. No model calls, no auth,
 * no network — pure file reads.
 *
 * The prompt files are the product, and every token in them is paid on load, so a
 * file that grows past the budget costs latency and context on every run. This
 * warns when one does; it never fails. A hard cap would turn an honest,
 * well-argued addition into a red PR, and the right response to going over is a
 * judgement call about what to cut — not an automatic block.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILLS_DIR = `${ROOT}skills`;

/** Rough estimate, deliberately not a real tokenizer — 4 characters ≈ 1 token. */
const CHARS_PER_TOKEN = 4;

/** Per-file soft ceiling, in estimated tokens. Over it earns a warning, nothing more. */
const TOKEN_BUDGET = 7500;

const estimateTokens = (text: string): number => Math.round(text.length / CHARS_PER_TOKEN);

Deno.test("skill markdown: warn when a file exceeds the token budget", async () => {
  let checked = 0;

  for await (const entry of walk(SKILLS_DIR, { exts: [".md"] })) {
    checked++;
    const tokens = estimateTokens(await Deno.readTextFile(entry.path));
    if (tokens <= TOKEN_BUDGET) continue;
    console.warn(
      `warning: ${relative(ROOT, entry.path)} is ~${tokens} tokens (budget ${TOKEN_BUDGET})`,
    );
  }

  // The only assertion: a walk that silently finds nothing would make the check useless.
  assertEquals(checked > 0, true, `no markdown found under ${SKILLS_DIR}`);
});

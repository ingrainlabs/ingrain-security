/**
 * **The skill's prose is its behaviour, so its style is a contract too.**
 *
 * Every reference file here is read by a model as a system prompt. A sentence that spends its
 * words on emphasis rather than fact costs context in every run and gives the reader nothing
 * to act on — and the constructions below spread by copying: "missing a governing rule is the
 * costly failure" reached four files, "the delta is your entry point, not your boundary" four,
 * "a brewed command drifts" three. Each copy then has to be maintained.
 *
 * **What is banned is decoration, never a fact.** Each entry below has no legitimate use in
 * instructional prose — a cleft that emphasises rather than states, an intensifier on an
 * already-true claim, or a metaphor standing in for the thing it describes. Where a sentence
 * carries a REASON a worker needs, the reason stays and the flourish goes; nothing here asks
 * for a fact to be deleted.
 *
 * **Deliberately not banned: `exactly`.** It is decorative in "exactly the case a security
 * owner needs to see" and load-bearing in "carry each surviving threat's `T<nn>` with it,
 * exactly as the snapshot has it". A pattern that cannot tell those apart would flag correct
 * instructions, which is how a scan earns being switched off.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";

const SKILL_ROOT = fromFileUrl(new URL("../../skills/ingrain-security/", import.meta.url));

/** Each entry: the construction, and the plain form that replaces it. */
const BANNED: ReadonlyArray<{ pattern: RegExp; instead: string }> = [
  {
    pattern: /is what (?:makes|keeps|lets|holds|stops|drives|grounds|restores|opens|turns|buys)\b/i,
    instead: 'state the fact directly — "X keeps Y", not "X is what keeps Y"',
  },
  {
    pattern: /\b(?:precisely the|emphatically|in as many words)\b/i,
    instead: "drop the intensifier; the claim is either true or it is not",
  },
  {
    pattern: /\bvessel\b/i,
    instead: 'say "implementation guidance", the thing itself',
  },
  {
    pattern: /\bpaperwork\b/i,
    instead: "say what it is — the guidance, or the plan's description",
  },
  {
    pattern: /cast(?:s|ing)? a wide net|the costly failure/i,
    instead: 'say "retrieve broadly" and state the consequence of missing a rule',
  },
  {
    pattern: /holds the pen/i,
    instead: "say who writes the section",
  },
  {
    pattern: /\bbrewed\b|\bslog\b|drown(?:s|ing)? the user/i,
    instead: "describe the behaviour rather than reaching for an image",
  },
  {
    pattern: /leaf of a fan-out/i,
    instead: 'say "one of N dispatched in parallel"',
  },
  {
    pattern: /the (?:whole|entirety) of what/i,
    instead: 'say "all" or name the bound',
  },
  {
    pattern: /pays for it|is a courtesy|the price of|worth a wave/i,
    instead: "state the cost as a fact, not as a transaction",
  },
  {
    pattern: /\bsilently\b|\bquietly\b/i,
    instead: 'say what happens instead — "with no error", "and nothing reports it"',
  },
];

const walkMarkdown = async function* (dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* walkMarkdown(path);
    else if (entry.isFile && entry.name.endsWith(".md")) yield path;
  }
};

Deno.test("skill prose states facts rather than dressing them", async () => {
  const offenders: string[] = [];
  let scanned = 0;

  for await (const path of walkMarkdown(SKILL_ROOT)) {
    scanned++;
    const lines = (await Deno.readTextFile(path)).split("\n");
    lines.forEach((line, index) => {
      for (const { pattern, instead } of BANNED) {
        const hit = line.match(pattern);
        if (hit === null) continue;
        offenders.push(
          `${relative(SKILL_ROOT, path)}:${index + 1}  "${hit[0]}"  → ${instead}`,
        );
      }
    });
  }

  if (scanned === 0 || BANNED.length === 0) {
    throw new Error(
      `Scanned ${scanned} markdown files against ${BANNED.length} patterns under ` +
        `${SKILL_ROOT}. "Nothing to check" reads identically to "no violations".`,
    );
  }

  assertEquals(
    offenders,
    [],
    `Prose in this skill is read as a system prompt, so decoration costs context in every ` +
      `run without telling the reader anything. Keep the fact, drop the flourish:\n  ` +
      offenders.join("\n  "),
  );
});

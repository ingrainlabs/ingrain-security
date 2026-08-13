/**
 * **Every path a dispatched subagent is told to read must be absolute.**
 *
 * A worker subagent's cwd is the USER'S project; the reference files live in the plugin.
 * So `Read references/development/<name>.md` resolves to `<project>/references/…`, which
 * does not exist — and since the host's Read tool requires an absolute path, that is the
 * worker's first action and it fails outright. Every Development worker and both Testing
 * verifiers were dispatched that way.
 *
 * The fix is the one the same template already applies to the write target: paste the
 * absolute path in, from the mint JSON. `plugin_root` is what the write target's
 * `assessment_abs` is for reads.
 *
 * **Why a scan and not a literal assertion.** The defect did not stay put. It was filed
 * against six sites, and the rule verifier added in Phase 7 was written by copying an
 * existing dispatch — so it arrived carrying the same relative path, months after the
 * finding. A scan covers the site that has not been written yet.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";

const SKILL_ROOT = fromFileUrl(new URL("../../skills/ingrain-security/", import.meta.url));

/** The absolute form every dispatch must use. */
const ABSOLUTE_LEAD = "<plugin_root>/skills/ingrain-security/references/";

/**
 * **Scope: the FIRST read handed to a subagent, and nothing else.**
 *
 * A relative path "resolves against the file it was reading" (`SKILL.md`, Pitfalls). So a
 * worker that has already opened its reference file BY ABSOLUTE PATH resolves relative
 * siblings from inside it, and the orchestrator — which is reading `SKILL.md` out of the
 * plugin — resolves them too. Only the opening read of a dispatch prompt has nothing to
 * resolve against. Scanning wider than that flags correct prose in `SKILL.md` and in the
 * worker references, which is how a scan earns being switched off.
 *
 * A fenced block containing "as your system prompt" IS a dispatch prompt, by construction:
 * that phrase is what makes the subagent adopt the role, so it appears in every dispatch
 * and nowhere else.
 */
const DISPATCH_MARKER = "as your system prompt";

Deno.test("no dispatch tells a subagent to read a relative references/ path", async () => {
  const offenders: string[] = [];
  let scanned = 0;
  let dispatchBlocks = 0;

  const walkMarkdown = async function* (dir: string): AsyncGenerator<string> {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) yield* walkMarkdown(path);
      else if (entry.isFile && entry.name.endsWith(".md")) yield path;
    }
  };

  /** Fenced blocks, as line arrays. */
  const fencedBlocks = (source: string): string[][] => {
    const blocks: string[][] = [];
    let current: string[] | undefined;
    for (const line of source.split("\n")) {
      if (line.trimStart().startsWith("```")) {
        if (current) {
          blocks.push(current);
          current = undefined;
        } else current = [];
        continue;
      }
      current?.push(line);
    }
    return blocks;
  };

  for await (const path of walkMarkdown(SKILL_ROOT)) {
    scanned++;
    const source = await Deno.readTextFile(path);
    for (const block of fencedBlocks(source)) {
      const body = block.join("\n");
      if (!body.includes(DISPATCH_MARKER)) continue;
      dispatchBlocks++;
      // The absolute form contains `references/` too, so clear it before looking.
      if (!body.replaceAll(ABSOLUTE_LEAD, "").includes("references/")) continue;
      for (const line of block) {
        if (line.replaceAll(ABSOLUTE_LEAD, "").includes("references/")) {
          offenders.push(`${relative(SKILL_ROOT, path)}: ${line.trim()}`);
        }
      }
    }
  }

  if (scanned === 0 || dispatchBlocks === 0) {
    throw new Error(
      `Scanned ${scanned} markdown files and found ${dispatchBlocks} dispatch blocks under ` +
        `${SKILL_ROOT}. "Nothing to check" reads identically to "no violations" — fix the ` +
        `path or the "${DISPATCH_MARKER}" marker before trusting a green run.`,
    );
  }

  assertEquals(
    offenders,
    [],
    `A dispatched subagent has read nothing yet, so it resolves this against the USER'S ` +
      `project rather than the plugin and the read fails on its first action. Write ` +
      `"${ABSOLUTE_LEAD}…" and paste plugin_root in from the mint JSON, exactly as the ` +
      `write target already pastes assessment_abs:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("the prose describing a dispatch names the absolute reference path too", async () => {
  // `dispatch.md` tells the orchestrator what to put IN the dispatch, so its copy of the
  // path is the one a host-specific adaptation gets read off. It is prose, not a fence, so
  // the scan above cannot see it — asserted as the literal it is.
  const md = await Deno.readTextFile(join(SKILL_ROOT, "references/lib/dispatch.md"));
  const bare = md.split("\n").filter((line) =>
    line.replaceAll(ABSOLUTE_LEAD, "").includes("references/development/<name>.md")
  );
  assertEquals(
    bare,
    [],
    `dispatch.md hands the subagent a relative worker-reference path:\n  ${bare.join("\n  ")}`,
  );
});

Deno.test("the mint carries the plugin_root a dispatch needs to build that path", async () => {
  // The scan above is satisfiable by prose alone. This is the other half: the value the
  // prose tells the orchestrator to paste has to actually arrive in the JSON it keeps.
  // The JSON is emitted by the SCRIPT, which is where the composition lives — the lib holds
  // only pure helpers now.
  const mint = await Deno.readTextFile(join(SKILL_ROOT, "scripts/assessment-mint"));
  const skill = await Deno.readTextFile(join(SKILL_ROOT, "SKILL.md"));

  assertEquals(mint.includes('"plugin_root":"%s"'), true, "assessment-mint emits no plugin_root");
  assertEquals(
    skill.includes("`plugin_root`"),
    true,
    "SKILL.md's kept-values list does not name plugin_root, so nothing tells the " +
      "orchestrator to hold it for the whole run",
  );
});

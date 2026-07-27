/**
 * Static lint of the 6 worker reference files. No model calls, no auth, no
 * network — pure file reads.
 *
 * Workers are reference files under the single ingrain-security skill now
 * (skills/ingrain-security/references/development/<name>.md), so the read-only guarantee is
 * advisory prose in the ROLE header rather than a platform-enforced `tools:`
 * frontmatter list. These checks guard that advisory contract: every worker
 * still declares itself read-only on the codebase (Read/Grep/Glob, no code
 * edits) with its sole write being its own section of the stored assessment
 * file, carries a recommended model, and an anti-trigger description so it isn't
 * fired directly outside the orchestrator.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parseFrontmatter } from "../lib/matchers.ts";

const REFERENCES_DIR = fromFileUrl(
  new URL("../../skills/ingrain-security/references/development/", import.meta.url),
);

const WORKERS = [
  "ingrain-relevance-triage",
  "ingrain-threat-generator",
  "ingrain-threat-critic",
  "ingrain-risk-scorer",
  "ingrain-mitigation-generator",
  "ingrain-mitigation-critic",
] as const;

const splitFrontmatter = (md: string): string => md.replace(/^---\n[\s\S]*?\n---\n/, "");

/**
 * Strip blockquote markers and collapse every run of whitespace to one space, so a ROLE
 * phrase can be asserted as the reader sees it. The ROLE header is a wrapped markdown
 * blockquote, so its sentences routinely straddle a line break (`Make no\n>   edits`) —
 * matching the raw text would tie these assertions to the current line wrapping and fail
 * the moment a paragraph is reflowed.
 */
const flattenProse = (md: string): string => md.replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ");

/** The ROLE phrasing every worker shares. */
const STANDARD_ROLE = {
  writeTarget: "path your dispatch specifies",
};

for (const name of WORKERS) {
  Deno.test(`worker ${name}: frontmatter and advisory write-target ROLE`, async (t) => {
    const md = await Deno.readTextFile(`${REFERENCES_DIR}${name}.md`);
    const fm = parseFrontmatter(md);
    const body = splitFrontmatter(md);
    const prose = flattenProse(body);

    await t.step("name matches reference file", () => {
      assertEquals(fm.name, name);
    });

    await t.step("description is non-empty and anti-trigger", () => {
      assertExists(fm.description);
      const description = String(fm.description);
      assertEquals(description.trim().length > 0, true);
      // Must steer the model away from invoking the worker directly, by naming the
      // orchestrator dispatch as the one way in.
      assertStringIncludes(description, "INTERNAL");
      assertStringIncludes(description.toLowerCase(), "reachable solely through a dispatch");
    });

    await t.step("ROLE header declares codebase read-only with the allowed tools", () => {
      assertStringIncludes(body.toLowerCase(), "read-only");
      assertStringIncludes(body, "Read, Grep, and Glob");
      assertStringIncludes(body.toLowerCase(), "make no code edits");
      // The sole permitted write is the worker's own section of the stored analysis
      // file, located by the path the dispatch specifies (per-run, not a fixed literal).
      assertStringIncludes(body, "stored analysis file");
      assertStringIncludes(body, "path your dispatch specifies");
    });

    // The rule-expander is the one worker with a read-only CLI exception: it runs
    // `ingrain context security_rules` for the second retrieval pass, but still edits
    // nothing. Guard that the exception is documented in its ROLE header.
    if (name === "ingrain-mitigation-generator") {
      await t.step("mitigation-generator documents the read-only ingrain CLI exception", () => {
        assertStringIncludes(body, "ingrain context security_rules");
        assertStringIncludes(body.toLowerCase(), "exception");
      });
    }

    await t.step("ROLE header carries a recommended model", () => {
      assertStringIncludes(prose, "Recommended model:");
    });

    await t.step("ROLE header places the worker inside a pipeline the orchestrator drives", () => {
      // The worker does its one job and returns; everything else — the review loop and
      // every other dispatch — belongs to the orchestrator. Saying so here is what stops
      // a worker from running the orchestration itself.
      assertStringIncludes(prose, "orchestrator dispatched you to do one job");
      assertStringIncludes(
        prose,
        "the orchestrator drives the review loop and dispatches every other worker",
      );
    });
  });
}

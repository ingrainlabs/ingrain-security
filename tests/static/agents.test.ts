/**
 * Static lint of the 7 worker reference files. No model calls, no auth, no
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
 *
 * The rule-expander is the one worker granted a read-only `ingrain` CLI lookup —
 * the second retrieval pass, keyed on the proposed mitigations — and its ROLE is
 * worded for that exception. Its phrasing is pinned in ROLE_OVERRIDES rather than
 * by loosening the shared assertion, so the strict clause stays mandatory for
 * every other worker, the mitigation-generator now included.
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
  "ingrain-rule-expander",
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

/** The ROLE phrasing every worker shares, unless it appears in ROLE_OVERRIDES. */
const STANDARD_ROLE = {
  noEdits: "make no code edits",
  writeTarget: "path your dispatch specifies",
};

/**
 * The rule-expander may run a read-only `ingrain` CLI lookup, so its ROLE is
 * worded for that exception: the no-edits clause is broader (no edits at all, not just
 * code) and it names the dispatch path differently. Note "make no code edits" does not
 * contain "make no edits" as a substring, so the standard workers keep the strictly
 * stronger assertion — this override is not a back door for them.
 */
const ROLE_OVERRIDES: Record<string, typeof STANDARD_ROLE> = {
  "ingrain-rule-expander": {
    noEdits: "make no edits",
    writeTarget: "path per your dispatch",
  },
};

for (const name of WORKERS) {
  Deno.test(`worker ${name}: frontmatter and advisory read-only ROLE`, async (t) => {
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
      // Must steer the model away from invoking the worker directly.
      assertStringIncludes(description, "INTERNAL");
      assertStringIncludes(description.toLowerCase(), "do not invoke directly");
    });

    await t.step("ROLE header declares codebase read-only with the allowed tools", () => {
      const role = ROLE_OVERRIDES[name] ?? STANDARD_ROLE;
      assertStringIncludes(prose.toLowerCase(), "read-only");
      assertStringIncludes(prose, "Read, Grep, and Glob");
      assertStringIncludes(prose.toLowerCase(), role.noEdits);
      // The sole permitted write is the worker's own section of the stored analysis
      // file, located by the path the dispatch specifies (per-run, not a fixed literal).
      assertStringIncludes(prose, "stored analysis file");
      assertStringIncludes(prose, role.writeTarget);
    });

    // The rule-expander is the one worker with a read-only CLI exception: it runs
    // `ingrain context security_rules` for the second retrieval pass, but still edits
    // nothing. Guard that the exception is documented in its ROLE header.
    if (name === "ingrain-rule-expander") {
      await t.step("rule-expander documents the read-only ingrain CLI exception", () => {
        assertStringIncludes(prose, "ingrain context security_rules");
        assertStringIncludes(prose.toLowerCase(), "exception");
      });
    }

    await t.step("ROLE header carries a recommended model", () => {
      assertStringIncludes(prose, "Recommended model:");
    });

    await t.step("ROLE header tells the worker not to run the orchestration", () => {
      assertStringIncludes(prose, "do not run the orchestration");
    });
  });
}

/**
 * Static lint of the 7 worker reference files. No model calls, no auth, no
 * network — pure file reads.
 *
 * Workers are reference files under the single ingrain-security skill now
 * (skills/ingrain-security/references/development/<name>.md), so a worker's write
 * target is advisory prose in the ROLE header rather than a platform-enforced
 * `tools:` frontmatter list. These checks guard that advisory contract: every
 * worker still names its sole write target — its own section of the stored
 * analysis file — carries a recommended model, and has an anti-trigger description
 * so it isn't fired directly outside the orchestrator.
 *
 * Workers DO write (the assessment file is their hand-off medium), so the ROLE
 * header must not call itself read-only: a "read-only … whole toolset" clause next
 * to a write contract is the exact contradiction that stalled workers mid-dispatch.
 * The inverse assertion below is what keeps it from creeping back.
 *
 * The rule-expander is the one worker granted an `ingrain` CLI lookup — the second
 * retrieval pass, keyed on the proposed mitigations — and its ROLE is worded for
 * that exception. Its write-target phrasing is pinned in ROLE_OVERRIDES.
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
  writeTarget: "path your dispatch specifies",
};

/** The rule-expander writes the rules sidecar instead, and names the dispatch path differently. */
const ROLE_OVERRIDES: Record<string, typeof STANDARD_ROLE> = {
  "ingrain-rule-expander": {
    writeTarget: "path per your dispatch",
  },
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

    await t.step("ROLE header names the worker's write target", () => {
      const role = ROLE_OVERRIDES[name] ?? STANDARD_ROLE;
      // The sole permitted write is the worker's own section of the stored analysis
      // file, located by the path the dispatch specifies (per-run, not a fixed literal).
      assertStringIncludes(prose, "stored analysis file");
      assertStringIncludes(prose, role.writeTarget);
    });

    await t.step("ROLE header does not call the worker read-only", () => {
      // Workers write their section of the assessment file. A read-only clause here
      // contradicts the hand-off contract two bullets down and stalls the dispatch.
      assertEquals(
        prose.toLowerCase().includes("read-only"),
        false,
        "ROLE header must not reintroduce a read-only restriction — workers write the assessment file",
      );
    });

    // The rule-expander is the one worker with a CLI exception: it runs
    // `ingrain context security_rules` for the second retrieval pass. Guard that the
    // exception is documented in its ROLE header.
    if (name === "ingrain-rule-expander") {
      await t.step("rule-expander documents the ingrain CLI exception", () => {
        assertStringIncludes(prose, "ingrain context security_rules");
        assertStringIncludes(prose.toLowerCase(), "exception");
      });
    }

    await t.step("ROLE header carries a recommended model", () => {
      assertStringIncludes(prose, "Recommended model:");
    });

    await t.step("ROLE header places the worker inside a pipeline the orchestrator drives", () => {
      assertStringIncludes(prose, "you run one step of a larger pipeline");
    });
  });
}

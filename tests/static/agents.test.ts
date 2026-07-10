/**
 * Static lint of the 6 worker reference files. No model calls, no auth, no
 * network — pure file reads.
 *
 * Workers are reference files under the single ingrain-security skill now
 * (skills/ingrain-security/references/<name>.md), so the read-only guarantee is
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
  new URL("../../skills/ingrain-security/references/", import.meta.url),
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

for (const name of WORKERS) {
  Deno.test(`worker ${name}: frontmatter and advisory read-only ROLE`, async (t) => {
    const md = await Deno.readTextFile(`${REFERENCES_DIR}${name}.md`);
    const fm = parseFrontmatter(md);
    const body = splitFrontmatter(md);

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
      assertStringIncludes(body.toLowerCase(), "read-only");
      assertStringIncludes(body, "Read, Grep, and Glob");
      assertStringIncludes(body.toLowerCase(), "make no code edits");
      // The sole permitted write is the worker's own section of the stored analysis
      // file, located by the path the dispatch specifies (per-run, not a fixed literal).
      assertStringIncludes(body, "stored analysis file");
      assertStringIncludes(body, "path your dispatch specifies");
    });

    // The mitigation-generator is the one worker with a read-only CLI exception:
    // it runs `ingrain context security_rules` to fetch org rules, but still edits
    // nothing. Guard that the exception is documented in its ROLE header.
    if (name === "ingrain-mitigation-generator") {
      await t.step("mitigation-generator documents the read-only ingrain CLI exception", () => {
        assertStringIncludes(body, "ingrain context security_rules");
        assertStringIncludes(body.toLowerCase(), "exception");
      });
    }

    await t.step("ROLE header carries a recommended model", () => {
      assertStringIncludes(body, "Recommended model:");
    });

    await t.step("ROLE header tells the worker not to run the orchestration", () => {
      assertStringIncludes(body, "do not run the orchestration");
    });
  });
}

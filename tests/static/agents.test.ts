/**
 * Static lint of the 6 worker skills. No model calls, no auth, no network — pure
 * file reads.
 *
 * Workers are flat skills now (skills/<name>/SKILL.md), so the read-only
 * guarantee is advisory prose in the ROLE header rather than a platform-enforced
 * `tools:` frontmatter list. These checks guard that advisory contract: every
 * worker still declares itself read-only (Read/Grep/Glob, no edits), carries a
 * recommended model, and an anti-trigger description so it isn't fired directly
 * outside the orchestrator.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parseFrontmatter } from "../lib/matchers.ts";

const SKILLS_DIR = fromFileUrl(new URL("../../skills/", import.meta.url));

const WORKERS = [
  "relevance-triage",
  "threat-generator",
  "threat-critic",
  "risk-scorer",
  "mitigation-generator",
  "mitigation-critic",
] as const;

const splitFrontmatter = (md: string): string => md.replace(/^---\n[\s\S]*?\n---\n/, "");

for (const name of WORKERS) {
  Deno.test(`worker skill ${name}: frontmatter and advisory read-only ROLE`, async (t) => {
    const md = await Deno.readTextFile(`${SKILLS_DIR}${name}/SKILL.md`);
    const fm = parseFrontmatter(md);
    const body = splitFrontmatter(md);

    await t.step("name matches directory", () => {
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

    await t.step("ROLE header declares read-only with the allowed tools", () => {
      assertStringIncludes(body.toLowerCase(), "read-only");
      assertStringIncludes(body, "Read, Grep, and Glob");
      assertStringIncludes(body.toLowerCase(), "make no edits");
    });

    await t.step("ROLE header carries a recommended model", () => {
      assertStringIncludes(body, "Recommended model:");
    });

    await t.step("ROLE header tells the worker not to run the orchestration", () => {
      assertStringIncludes(body, "do not run the orchestration");
    });
  });
}

/**
 * Static lint of the 6 subagent definitions. No model calls, no auth, no
 * network — pure file reads. Catches frontmatter drift and (critically) any
 * agent that gains write access, which would break the "read-only review"
 * invariant the skill promises.
 */

import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parseFrontmatter } from "../lib/matchers.ts";

const AGENTS_DIR = fromFileUrl(new URL("../../agents/", import.meta.url));

const EXPECTED = {
  "relevance-triage": "haiku",
  "threat-generator": "haiku",
  "threat-critic": "haiku",
  "risk-scorer": "haiku",
  "mitigation-generator": "haiku",
  "mitigation-critic": "haiku",
} as const;

const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob"]);

for (const [name, model] of Object.entries(EXPECTED)) {
  Deno.test(`agent ${name}: frontmatter is well-formed and read-only`, async (t) => {
    const md = await Deno.readTextFile(`${AGENTS_DIR}${name}.md`);
    const fm = parseFrontmatter(md);

    await t.step("name matches filename", () => {
      assertEquals(fm.name, name);
    });

    await t.step("description is non-empty", () => {
      assertExists(fm.description);
      assertEquals(typeof fm.description, "string");
      assertEquals((fm.description as string).trim().length > 0, true);
    });

    await t.step("model is the expected tier", () => {
      assertEquals(fm.model, model);
    });

    await t.step("tools are read-only (Read/Grep/Glob only)", () => {
      const tools = String(fm.tools)
        .split(",")
        .map((tool) => tool.trim())
        .filter(Boolean);
      assertEquals(tools.length > 0, true, "tools must be declared");
      for (const tool of tools) {
        assertEquals(
          READ_ONLY_TOOLS.has(tool),
          true,
          `agent ${name} declares non-read-only tool '${tool}'`,
        );
      }
    });
  });
}

/**
 * Static lint of the worker reference files. No model calls, no auth, no
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
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parseFrontmatter } from "../lib/matchers.ts";
import { VERIFIERS, WORKERS } from "../lib/workers.ts";

const REFERENCES_DIR = fromFileUrl(
  new URL("../../skills/ingrain-security/references/development/", import.meta.url),
);

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

    await t.step("ROLE header names the worker's write target", () => {
      // The sole permitted write is the worker's own section of the stored analysis
      // file, located by the path the dispatch specifies (per-run, not a fixed literal).
      assertStringIncludes(prose, "stored analysis file");
      assertStringIncludes(prose, STANDARD_ROLE.writeTarget);
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

// ---------------------------------------------------------------------------
// The Testing verifiers — dispatched exactly as the seven above are, and until
// 2026-08-10 linted by nothing at all. `WORKERS` carries only the Development
// flow order and `REFERENCES_DIR` only `references/development/`, so both files
// fell outside the loop while this suite read as though it covered every worker.
// That blind spot is how the relative-reference-path defect (audit B1) was copied
// into `ingrain-rule-verifier`'s dispatch months after being filed.
//
// They are the inverse worker: read-only, writing nothing, returning a verdict the
// orchestrator records. So the assertions that make sense for them are the
// mirror image of the ones above — a write target would be the defect here.
// ---------------------------------------------------------------------------

const TESTING_DIR = fromFileUrl(
  new URL("../../skills/ingrain-security/references/testing/", import.meta.url),
);

for (const name of VERIFIERS) {
  Deno.test(`verifier ${name}: frontmatter and read-only ROLE`, async (t) => {
    const md = await Deno.readTextFile(`${TESTING_DIR}${name}.md`);
    const fm = parseFrontmatter(md);
    const prose = flattenProse(splitFrontmatter(md));

    await t.step("name matches reference file", () => {
      assertEquals(fm.name, name);
    });

    await t.step("description is non-empty and anti-trigger", () => {
      assertExists(fm.description);
      const description = String(fm.description);
      assertEquals(description.trim().length > 0, true);
      assertStringIncludes(description, "INTERNAL");
      assertStringIncludes(description.toLowerCase(), "reachable solely through a dispatch");
    });

    await t.step("ROLE header states the read-only toolset", () => {
      // The exact inverse of the Development assertion. A verifier that grew a write
      // target could edit the assessment mid-verification — the orchestrator concludes
      // both dimensions and owns every write to the file.
      assertStringIncludes(prose, "Read-only on the codebase");
      // Every git command the review runs comes from the bundled script, so a verifier
      // brewing its own is the drift this prohibition exists to stop: the orchestrator and
      // each verifier would read different changes while the run reports one.
      assertStringIncludes(prose, "never write a git command of your own");
    });

    await t.step("ROLE header claims no write target", () => {
      assertEquals(
        prose.includes("stored analysis file"),
        false,
        "a verifier returns its verdict; the orchestrator records it. A write target here " +
          "would let a verifier edit the file the orchestrator is concluding into.",
      );
      assertStringIncludes(prose, "Your entire output is the verdict you return");
    });

    await t.step("ROLE header carries a recommended model", () => {
      assertStringIncludes(prose, "Recommended model:");
    });

    await t.step("ROLE header places the verifier inside a pipeline", () => {
      assertStringIncludes(prose, "orchestrator dispatched you to");
      assertStringIncludes(prose, "dispatches every other worker");
    });
  });
}

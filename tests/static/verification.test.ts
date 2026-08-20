/**
 * Static checks on the ingrain-security Testing (verification) pass and its hook wiring.
 * No model calls. Guards the verification contract: Testing lives in a reference the
 * slim SKILL.md points at, reads the same per-task assessment file (by ABSOLUTE
 * assessment_abs), dispatches a read-only verifier per SELECTED threat and per SELECTED
 * org rule, concludes each verdict itself by weighing that verifier's justification on its
 * evidence, and records robustness on the threat and adherence on the rule. Testing has no
 * Stop-hook reminder: it runs on the skill's description or an explicit request, and the
 * tail of this file guards that the hook stays removed.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  assertChecklistTracksFlow,
  assertOrder,
  parseFrontmatter,
  section,
} from "../lib/matchers.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL = `${ROOT}skills/ingrain-security/SKILL.md`;
const DEV_FLOW = `${ROOT}skills/ingrain-security/references/development/flow.md`;
const VERIFY = `${ROOT}skills/ingrain-security/references/testing/verification-pass.md`;
const VERIFIER_REF = `${ROOT}skills/ingrain-security/references/testing/ingrain-threat-verifier.md`;
const RULE_VERIFIER_REF =
  `${ROOT}skills/ingrain-security/references/testing/ingrain-rule-verifier.md`;

/**
 * The contents of every fenced code block in `md`, joined. In a dispatch section that is the
 * prompt text the orchestrator pastes to the subagent — as opposed to the prose around it,
 * which addresses the orchestrator instead and may legitimately name what NOT to hand over.
 */
const fencedBlock = (md: string): string =>
  [...md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
const ASSESSMENT_REF = `${ROOT}skills/ingrain-security/references/lib/assessment-file.md`;
const RULES_REF = `${ROOT}skills/ingrain-security/references/lib/rules-file.md`;
const HOOK_JSON = `${ROOT}hooks/claude/hook.json`;
const CODEX_HOOK_JSON = `${ROOT}hooks/codex/hook.json`;

/** Testing carries the same flow/checklist split as Development — see skill.test.ts. */
Deno.test("verification-pass.md: the Testing checklist tracks every step in the flow", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertChecklistTracksFlow(md, "## Testing — the flow", "## Testing — checklist");
});

Deno.test("verification-pass.md: the flow holds no checkboxes", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertEquals(
    section(md, "## Testing — the flow").includes("- [ ]"),
    false,
    "The flow contains checkboxes. The flow is the procedure; the checklist tracks it.",
  );
});

Deno.test("SKILL.md: one skill, frontmatter name is ingrain-security", async () => {
  const fm = parseFrontmatter(await Deno.readTextFile(SKILL));
  assertEquals(fm.name, "ingrain-security");
});

Deno.test("SKILL.md: the description carries both phase triggers", async () => {
  const fm = parseFrontmatter(await Deno.readTextFile(SKILL));
  const description = String(fm.description);
  // Development: the planning trigger — before code.
  assertStringIncludes(description, "AS THE FINAL STEP of building an implementation plan");
  // Testing: the verification trigger — after code.
  assertStringIncludes(description, "AFTER you have implemented code");
  assertStringIncludes(description, "before you present or commit it");
  // Both moments are labeled — in the reader's terms rather than the flow's phase names, which
  // mean nothing to someone deciding whether to run this — and stated as mutually exclusive.
  assertStringIncludes(description, "Before you build");
  assertStringIncludes(description, "After you build");
  assertStringIncludes(description, "mutually exclusive");
});

Deno.test("SKILL.md: routes to a phase from repo state, then points at the reference", async () => {
  const md = await Deno.readTextFile(SKILL);
  // The phase-select block runs before anything else.
  assertStringIncludes(md, "## Phase select — do this FIRST");
  // Testing is a pointer section, not the procedure — the detail is read on demand.
  assertStringIncludes(md, "## Testing — verification");
  assertStringIncludes(md, "Read `references/testing/verification-pass.md` NOW and follow it.");
  // The three Testing conditions, and the signals they are read from. The third is the BRANCH
  // DELTA, not the working tree: a fully-committed implementation must still route to Testing.
  assertStringIncludes(md, "has_content");
  assertStringIncludes(md, "scripts/branch-delta");
  assertStringIncludes(md, "delta_empty");
  assertStringIncludes(md, "this section is a pointer, and the procedure is in that file");
});

Deno.test("SKILL.md: the SUBAGENT-STOP block covers the Testing read and both phases", async () => {
  const md = await Deno.readTextFile(SKILL);
  // The Testing worker reads the injected SKILL.md and sees a non-empty branch delta — the
  // block places the orchestration, both phases of it, with the session that dispatched it.
  assertStringIncludes(md, "ingrain-threat-verifier), do the one job you were given");
  assertStringIncludes(md, "Development and Testing alike");
});

Deno.test("verification-pass.md: dispatches the read-only verifier via its reference file", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // The one worker role and the read-reference dispatch mechanism.
  assertStringIncludes(md, "ingrain-threat-verifier");
  // ABSOLUTE, from the mint's plugin_root: a dispatched subagent has read nothing
  // yet, so a relative path resolves against the USER'S project and the read fails on
  // its first action. This assertion pinned the relative form; see
  // `static/dispatchPaths.test.ts` for the scan that covers every dispatch site.
  assertStringIncludes(
    md,
    "Read <plugin_root>/skills/ingrain-security/references/testing/ingrain-threat-verifier.md",
  );
  // The read-only constraint is restated for the dispatched subagent.
  assertStringIncludes(md.toLowerCase(), "read-only");
  // Now a sibling reference in the same skill — no cross-skill path survives the merge.
  assertStringIncludes(md, "references/lib/dispatch.md");
  // The verifier's own contract is stated here, not reached for across the phase boundary.
  assertStringIncludes(md, "Its whole output is what it returns");
  assertEquals(md.includes("../ingrain-security/"), false, "cross-skill paths must be collapsed");
  // The prompt the orchestrator actually pastes points the verifier at everything it needs —
  // all of it inside ONE file now, since the rules ride in the assessment. Assert on the
  // fenced block alone: the surrounding prose addresses the orchestrator, not the subagent.
  const prompt = fencedBlock(section(md, "## How to dispatch a verifier"));
  for (const needed of ["assessment_abs", "## Org rules", "## Implementation guidance"]) {
    assertStringIncludes(prompt, needed);
  }
});

Deno.test("verification-pass.md: one verifier per selected threat", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "per selected threat");
  // And the rule axis's twin — "selected" alone is a substring of the line above, so it could
  // never fail independently; this is the scope claim that actually needs pinning.
  assertStringIncludes(md, "per **selected** rule");
});

Deno.test("verification-pass.md: writes to the absolute assessment_abs, minted not hand-built", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "assessment_abs");
  // The verifier dispatch template must hand out the absolute path, never a relative one.
  assertStringIncludes(md, "<the minted assessment_abs — the ABSOLUTE path, pasted in full>");
  // The path is minted by the bundled script, and the relative form is display-only. The
  // full invocation, not the bare word "mint" — that appears throughout as ordinary prose
  // ("the mint", "re-minting") and so cannot distinguish a documented command.
  assertStringIncludes(md, "scripts/assessment-mint");
  assertStringIncludes(md, "assessment-mint <host> --title");
  assertStringIncludes(md, "assessment_path");
  // Same deterministic branch+task file the plan review wrote.
  assertStringIncludes(md, ".ingrain-security/assessment-<branch-slug>-<task-slug>.md");
  // The schema itself belongs to the formatting reference; this file points at it.
  assertStringIncludes(md, "references/lib/assessment-file.md");
});

/**
 * Testing writes the assessment exactly once, in a later session that holds none of the plan
 * review's context — so it is the pass with the most to lose from a mandatory 345-line schema
 * read, and the last chance to catch a malformed entry before the file is inherited. Both
 * halves are pinned: it writes FROM the field cards, and it three-checks against them on the
 * one read it already makes.
 */
Deno.test("verification-pass.md: writes from the field cards and three-checks its one write", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "field card");
  // The reference is demoted to a meaning lookup, exactly as in the Development spine.
  assertStringIncludes(md, "open it for what a field *means*");
  // One write, one read, one check — named, not "against the schema".
  assertStringIncludes(md, "three-check");
  assertStringIncludes(md, "never against a fresh read of the schema");
  // And the checklist tracks it, like every other step-6 obligation.
  assertStringIncludes(md, "three-checked against the field cards");
  // What the Robustness levels MEAN stays this file's own — the card carries only the words.
  assertStringIncludes(md, "**Robustness levels**");
});

Deno.test("verification-pass.md: guards title drift, stays in the Testing phase", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // A drifted --title mints a different path; falling through to Development would re-run the
  // whole planning review on already-written code. This is the merge's sharpest edge.
  assertStringIncludes(md, "verbatim");
  assertStringIncludes(md, "Testing is the phase you stay in.");
});

Deno.test("verification-pass.md: verifies the branch diff since the fork point and reuses the assessment schema", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // The diff basis is the fork point — committed work included, not just the dirty tree — and it
  // is resolved by the bundled script, so the gate and the review cannot drift apart.
  //
  // The raw-git literals this used to pin (`git diff <diff_ref>`, `git status`) are gone on
  // purpose: every git command the review runs now comes from the script, and a doc naming a
  // hand-written one is the drift that produced audit H7. What replaces them pins the same
  // property from the other side — the file must name the script and the ref, and must NOT
  // hand out a bare diff command.
  assertStringIncludes(md, "scripts/branch-delta");
  assertStringIncludes(md, "diff_ref");
  assertStringIncludes(md, "branch-delta <host> diff --ref <diff_ref>");
  assertEquals(
    /`git diff <diff_ref>`/.test(md),
    false,
    "verification-pass.md hands out a raw `git diff <diff_ref>` again — every git command the " +
      "review runs comes from the bundled script (audit H7).",
  );
  // HEAD survives only as the documented fallback, and must stay documented.
  assertStringIncludes(md, "git diff HEAD");
  assertStringIncludes(md, "only as the fallback");
  // Reuses the shared schema reference rather than redefining it.
  assertStringIncludes(md, "references/lib/assessment-file.md");
});

Deno.test("verification-pass.md: marks the assessment checked (Robustness + Latest stage: testing)", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "Latest stage: testing");
  // The two columns the orchestrator records, and the enum it picks from.
  assertStringIncludes(md, "Robustness");
  assertStringIncludes(md, "Justification");
  for (const v of ["`weak`", "`adequate`", "`strong`"]) assertStringIncludes(md, v);
  // One concept, one name, and now one PLACE: Robustness lives on the threat alone, because
  // guidance is the vessel and takes no verdict of its own.
  assertEquals(md.includes("Verification level"), false, "one name for the concept: Robustness");
  assertStringIncludes(md, "recorded on the threat and nowhere else");
  // The old verdict enum is gone from the schema. Note this pins the ENUM, not the bare
  // words: the prose and the report's Gap column still legitimately say "insufficient".
  assertEquals(
    md.includes("`verified` | `insufficient` | `missing`"),
    false,
    "the old verdict enum must be gone",
  );
  assertEquals(md.includes("**`Verified`**"), false, "the Verified column is renamed");
  // Two subjects, and only two. Testing writes into neither the vessel nor the gate's record.
  assertStringIncludes(md, "Write nothing into `## Implementation guidance`");
});

Deno.test("verification-pass.md: reads org rules from the assessment's own section, no CLI", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // Rules come from the assessment itself, written there by the plan review's retrieval.
  assertStringIncludes(md, "## Org rules");
  assertStringIncludes(md, "Rule refs");
  // No CLI anywhere in the verification pass.
  assertEquals(md.includes("ingrain context"), false, "Testing never queries the CLI");
  assertEquals(md.includes("ingrain --version"), false, "Testing never probes the CLI");
});

Deno.test("verification-pass.md: announces itself and reports to the coding agent (no user gates)", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "Using ingrain-security to verify the implementation.");
});

Deno.test("verifier ref: INTERNAL worker, read-only with a narrow read-only-git exception on the branch diff", async () => {
  const md = await Deno.readTextFile(VERIFIER_REF);
  const fm = parseFrontmatter(md);
  assertEquals(fm.name, "ingrain-threat-verifier");
  // Marked internal so it does not self-trigger: the description says the only way in is a
  // dispatch from the orchestrator.
  assertStringIncludes(String(fm.description), "reachable solely through a dispatch");
  assertStringIncludes(md.toLowerCase(), "internal worker");
  // Read-only on the codebase, with read-only git to obtain the diff, and its whole output is
  // the verdict it returns.
  assertStringIncludes(md.toLowerCase(), "read-only");
  // The verifier is HANDED the ref by the orchestrator and reads the change at that exact
  // string — the merge-base, which is what exposes the committed implementation. It reaches it
  // through the bundled script, never a git command of its own.
  assertStringIncludes(md, "`branch-delta` command your dispatch carries");
  assertStringIncludes(md, "never write a git command of your own");
  assertStringIncludes(md, "exactly as the orchestrator gave it");
  // Grades on the Robustness ladder, and leads with the JUSTIFICATION — not the level. The
  // order is the point: a level written first is one the justification then argues for.
  for (const v of ["`weak`", "`adequate`", "`strong`"]) assertStringIncludes(md, v);
  assertOrder(md, "JUSTIFICATION", "LEVEL", "the verifier leads with its justification");
});

Deno.test("verification-pass.md: defines the three Robustness levels", async () => {
  const s = section(await Deno.readTextFile(VERIFY), "## Robustness levels");
  // The ladder is named by the column that carries it, not by a bare "level".
  assertStringIncludes(s, "**Robustness**");
  for (const v of ["`weak`", "`adequate`", "`strong`"]) assertStringIncludes(s, v);
  // The ladder is negative testing: `weak` means the threat survives the change.
  assertStringIncludes(s.toLowerCase(), "can still be realized");
  // `strong` is `adequate` PLUS artefacts — not a synonym for "well implemented".
  assertStringIncludes(s.toLowerCase(), "artefact");
  assertStringIncludes(s.toLowerCase(), "test");
});

Deno.test("verification-pass.md: the Robustness is concluded from the justification's evidence", async () => {
  const s = section(await Deno.readTextFile(VERIFY), "## Concluding the Robustness");
  const lower = s.toLowerCase();
  // The justification is read and weighed BEFORE the level — the level is re-derived, not
  // forwarded from the verifier.
  assertOrder(lower, "justification", "level", "the justification is weighed before the level");
  assertStringIncludes(s, "file:line");
  // The conclusion — and the Justification — are the orchestrator's own.
  assertStringIncludes(lower, "your own");
});

Deno.test("verifier ref: reads its rule bodies from the assessment itself, runs no CLI", async () => {
  const md = await Deno.readTextFile(VERIFIER_REF);
  // The org rule body is handed to the verifier by pointer, into the SAME file as its threat.
  assertStringIncludes(md, "## Org rules");
  // The guidance Description stays the claim the verifier checks against the code.
  assertStringIncludes(md, "Description");
  // The verifier gains no CLI — the orchestrator points it at the file; it never queries.
  assertEquals(md.includes("ingrain context"), false, "verifier must not run the CLI");
});

Deno.test("assessment-file.md: defines the Justification + Robustness fields", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The two fields and the enum.
  assertStringIncludes(md, "**Robustness**");
  assertStringIncludes(md, "**Justification**");
  for (const v of ["`weak`", "`adequate`", "`strong`"]) assertStringIncludes(md, v);
  assertEquals(md.includes("**Verified**"), false, "the Verified field is renamed");
  // One concept, one name — and one PLACE. `Robustness` lives on the threat alone: guidance is
  // the vessel a threat is closed through, never a subject, so it takes no verdict of its own.
  assertEquals(md.includes("Verification level"), false, "one name for the concept: Robustness");
  assertStringIncludes(md, "never itself a subject of\nverification");
  // It is the Testing verification pass that fills them, after the code is written.
  assertStringIncludes(md, "Testing");
  assertStringIncludes(md, "Latest stage: testing");
  // The template teaches the reasoning-first ordering on the threat entry, which is now the
  // only entry carrying a verdict at all — and since the `#### test` block it sits in was
  // introduced, the template finally SHOWS what this comment always claimed. The pair used to
  // read verdict-then-reasoning here while every other layer ran the other way round: both
  // verifiers return JUSTIFICATION first, and `Concluding the Robustness` opens with "read the
  // justification before you look at the level". Reversing it back re-opens that split.
  assertStringIncludes(md, "Robustness justification: …\nRobustness: adequate");
  // Every reasoning field in the file carries the same STYLE: the threat's scoring
  // Justification, its Robustness justification, and the rule adherence Justification. A
  // tripwire, deliberately a bare count — a fourth reasoning field added without direction, or
  // an existing one losing it, both land here. (The guidance Justification left with the
  // verdict pair: the vessel has no reasoning to record, because it concludes nothing.)
  //
  // This used to count a `≤ 256 characters` cap. The cap was inherited from a custom agent's
  // formatted-output contract that no longer exists, and enforcing prose length in a schema
  // makes a well-reasoned verdict a validation failure. The skill owns how a justification
  // reads, so it directs the writing instead — and the wire keeps only a runaway backstop,
  // far above anything a writer produces.
  assertEquals(
    [...md.matchAll(/a sentence or two/g)].length,
    3,
    "all three reasoning fields must carry the style direction: threat Justification, threat " +
      "Robustness justification, rule adherence Justification",
  );
  // One artifact: the org rules are a section of THIS file, and the sidecar reference is gone.
  assertStringIncludes(md, "### `## Org rules`");
  assertEquals(
    md.includes("references/lib/rules-file.md"),
    false,
    "the sidecar reference is deleted — its content folded into this file",
  );
});

/**
 * The rule dimension — the capability this release adds. Adherence answers the security
 * owner's question ("were the rules we set followed?"), which threat robustness cannot: the
 * two axes are independent and may legitimately disagree. Every assertion below guards one of
 * the rules that keep them from collapsing into each other.
 */
Deno.test("verification-pass.md: carries the rule dimension alongside the threat one", async () => {
  const md = await Deno.readTextFile(VERIFY);
  const s = section(md, "\n## Rule adherence\n");
  // The vocabulary is two-valued, because scope is the set the user accepted and every rule in
  // it applies by deliberate decision.
  for (const v of ["`followed`", "`not-followed`"]) assertStringIncludes(s, v);
  // Pins the ENUM, not the bare words: the prose legitimately says there is no "not applicable"
  // state, which is the opposite of introducing one.
  assertEquals(
    /`not[- ]applicable`/i.test(s),
    false,
    "adherence is two-valued — a third enumerated value would reopen the question scope answers",
  );
  // Scope is the GATE'S SELECTION, read off `## Org rules` — not off what guidance happened to
  // drive. Keying on `Rule refs` would make the security owner's hardest case unreachable.
  assertStringIncludes(s, "## Org rules");
  assertStringIncludes(s, "not off `Rule refs`");
  assertStringIncludes(s.toLowerCase(), "no guidance implements is still judged");
  assertStringIncludes(s.toLowerCase(), "retrieval alone is likewise never adherence");
  // An excluded rule is a recorded decision, never a verdict.
  assertStringIncludes(s, "An excluded rule gets no entry");
  // One verdict per RULE, not per driving entry.
  assertStringIncludes(s, "One verdict per rule");
});

/**
 * The two anti-false-assurance rules, stated where the orchestrator concludes. Both are easy to
 * lose: a reader who has just concluded robustness has the wrong answer close to hand, and the
 * threat pass two sections up filters on `selected` — so the unfiltered rule scope reads like
 * an oversight unless it is called out as deliberate.
 */
Deno.test("verification-pass.md: adherence is never derived from robustness or selection", async () => {
  const md = await Deno.readTextFile(VERIFY);
  // Stated up front as a property of the phase...
  assertStringIncludes(md, "neither is derived from the other");
  // ...and again as a check at the point of conclusion, where it actually bites.
  const s = section(md, "## Concluding the Adherence");
  assertStringIncludes(s, "must not be read off the threat");
  // ...nor off the paperwork on the other side: whether any guidance drives the rule.
  assertStringIncludes(s, "whether any guidance drives the rule");
  // The justification is weighed BEFORE the verdict — same discipline as the threat axis.
  assertOrder(s.toLowerCase(), "justification", "verdict", "the justification is weighed first");
  // Dropped guidance is the usual cause of `not-followed`, never the verdict itself.
  assertStringIncludes(section(md, "\n## Rule adherence\n"), "does not decide it");
});

Deno.test("rule verifier ref: INTERNAL read-only worker, one per selected rule, judges the code", async () => {
  const md = await Deno.readTextFile(RULE_VERIFIER_REF);
  const fm = parseFrontmatter(md);
  assertEquals(fm.name, "ingrain-rule-verifier");
  assertStringIncludes(String(fm.description), "reachable solely through a dispatch");
  assertStringIncludes(md.toLowerCase(), "internal worker");
  assertStringIncludes(md.toLowerCase(), "read-only");
  // Same diff basis as its threat-axis twin, handed down by the orchestrator and read through
  // the same bundled script.
  assertStringIncludes(md, "`branch-delta` command your dispatch carries");
  assertStringIncludes(md, "never write a git command of your own");
  assertStringIncludes(md, "exactly as the orchestrator gave it");
  // Its verdict vocabulary, and the justification-first ordering the orchestrator weighs.
  for (const v of ["`followed`", "`not-followed`"]) assertStringIncludes(md, v);
  assertOrder(md, "JUSTIFICATION", "ADHERENCE", "the rule verifier leads with its justification");
  // It judges the CONTROL, not the paperwork: absent guidance does not settle the verdict, and
  // a control satisfied by another mechanism still counts.
  assertStringIncludes(md, "is not the verdict");
  assertStringIncludes(md.toLowerCase(), "by other means");
  // A rule NOTHING implements is judged all the same — the case the cited-set scope could not
  // reach, and the one a security owner most needs.
  assertStringIncludes(md, "**There may\n  be none.**");
  // It must not stray onto the threat axis — that is a sibling verifier's question.
  assertStringIncludes(md, "Say nothing about threats");
  // Rule bodies come off disk, from the assessment's own section; no worker gains a CLI.
  assertStringIncludes(md, "## Org rules");
  assertEquals(md.includes("ingrain context"), false, "rule verifier must not run the CLI");
});

Deno.test("verification-pass.md: dispatches one rule verifier per selected rule, in the same block", async () => {
  const md = await Deno.readTextFile(VERIFY);
  assertStringIncludes(md, "ingrain-rule-verifier");
  // ABSOLUTE, from the mint's plugin_root: a dispatched subagent has read nothing
  // yet, so a relative path resolves against the USER'S project and the read fails on
  // its first action. This assertion pinned the relative form; see
  // `static/dispatchPaths.test.ts` for the scan that covers every dispatch site.
  assertStringIncludes(
    md,
    "Read <plugin_root>/skills/ingrain-security/references/testing/ingrain-rule-verifier.md",
  );
  // The two fan-outs share nothing, so they cost one round trip, not two.
  assertStringIncludes(md, "in one block");
  // The dispatch prompt itself must hand over both minted paths plus the rule identity —
  // assert on the fenced block, since the surrounding prose addresses the orchestrator.
  const prompt = fencedBlock(section(md, "## How to dispatch a rule verifier"));
  for (const needed of ["assessment_abs", "## Org rules", "<rule-id>", "diff_ref"]) {
    assertStringIncludes(prompt, needed);
  }
});

Deno.test("assessment-file.md: defines the ## Rule adherence section and its id-keyed entries", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  const s = section(md, "### `## Rule adherence`");
  assertStringIncludes(s, "**Adherence**");
  for (const v of ["`followed`", "`not-followed`"]) assertStringIncludes(s, v);
  // Entries are keyed by RULE ID, not by a T/M tag — a third entry shape a parser must handle
  // explicitly rather than by pattern-matching the tag form.
  assertStringIncludes(s, "`### <rule-id> — <title>`");
  assertStringIncludes(s, "not by a `T`/`M` tag");
  // The section is the Testing pass's to write, and it is the only one with no Development half.
  assertStringIncludes(md, "| `## Rule adherence` | the Testing verification pass");
});

Deno.test("assessment-file.md: threat entries carry the three verification fields", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  for (const field of ["**Robustness justification**", "**Residual path**", "**Evidence**"]) {
    assertStringIncludes(md, field);
  }
  // The naming collision is the whole reason `Robustness justification` is not called
  // `Justification`: on a threat entry that name already means the RISK-SCORING rationale.
  assertStringIncludes(md, "Deliberately **not** named `Justification`");
  // The four are the `#### test` block — one named region the Testing pass fills in a single
  // edit, which is what replaced "they happen to be contiguous at the tail" as the guarantee.
  assertStringIncludes(
    md,
    "| `#### test` | the Testing verification pass | Robustness justification, Robustness, " +
      "Residual path, Evidence |",
  );
  // And the load-bearing half: an unrun block carries NO field lines. The template's excluded
  // threat is the case that shows it — under the old flat layout those four lines read `—`,
  // which is exactly the seeding this replaced. If `—` placeholders creep back into an empty
  // block, the CLI can no longer tell "this stage has not run" from "this stage ran and found
  // nothing to say", and a half-run verification starts reporting as a finished one.
  assertStringIncludes(md, "Selection: excluded\n\n#### test\n\n## Risk score");
});

Deno.test("assessment-file.md: `## Task` declares a Description and a Schema version", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  assertStringIncludes(md, "- **Description** —");
  assertStringIncludes(md, "- **Schema version** —");
  // The version is what lets a consumer branch on a declared schema instead of sniffing
  // structure; this release is the one that stamps 2.
  assertStringIncludes(md, "Schema version: 2");
});

/**
 * Ids are exact-match keys, and a real assessment was observed writing truncated ones while the
 * full UUIDs sat beside them. A worker copying the shape copies the example, so the
 * illustrative ids are a contributing cause — not merely a cosmetic detail.
 */
Deno.test("rule ids: the examples are full UUIDs and the docs forbid abbreviating them", async () => {
  const assessment = await Deno.readTextFile(ASSESSMENT_REF);
  const generator = await Deno.readTextFile(
    `${ROOT}skills/ingrain-security/references/development/ingrain-guidance-generator.md`,
  );

  assertEquals(
    /\br-[a-z]+-\d+\b/.test(assessment),
    false,
    "assessment-file.md still shows a non-UUID placeholder rule id — a worker copies the example",
  );
  // Both ends of the link now sit in ONE file, and the example teaches the join by showing the
  // same id in both places — which is exactly what the sidecar's deletion makes checkable here.
  const shared = "0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f";
  assertStringIncludes(assessment, `Rule refs: ${shared}`);
  assertStringIncludes(assessment, `### ${shared} — `);
  // And the instruction is tightened where the ids are actually written.
  assertStringIncludes(assessment, "never abbreviated, never a prefix");
  assertStringIncludes(generator, "never abbreviate one to a prefix");
});

/**
 * Both phases hand their finished artifact to the CLI. The two properties that keep
 * that safe are easy to lose in an edit: the sync runs **after** the write (the CLI
 * reads the file off disk, so syncing first would send the previous state), and it
 * is **best-effort** (the review's output is the assessment and the report; a failed
 * sync must never fail a security review).
 */
Deno.test("sync triggers: both finalizes invoke their record command, after the write", async () => {
  // The two PHASE FLOWS, paired — each owns its finalize, so this is the symmetry check it
  // always meant to be. Before the Development flow moved into its own reference, the left
  // side was SKILL.md because that is where the design finalize happened to live.
  const design = await Deno.readTextFile(DEV_FLOW);
  const verify = await Deno.readTextFile(VERIFY);

  assertStringIncludes(design, "ingrain record design");
  assertStringIncludes(verify, "ingrain record verification");

  for (const [name, md] of [["flow.md", design], ["verification-pass.md", verify]] as const) {
    // Collapse whitespace: these docs are hand-wrapped, so the phrase routinely
    // straddles a line break and matching raw text would pin the current wrapping.
    const prose = md.replace(/\s+/g, " ");
    assertStringIncludes(prose, "best-effort");
    assertEquals(
      /never fails? the (review|verification)/i.test(prose),
      true,
      `${name} must state that a failed sync never fails the review`,
    );
    // Ordering is the subtle one: the CLI reads the file off disk.
    assertStringIncludes(md, "AFTER");
  }

  // No skill file may learn the wire contract — the skill stays platform-agnostic,
  // and the CLI is the only place that knows what the backend accepts.
  //
  // `ingrain-cli.md` is in the sweep because it is the likeliest to drift: its whole
  // job is to describe the commands, so a "helpful" note about what a payload
  // carries reads as documentation rather than as the coupling it would be.
  const cliRef = await Deno.readTextFile(
    `${ROOT}skills/ingrain-security/references/lib/ingrain-cli.md`,
  );
  const skill = await Deno.readTextFile(SKILL);
  for (const leak of ["syncKey", "runId", "threatVerdicts", "ruleVerdicts", "assessmentRunId"]) {
    for (
      const [name, md] of [["SKILL.md", skill], ["flow.md", design], [
        "verification-pass.md",
        verify,
      ], ["ingrain-cli.md", cliRef]] as const
    ) {
      assertEquals(
        md.includes(leak),
        false,
        `${name} must not carry the wire contract (found "${leak}")`,
      );
    }
  }
});

Deno.test("ingrain-cli.md: documents both syncs and classifies a malformed artifact", async () => {
  const md = await Deno.readTextFile(
    `${ROOT}skills/ingrain-security/references/lib/ingrain-cli.md`,
  );

  assertStringIncludes(md, "ingrain record design");
  assertStringIncludes(md, "ingrain record verification");
  // The one failure worth acting on rather than degrading past — it is fixable
  // here and now, and `validate` needs no config or network to show what is wrong.
  assertStringIncludes(md, "Malformed artifact");
  assertStringIncludes(md, "ingrain validate");
  // Deliberately NOT asserted: that the page still mentions `--rules`. The only
  // occurrence is the sentence recording that the flag is gone, so the assertion
  // would be satisfied by its own negation — and deleting the tombstone, which is
  // ordinary cleanup, would fail it for the wrong reason. The flag's absence is
  // guarded structurally below, in the sidecar sweep.
});

/**
 * The org-rules sidecar is gone: the rules ride in the assessment's own `## Org rules` section.
 * This guards the removal across every layer that referenced it — a surviving mint, script or
 * schema file would leave the skill writing a second artifact nothing reads.
 */
Deno.test("the rules sidecar is gone, in every place that knew about it", async () => {
  for (const gone of [`${ROOT}skills/ingrain-security/scripts/rules-path`, RULES_REF]) {
    const present = await Deno.stat(gone).then(() => true, () => false);
    assertEquals(present, false, `${gone} must be deleted — one artifact carries the analysis`);
  }
  // Every doc that ever named it, swept whole-file for all three literals. This subsumes the
  // per-slice checks these tests used to carry one at a time: a file-wide check is strictly
  // stronger than one over a dispatch block, and one sweep cannot drift out of step with
  // itself the way four scattered copies did.
  for (
    const [name, path] of [
      ["SKILL.md", SKILL],
      ["verification-pass.md", VERIFY],
      ["ingrain-threat-verifier.md", VERIFIER_REF],
      ["ingrain-rule-verifier.md", RULE_VERIFIER_REF],
      ["assessment-file.md", ASSESSMENT_REF],
      ["dispatch.md", `${ROOT}skills/ingrain-security/references/lib/dispatch.md`],
      ["ingrain-cli.md", `${ROOT}skills/ingrain-security/references/lib/ingrain-cli.md`],
    ] as const
  ) {
    const md = await Deno.readTextFile(path);
    for (const gone of ["rules_abs", "rules-path", "rules-file.md"]) {
      assertEquals(
        md.includes(gone),
        false,
        `${name} must not name \`${gone}\` — one artifact carries the analysis`,
      );
    }
  }
  // The minter and the write grant knew the second label by name; both must have forgotten it.
  const templateLib = await Deno.readTextFile(
    `${ROOT}skills/ingrain-security/scripts/lib/artifact-template.sh`,
  );
  assertEquals(
    templateLib.includes('[ "${label}" = "rules" ]'),
    false,
    "artifact-template.sh must render one skeleton, not two",
  );
  const writeLib = await Deno.readTextFile(
    `${ROOT}hooks/scripts/lib/assessment-write.sh`,
  );
  assertEquals(
    writeLib.includes("rules*.md"),
    false,
    "the write grant must cover the assessment alone",
  );
});

/**
 * The Stop-hook reminder was removed: Testing is no longer nudged at the turn boundary, and
 * `verify-check` (both host wrappers + the shared decision lib) is gone with it. Testing now
 * runs on the skill's own description or an explicit request.
 *
 * This guards the removal in both directions. A Stop entry that reappears would fire a hook
 * whose script no longer exists — failing on every turn end, on a file nobody would think to
 * look at — so the registration and the scripts have to stay gone together.
 */
Deno.test("hook.json: neither host registers a Stop hook", async () => {
  for (const [host, path] of [["Claude", HOOK_JSON], ["Codex", CODEX_HOOK_JSON]] as const) {
    const hook = JSON.parse(await Deno.readTextFile(path));
    assertEquals(hook.hooks?.Stop, undefined, `${host} must not register a Stop hook`);
    assertEquals(
      JSON.stringify(hook).includes("verify-check"),
      false,
      `${host} must not reference the removed verify-check script`,
    );
  }
});

Deno.test("verify-check: the scripts and shared lib are gone", async () => {
  const removed = [
    "hooks/claude/verify-check",
    "hooks/codex/verify-check",
    "skills/ingrain-security/scripts/lib/verify-check.sh",
  ];
  for (const rel of removed) {
    const exists = await Deno.stat(`${ROOT}${rel}`).then(() => true, () => false);
    assertEquals(exists, false, `${rel} was removed with the Stop hook and must not return`);
  }
});

/**
 * **The branch delta is where a verifier STARTS, never the boundary of what it may read.**
 *
 * Both verifiers already held Read/Grep/Glob over the whole tree, but every framing sentence
 * said "in the branch diff" and — the part that actually bound them — the EVIDENCE contract
 * demanded a `file:line` **in the diff**. That made the two most valuable verdicts unreachable:
 * a `weak` robustness must name a **residual path**, which by definition survives the change and
 * usually runs through untouched code; and `not-followed` is a claim about a control that is
 * *absent*, which has no line in a diff anywhere.
 *
 * Pinned because it is prose carrying a behavioural rule: a reword drops it silently, and the
 * failure looks like a clean review rather than a broken one.
 */
Deno.test("verifiers: the delta is an entry point, and evidence may sit outside it", async () => {
  const threat = await Deno.readTextFile(VERIFIER_REF);
  const rule = await Deno.readTextFile(RULE_VERIFIER_REF);
  const pass = await Deno.readTextFile(VERIFY);

  // Both workers are told the boundary rule in their own file — a dispatched subagent reads
  // only its own reference, so stating it in the pass alone would never reach them.
  for (const [name, md] of [["threat", threat], ["rule", rule]] as const) {
    assertStringIncludes(md, "ENTRY POINT, not your boundary");
    assertStringIncludes(md, "code as built");
    // The binding half: evidence is not confined to the delta.
    assertStringIncludes(md, "ANYWHERE in the tree");
    assertEquals(
      /EVIDENCE: <file:line in the diff/.test(md),
      false,
      `the ${name} verifier's EVIDENCE contract still confines citations to the diff`,
    );
  }

  // Absence is the `not-followed` case and cannot be a line anywhere — the rule verifier has to
  // be told what to cite instead, or the verdict a security owner most needs reads unsupported.
  assertStringIncludes(rule, "absence has no line in a diff");
  assertStringIncludes(pass, "no line to cite at all");

  // And the orchestrator must not discount a citation for sitting outside the delta — it is the
  // party that re-derives every verdict, so its weighing rule is where the limit would return.
  assertStringIncludes(pass, "is not weaker evidence");
});

/**
 * The complete changed-file set is the script's to assemble, not the agent's — `git diff` never
 * lists an untracked file and `git status` never lists a committed-only one, so leaving the
 * union to prose left every caller merging two outputs and parsing porcelain by hand.
 */
Deno.test("verification-pass: takes the changed-file set from the script, as a starting point", async () => {
  const pass = await Deno.readTextFile(VERIFY);
  assertStringIncludes(pass, "`changed_files`");
  // Resolved, not a command to run — and the orchestrator takes no diff of its own, because
  // each verifier fetches the change for its own subject and a copy here has no reader.
  assertStringIncludes(pass, "arrives resolved");
  assertStringIncludes(pass, "you do not run a diff of your own");
  // The label is load-bearing: a tidy machine-produced list reads as authoritative scope
  // precisely because it is tidy, which is the reading this whole rule exists to prevent.
  assertStringIncludes(pass, "where a review STARTS, and never where it stops");
});

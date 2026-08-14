/**
 * Static checks on the skill and hook wiring. No model calls. Guards the
 * workflow contract the live tests rely on: the strict step order, the two
 * announce/stop phrases, references to all 7 workers, and a valid SessionStart
 * hook that injects the skill.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";
import {
  assertChecklistTracksFlow,
  assertOrder,
  parseFrontmatter,
  section,
} from "../lib/matchers.ts";
import { WORKERS } from "../lib/workers.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL = `${ROOT}skills/ingrain-security/SKILL.md`;
const DEV_FLOW = `${ROOT}skills/ingrain-security/references/development/flow.md`;

/**
 * The Development instruction set as the orchestrator actually receives it: `SKILL.md` — which
 * carries Phase select and the machinery both phases share — followed by the flow reference it
 * routes to. Whole-document assertions read this, because "the skill says X" is a claim about
 * what the orchestrator ends up holding, not about which of the two files a sentence sits in.
 * An assertion about one specific section reads that section's own file instead.
 */
const devDoc = async (): Promise<string> =>
  `${await Deno.readTextFile(SKILL)}\n${await Deno.readTextFile(DEV_FLOW)}`;
const ASSESSMENT_REF = `${ROOT}skills/ingrain-security/references/lib/assessment-file.md`;
const DISPATCH_REF = `${ROOT}skills/ingrain-security/references/lib/dispatch.md`;
const HOOK_JSON = `${ROOT}hooks/claude/hook.json`;
const CODEX_HOOK_JSON = `${ROOT}hooks/codex/hook.json`;
const SESSION_START = `${ROOT}hooks/scripts/session-start`;
const ALLOW_HOOK = `${ROOT}hooks/claude/allow-assessment-write`;
const CODEX_ALLOW_HOOK = `${ROOT}hooks/codex/allow-assessment-write`;
const ALLOW_LIB = `${ROOT}hooks/scripts/lib/assessment-write.sh`;
const ENSURE_DIR = `${ROOT}hooks/scripts/ensure-assessment-dir`;
const PROJECT_ROOT_LIB = `${ROOT}skills/ingrain-security/scripts/lib/project-root.sh`;
const PATH_SCRIPT = `${ROOT}skills/ingrain-security/scripts/assessment-mint`;
const TEMPLATE_LIB = `${ROOT}skills/ingrain-security/scripts/lib/artifact-template.sh`;
const SCORER_REF = `${ROOT}skills/ingrain-security/references/development/ingrain-risk-scorer.md`;

/**
 * Collapse every run of whitespace to one space so a phrase can be asserted as the reader
 * sees it — these docs are hand-wrapped, and matching raw text would tie the assertion to
 * the current line breaks.
 */
const flatten = (md: string): string => md.replace(/\s+/g, " ");

Deno.test("SKILL.md: frontmatter name is ingrain-security", async () => {
  const fm = parseFrontmatter(await Deno.readTextFile(SKILL));
  assertEquals(fm.name, "ingrain-security");
});

Deno.test("SKILL.md: references every worker", async () => {
  const md = await Deno.readTextFile(SKILL);
  for (const w of WORKERS) assertStringIncludes(md, w);
});

Deno.test("SKILL.md: workflow steps are in the required order", async () => {
  const md = await Deno.readTextFile(DEV_FLOW);
  // EVERY ordering assertion is anchored on the flow section, never the whole file. The
  // `<SUBAGENT-STOP>` preamble lists all seven workers in flow order, so a whole-file
  // `assertOrder` compares two positions inside that one listing and holds no matter where
  // the steps actually sit — moving the rule critic to AFTER the rule gate stayed green.
  // If you add an assertion here, pass `flow`.
  const flow = section(md, "## Development — the flow");
  assertOrder(
    flow,
    "Run a security review for this change?",
    "ingrain-threat-generator",
    "the review question before threats",
  );
  assertOrder(
    flow,
    "ingrain-threat-generator",
    "ingrain-threat-critic",
    "generate before critique",
  );
  assertOrder(
    flow,
    "ingrain-threat-critic",
    "ingrain-risk-scorer",
    "critique/freeze before scoring",
  );
  assertOrder(flow, "ingrain-risk-scorer", "ingrain-guidance-generator", "score before guidance");
  assertOrder(
    flow,
    "ingrain-guidance-generator",
    "ingrain-guidance-critic",
    "generate guidance before critique",
  );
  // The rule chain runs in PARALLEL with the threat chain, so it is not ordered against it —
  // but its own two steps are sequential, and the gate cannot precede the prune that curates
  // what it presents. This is decision 12's precondition: wholesale accept-all is only sound
  // over a curated set.
  assertOrder(flow, "ingrain-rule-critic", "rule gate", "rule critique before the rule gate");
  // The join: guidance needs BOTH gates, so its DISPATCH cannot precede either decision.
  assertOrder(flow, "rule gate", "ingrain-guidance-generator", "rule gate before guidance");
  assertOrder(flow, "threat gate", "ingrain-guidance-generator", "threat gate before guidance");
});

/**
 * Flow and checklist are separate entities: the flow is the detailed procedure, the checklist
 * is a terse tracker at the end enforcing that its steps were followed. Keeping them distinct
 * is the point — a checklist that grows prose stops being scannable and stops being a tracker.
 */
Deno.test("SKILL.md: the Development checklist tracks every step in the flow", async () => {
  const md = await Deno.readTextFile(DEV_FLOW);
  assertChecklistTracksFlow(md, "## Development — the flow", "## Development — checklist");
});

Deno.test("SKILL.md: the flow holds no checkboxes and the checklist stays terse", async () => {
  const md = await Deno.readTextFile(DEV_FLOW);
  // The detailed procedure must not wear checkboxes — that conflates the two entities.
  assertEquals(
    section(md, "## Development — the flow").includes("- [ ]"),
    false,
    "The flow contains checkboxes. The flow is the procedure; the checklist tracks it.",
  );
  // Every checklist item is ONE line. A caveat that needs a second line belongs in the flow.
  for (const line of section(md, "## Development — checklist").split("\n")) {
    if (!line.startsWith("- [ ] ")) continue;
    assertEquals(
      line.length <= 160,
      true,
      `Checklist line is too long to scan — move the detail into the flow:\n${line}`,
    );
  }
});

Deno.test("SKILL.md: both gate checklist lines fence table-before-windows", async () => {
  const list = section(await Deno.readTextFile(DEV_FLOW), "## Development — checklist");
  // The most-guarded behavior in the skill: the findings table is displayed BEFORE any
  // selection window. The checklist is where that ordering is enforced.
  const gates = list.split("\n").filter((l) => l.includes(" gate — ") || l.includes(" gate, "));
  // Cardinality FIRST. Without it a reword that stops matching the filter empties the loop
  // and the test passes while the checklist says whatever it likes — and this selector is
  // broad enough that other assertions have leaned on it by accident.
  assertEquals(
    gates.length,
    2,
    `Expected exactly two gate checklist lines (threat + rule), found ${gates.length}. ` +
      `If you reworded them, fix the selector — do not let it match nothing:\n${list}`,
  );
  for (const gate of gates) {
    assertEquals(
      gate.indexOf("table") < gate.indexOf("window") && gate.includes("table"),
      true,
      `Gate checklist line must put the table before the windows:\n${gate}`,
    );
  }
});

Deno.test("the announce and minor-stop phrases live in the phase file, not the shared one", async () => {
  // Both are Development's words. They belong where Development's procedure is, and SKILL.md
  // says only "announce the phase you routed to" — a phase-neutral instruction pointing at
  // whichever flow file the route reached. SKILL.md carried a verbatim copy of the Development
  // opener while merely REFERRING to Testing's, which is the asymmetry this pins shut.
  const skill = await Deno.readTextFile(SKILL);
  const flow = await Deno.readTextFile(DEV_FLOW);

  assertStringIncludes(flow, "Using ingrain-security to assess this plan.");
  assertStringIncludes(flow, "no security review needed — minor change");
  assertEquals(
    skill.replace(/\s+/g, " ").includes("Using ingrain-security to assess"),
    false,
    "SKILL.md states Development's opener verbatim — it should name neither phase's, and " +
      "send the reader to the flow file the route reached. Matched on flattened text, because " +
      "the phrase previously hid from a line-based search by straddling a line break.",
  );
});

Deno.test("dev docs: documents the read-reference dispatch mechanism", async () => {
  const md = await devDoc();
  // Generic-subagent dispatch reads each worker's reference file by path — ABSOLUTE,
  // built from the mint's `plugin_root`. This assertion previously pinned the relative
  // form, which is the form a dispatched subagent cannot resolve: its cwd is the user's
  // project, so `references/…` lands at `<project>/references/…` and the read errors on
  // the worker's first action. The suite defended that bug; see `dispatchPaths.test.ts`
  // for the scan that now covers every dispatch site rather than this one.
  assertStringIncludes(
    md,
    "Read <plugin_root>/skills/ingrain-security/references/development/<name>.md",
  );
  // Cross-platform mapping lives in the reference doc.
  assertStringIncludes(md, "references/lib/dispatch.md");
  // The per-run write target is restated inline for the dispatched subagents — it is the
  // one thing a worker cannot learn from its own reference file.
  assertStringIncludes(
    md,
    "Your ONE permitted write is your own section of the stored analysis file",
  );
});

// SKILL.md is an orchestration spine: it owns SEQUENCE and ROUTING, the reference files own
// DETAIL. So the assessment file's *schema and semantics* are asserted against their owner
// (assessment-file.md) and only the orchestrator's *action* — mint it, use the absolute form,
// go read the reference — is fenced here. A restatement creeping back into SKILL.md is the
// regression these two tests are split to prevent.

Deno.test("SKILL.md: mints the assessment path and defers its schema to the reference", async () => {
  const md = await devDoc();
  assertStringIncludes(md, ".ingrain-security/assessment-<branch-slug>-<task-slug>.md");
  // The host-root variable is still defined (used for the plan-file path).
  assertStringIncludes(md, "${coding_agent_root}");
  // The file's schema/template is defined in a dedicated reference file, and SKILL.md points
  // at it rather than restating it.
  assertStringIncludes(md, "references/lib/assessment-file.md");
  // The path is minted by the bundled script (mint), not hand-built.
  assertStringIncludes(md, "scripts/assessment-mint");
  // The INVOCATION, not the bare word: "mint" appears throughout both documents as ordinary
  // prose ("the mint", "re-minting"), so it cannot distinguish a documented command. The
  // script name plus its flag can, and now that the subcommand is gone it is the only form
  // that reads as one.
  assertStringIncludes(md, "assessment-mint <host> --title");
  assertStringIncludes(md, "assessment_path");
});

/**
 * The field cards. The skeleton the minter seeds carries a comment under every heading naming
 * that section's fields, their order and their exact values — so a writer takes the shape from
 * the file it must open anyway, instead of paying a full read of the 345-line schema reference.
 * That saving is the whole point of the design, and it survives only while three things hold:
 * the template renders the cards, the skill points writers at them, and the reference stays the
 * owner of what a field MEANS. Losing any one of them puts the mandatory read straight back.
 */
Deno.test("field cards: the skeleton renders one under every value-bearing section", async () => {
  const sh = await Deno.readTextFile(TEMPLATE_LIB);
  // Every section a writer fills carries a card. Task/Triage/Risk score already showed their
  // labels; these two showed nothing at all before the cards, and hold every enum.
  assertStringIncludes(sh, "## Threats\n<!--");
  assertStringIncludes(sh, "## Org rules\n<!--");
  assertStringIncludes(sh, "## Implementation guidance\n<!--");
  // The enumerated values live IN the card — that is what removes the reference read.
  for (
    const v of [
      "critical|high|medium|low", // Impact
      "very high|high|medium|low", // Likelihood
      "selected|excluded|undecided", // Selection, on a threat
      "selected|excluded", // Selection, on an org rule — no undecided reaches a sync
      "weak|adequate|strong", // Robustness
      "development|testing", // Latest stage
      "minor|major", // Triage verdict
    ]
  ) {
    assertStringIncludes(sh, v);
  }
  // One artifact: there is no second file to card, and no section for a deleted concept.
  for (const gone of ["## Retrieved rules", "## Per-mitigation mapping", "## Coverage"]) {
    assertEquals(
      sh.includes(gone),
      false,
      `\`${gone}\` is gone with the sidecar/coverage join — the skeleton must not seed it`,
    );
  }
  // Permanent, not scratch: finalize deletes the critique sections and keeps these, because the
  // implementing agent and the Testing pass run in later sessions with no reference in context.
  assertStringIncludes(sh.toLowerCase(), "permanent");
});

/**
 * Schema ↔ field-card parity for everything this release adds. The reference owns what a field
 * MEANS and the card is what a writer actually reads, so the repo's standing rule is that a
 * field or allowed value changed in one is changed in the other in the same edit. Nothing but a
 * check like this enforces it — and the cost of a miss is a writer producing a shape no
 * consumer accepts, discovered a session later.
 */
Deno.test("field cards: the schema additions appear in the card as well as the reference", async (t) => {
  const sh = await Deno.readTextFile(TEMPLATE_LIB);
  const ref = await Deno.readTextFile(ASSESSMENT_REF);

  await t.step("`## Task` gains Description and a seeded Schema version", () => {
    // Seeded with its value, not left blank: the version is a property of the schema, not a
    // choice the writer makes.
    assertStringIncludes(sh, "\nSchema version: 2\n");
    assertStringIncludes(sh, "\nDescription:\n");
    for (const md of [sh, ref]) assertStringIncludes(md, "Schema version");
  });

  await t.step("threat entries gain the three verification fields, in both places", () => {
    for (const field of ["Robustness justification", "Residual path", "Evidence"]) {
      assertStringIncludes(sh, field);
      assertStringIncludes(ref, field);
    }
  });

  await t.step("`## Rule adherence` is carded, with its two-valued enum", () => {
    assertStringIncludes(sh, "## Rule adherence\n<!--");
    // The enum lives IN the card — that is what removes the reference read.
    assertStringIncludes(sh, "followed|not-followed");
    assertStringIncludes(ref, "`followed`");
    // The card carries the scope rule too, since it is the part a writer gets wrong: the
    // SELECTED set, one entry each — including a rule nothing implements — and none for an
    // excluded one.
    assertStringIncludes(sh, "SELECTED at the rule gate");
    assertStringIncludes(sh, "no guidance implements");
    assertStringIncludes(sh, "gets NO entry");
  });

  await t.step("`## Org rules` is carded, with the gate decision it records", () => {
    assertStringIncludes(sh, "## Org rules\n<!--");
    // Both halves of the decision, and what each one means downstream.
    assertStringIncludes(sh, "RULE GATE");
    assertStringIncludes(sh, "adherence is judged over");
    assertStringIncludes(sh, "deemed inapplicable");
    // The finalize prune, since it is the writer-facing half a later stage depends on.
    assertStringIncludes(sh, "keeps its body");
    for (const md of [sh, ref]) assertStringIncludes(md, "verbatim");
  });

  await t.step("the anchoring rule reaches the card, not just the reference", () => {
    // Guidance naming no driver is refused by the CLI and by the platform, so a writer who
    // only ever reads the card has to learn it there.
    assertStringIncludes(sh, "AT LEAST ONE driver");
    assertStringIncludes(ref, "at least one driver");
    // ...and the multi-driver rule beside it: one entry, one set of drivers, never a copy each.
    assertStringIncludes(sh, "write it ONCE naming them all");
    assertStringIncludes(ref, "write it once");
    // The vessel carries no verdict and no gate decision — the thing this phase removed.
    assertStringIncludes(sh, "no verdict and no Selection");
  });

  await t.step("the Rule refs tightening reaches the card", () => {
    assertStringIncludes(sh, "FULL and verbatim");
    assertStringIncludes(ref, "never abbreviated, never a prefix");
  });

  await t.step("`## Affected paths` is carded, with the rules a writer gets wrong", () => {
    assertStringIncludes(sh, "## Affected paths\n<!--");
    for (const md of [sh, ref]) {
      // Folders, not files: a file path narrows to its parent and goes stale as the
      // implementation moves, which is the mistake worth naming in both places.
      assertStringIncludes(md, "backend/services/sync/");
      // A prediction, not a measurement — the reason the section exists at all,
      // since at Development there is no diff to read.
      assertStringIncludes(md.toLowerCase(), "prediction");
      // The traversal rule itself, not a bare "..": `assessment-file.md` also contains `0..N`
      // in the Implementation-guidance field table, so a two-dot match passes on a different
      // section entirely and would survive deleting this rule. The optional backticks are why
      // this is a regex — the card writes `no ../`, the reference writes ``no `../` ``.
      assertEquals(
        /no\s+`?\.\.\//.test(md),
        true,
        "the `## Affected paths` rule must forbid parent-relative traversal",
      );
    }
  });

  await t.step("an untouched skeleton declares no affected paths", () => {
    // The section is seeded with the em-dash every unwritten field uses, so a fresh
    // file states no footprint rather than one bogus entry a search would narrow to.
    const section = sh.slice(sh.indexOf("## Affected paths"));
    const body = section.slice(section.indexOf("-->") + 3, section.indexOf("## Triage"));
    assertEquals(body.trim(), "—");
  });
});

/**
 * The threat ids ARE the priority: the risk scorer re-tags the frozen list into descending-risk
 * order, so `T01` is the most dangerous threat and every display just walks the ids.
 *
 * This guard exists because the docs and the live tests already drifted apart once, in exactly
 * this spot — `assertRiskDescendsByTag` in tests/lib/matchers.ts asserted re-tagging while the
 * skill told the scorer never to renumber, so a scorer obeying its instructions failed the
 * agent test. Nothing but a static check keeps prose in sync with a live assertion.
 */
Deno.test("threat ids: the docs instruct re-tagging into risk order", async (t) => {
  const scorer = flatten(await Deno.readTextFile(SCORER_REF));
  const md = flatten(await devDoc());

  await t.step("the scorer is told to re-tag, and what the resulting order means", () => {
    assertStringIncludes(scorer, "Re-tag the list into risk order");
    assertStringIncludes(scorer, "`T01` is the most dangerous threat");
  });

  await t.step("the scorer carries no leftover prohibition on renumbering", () => {
    // The old contract's exact wording. Reintroducing it puts the scorer back in conflict
    // with tests/agents/agents.test.ts, which fails a scorer that leaves the tags alone.
    for (const stale of [/do not renumber/i, /nothing to reorder/i, /scores in place/i]) {
      assertEquals(
        stale.test(scorer),
        false,
        `ingrain-risk-scorer.md must not tell the scorer to leave ids alone (matched ${stale})`,
      );
    }
  });

  await t.step("the threat gate displays threats in id order, not by re-sorting", () => {
    assertStringIncludes(md, "**in id order — `T01` first**");
    assertEquals(
      /the ids will not be in order/i.test(md),
      false,
      "SKILL.md must not tell the reader the gate's ids are out of order — the scorer re-tagged them",
    );
  });

  await t.step("the schema and its field card both carry the rule", async () => {
    // assessment-file.md owns what the id MEANS, the card is what a writer actually reads;
    // the two must not drift (assessment-file.md -> "Where the shape lives").
    assertStringIncludes(flatten(await Deno.readTextFile(ASSESSMENT_REF)), "re-tags the list");
    assertStringIncludes(flatten(await Deno.readTextFile(TEMPLATE_LIB)), "re-tags them once");
  });
});

Deno.test("field cards: the dev docs sends writers to the card, not to the schema", async () => {
  const md = await devDoc();
  assertStringIncludes(md, "field card");
  // The dispatch is where a worker learns the contract — it must name the card, since the
  // worker has no other cheap route to the shape.
  assertStringIncludes(md, "written to the field card");
  // And the reference read is explicitly demoted to a meaning lookup. A skill that stops
  // saying this silently goes back to a full schema read per worker.
  assertStringIncludes(md, "only if you need what a field MEANS");
  // SKILL.md still names NO enum value — the card owns the shape, the reference the meaning.
  for (const v of ["very high", "weak|adequate|strong"]) {
    assertEquals(
      md.includes(v),
      false,
      `SKILL.md restates the enum "${v}". The field card carries the values; the spine points at it.`,
    );
  }
});

/**
 * The check that replaced "read it back against the schema": three named things, run on reads
 * the skill already makes (the two gate slices and finalize) rather than on a read of its own.
 * Vague wording here is what made the old instruction cost a 345-line re-read or get skipped.
 */
Deno.test("field cards: the three-check is named, bounded, and rides on existing reads", async () => {
  const md = await devDoc();
  assertStringIncludes(md, "three-check");
  assertStringIncludes(md, "never by re-reading the schema");
  // Its cadence: both gates and finalize, on reads those steps already make.
  assertStringIncludes(md, "It costs no read of its own");
  assertStringIncludes(md, "at the user gates and at finalize");
  // Both gate steps run it on the bounded slice they already read — one per driver axis.
  for (const gate of ["## Threats` slice", "## Org rules` slice"]) {
    assertStringIncludes(md, gate);
  }
});

Deno.test("assessment-file.md: owns the meaning, and stays in step with the cards", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The ownership split, stated by the owner: cards carry shape, this file carries meaning.
  assertStringIncludes(md, "field card");
  assertStringIncludes(md.toLowerCase(), "normative");
  // Three copies of the shape now exist, so the reference carries the anti-drift rule and
  // names the renderer. Without this the card and the schema part ways on the next edit.
  assertStringIncludes(md, "scripts/lib/artifact-template.sh");
  assertStringIncludes(md, "in the same edit");
});

Deno.test("assessment-file.md: owns the living-document behavior", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The file is written/updated as a living document — stated by its owner, not by SKILL.md.
  assertStringIncludes(md.toLowerCase(), "living document");
});

Deno.test("assessment-file.md: defines the strict on-disk format and its allowed values", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  // The single in-repo artifact path.
  assertStringIncludes(md, ".ingrain-security/assessment-<branch-slug>-<task-slug>.md");
  // Enumerated fields carry their exact allowed values.
  assertStringIncludes(md, "very high"); // likelihood
  for (const v of ["selected", "excluded", "undecided"]) {
    assertStringIncludes(md, v); // selection status
  }
  // Key constraints from the format are stated.
  assertStringIncludes(md, "256"); // justification max length
  assertStringIncludes(md, "3–6"); // threat count: soft target, not a hard limit
  // The path is obtained from the bundled path-minting script.
  assertStringIncludes(md, "scripts/assessment-mint");
});

Deno.test("SKILL.md + assessment-file.md: the assessment file name is keyed by branch + task", async () => {
  const skill = await Deno.readTextFile(SKILL);
  const ref = await Deno.readTextFile(ASSESSMENT_REF);
  // Deterministic branch+task name (no timestamp) in both the skill and its schema ref.
  const NAME = ".ingrain-security/assessment-<branch-slug>-<task-slug>.md";
  assertStringIncludes(skill, NAME);
  assertStringIncludes(ref, "assessment-<branch-slug>-<task-slug>.md");
  // How the name is DERIVED belongs to the schema reference, not the spine: branch resolved
  // with git (not the unreliable .git/HEAD read), and the unknown-branch fallback that keeps
  // the task-only name.
  assertStringIncludes(ref, "git branch --show-current");
  assertStringIncludes(ref, "assessment-<task-slug>.md");
});

/**
 * The ownership rule: SKILL.md owns SEQUENCE and ROUTING; the reference files own DETAIL. A
 * fact lives in exactly one file — the one that acts on it — and SKILL.md reaches it with a
 * pointer, never a restatement. Every string fenced below once appeared in BOTH SKILL.md and
 * its owner; the duplication silently grows back on each edit unless something fails.
 */
Deno.test("ownership: SKILL.md does not restate what assessment-file.md owns", async () => {
  const skill = (await Deno.readTextFile(SKILL)).toLowerCase();
  // Path derivation and lifecycle are the schema reference's; the spine points at it.
  for (
    const fact of ["git branch --show-current", "living document", "assessment-<task-slug>.md"]
  ) {
    assertEquals(
      skill.includes(fact),
      false,
      `SKILL.md restates "${fact}", which references/lib/assessment-file.md owns. ` +
        `Point at the reference instead of restating it.`,
    );
  }
});

Deno.test("ownership: dispatch.md § Selection windows stays mechanism-only", async () => {
  const md = await Deno.readTextFile(DISPATCH_REF);
  // The gate PROCEDURE (display the table first, then ask) is flow.md's — Development is the
  // only phase that gates — and this file maps the host MECHANISM only, pointing back rather
  // than restating the procedure.
  // Flattened: the file is hand-wrapped, so pinning a phrase raw ties the assertion to where
  // the line happens to break — which is exactly how this one failed after a reword.
  assertStringIncludes(md.replace(/\s+/g, " "), "lives in `flow.md`");
  // The mechanism itself must still be here — this is what the phase files defer TO.
  assertStringIncludes(md.toLowerCase(), "one window per finding");
  assertStringIncludes(md.toLowerCase(), "fallback");
});

Deno.test("step 0: instructs a prior-analysis lookup that seeds the generator", async () => {
  // This lookup was the triage WORKER's until the worker was replaced by a question the
  // orchestrator asks directly. The classification left with the worker; the lookup did not,
  // and it is the half a merge silently drops — the generator's seeding is its only consumer,
  // and a generator that simply starts fresh looks exactly like one that found nothing.
  const skill = await devDoc();
  assertStringIncludes(skill, "Find the prior analysis first");
  assertStringIncludes(skill, "Do not glob the folder");
  assertStringIncludes(skill, "**`siblings`** list");
  // The never-glob rule has been re-invented twice by files that re-derive this lookup, so
  // pin the absence: a glob here returns THIS run's own file — the mint seeded it moments
  // earlier — so it would report the analysis about to be overwritten as prior work.
  assertEquals(
    /Glob the assessment folder|assessment-<branch-slug>-\*\.md/.test(skill),
    false,
    "step 0 must take the candidate list, not glob — the mint already did this lookup",
  );
  // It compares branch + title and emits a Prior analysis pointer, which Step 1a forwards.
  assertStringIncludes(skill, "Prior analysis");
  assertStringIncludes(skill, "Prior analysis pointer");
  // The schema carries the optional Prior analysis field.
  assertStringIncludes(await Deno.readTextFile(ASSESSMENT_REF), "Prior analysis");
});

Deno.test("step 0: the review question is the user's, asked with a recommended default", async () => {
  const skill = await devDoc();
  // The question replaces a classifier, so the two things the classifier guaranteed have to
  // survive in it: a default that leans to reviewing, and an answer legible as the record.
  assertStringIncludes(skill, "Run a security review for this change?");
  // BOTH options state what the answer MEANS. A `no` is written as `Verdict: minor` and syncs
  // as "assessed, found not security-relevant" — so an option reading "skip for now" would
  // record a claim the user never made.
  assertStringIncludes(skill, "Yes — it touches a security surface");
  assertStringIncludes(skill, "No — this change is not security-relevant");
  // The asymmetry the whole skill rests on: a needless review is cheap, a missed concern is not.
  assertStringIncludes(skill, "Borderline recommends `Yes`");
  // And the non-interactive fallback goes the same way, for the same reason.
  assertStringIncludes(skill, "No window mechanism reachable");
});

Deno.test("the relevance-triage worker is gone from every surface", async () => {
  // A deleted worker leaves three kinds of wreckage: a dispatch nobody can satisfy, a roster
  // entry pointing at a missing file, and prose describing a step that no longer runs. The
  // reference-file lint catches the second only; this catches the other two.
  for await (const entry of walk(`${ROOT}skills/ingrain-security`, { exts: [".md", ".sh"] })) {
    if (!entry.isFile) continue;
    const text = await Deno.readTextFile(entry.path);
    assertEquals(
      /ingrain-relevance-triage|triage worker/.test(text),
      false,
      `${entry.path} still names the removed relevance-triage worker`,
    );
  }
});

Deno.test("SKILL.md: documents the pointer-based hand-off and context-window discipline", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Workers hand off via pointers, not by pasting full content.
  assertStringIncludes(md.toLowerCase(), "pointer");
  // The orchestrator's reads of the analysis are bounded to the gates and finalize.
  assertStringIncludes(md.toLowerCase(), "context-window discipline");
  assertStringIncludes(md.toLowerCase(), "bounded slice of the assessment file");
});

Deno.test("SKILL.md: folds the assessment link + maintenance instruction into the plan", async () => {
  const md = await devDoc();
  // A maintenance instruction is aimed at the downstream implementing agent.
  assertStringIncludes(md, "Maintenance");
  assertStringIncludes(md, "implementing agent");
  // The file is meant to stay in sync as implementation evolves.
  assertStringIncludes(md.toLowerCase(), "in sync");
});

Deno.test("dispatch.md: covers the subagent primitive and the fallback", async () => {
  const md = await Deno.readTextFile(DISPATCH_REF);
  assertStringIncludes(md.toLowerCase(), "task primitive");
  assertStringIncludes(md.toLowerCase(), "fallback");
});

Deno.test("ingrain-cli.md: documents the ingrain rule-retrieval CLI", async () => {
  const ref = `${ROOT}skills/ingrain-security/references/lib/ingrain-cli.md`;
  const md = await Deno.readTextFile(ref);
  // The probe, the retrieval command, and its output shape.
  assertStringIncludes(md, "ingrain --version");
  assertStringIncludes(md, "ingrain context security_rules");
  assertStringIncludes(md, '{ "id"');
  // The pre-rename `decisions` spelling is no longer supported anywhere.
  assertEquals(md.includes("ingrain context decisions"), false);
});

/**
 * Path-scoped retrieval hangs off ONE instruction, and this is the only thing
 * holding it up.
 *
 * The CLI reads `## Affected paths` and narrows the search to it, but only when the
 * caller passes `--assessment`. Every layer below that line is pinned by executable
 * tests — the CLI's own suite, the wire-transport test, and a backend e2e that
 * shells out to the real binary. None of them can catch this one: the e2e supplies
 * the flag itself, so deleting the instruction here leaves every suite green while
 * every real retrieval silently reverts to an org-wide search.
 *
 * That is the exact failure this feature was built to fix — a capability that
 * exists on both sides and is reachable from nothing — relocated one layer up into
 * the half that is prose rather than code.
 */
/**
 * A section slice bounded by two markers, both of which must EXIST.
 *
 * `String.slice` reads a `-1` from a missing marker as `length - 1`, so an unguarded
 * `slice(indexOf(a), indexOf(b))` silently widens to the whole document when `b` is reworded —
 * and a whole-document match is exactly what these assertions were written to rule out. Failing
 * loudly on a reworded marker is the point: the marker moved, so the test must be re-aimed.
 */
const between = (md: string, start: string, end: string): string => {
  const from = md.indexOf(start);
  const to = md.indexOf(end);
  assertEquals(from !== -1, true, `slice start marker not found — re-aim the test: ${start}`);
  assertEquals(to !== -1, true, `slice end marker not found — re-aim the test: ${end}`);
  return md.slice(from, to);
};

Deno.test("the retrieval instruction passes --assessment, so the search is actually scoped", async (t) => {
  const cliRef = await Deno.readTextFile(
    `${ROOT}skills/ingrain-security/references/lib/ingrain-cli.md`,
  );
  const skill = await devDoc();

  await t.step("the reference's retrieval invocation carries the flag", () => {
    assertStringIncludes(cliRef, 'ingrain context security_rules "<query>" --assessment');
    // Why it matters, not just that it exists — a writer who understands the flag
    // is the one who keeps passing it when the surrounding prose is reworked.
    assertStringIncludes(cliRef, "## Affected paths");
  });

  await t.step("SKILL.md's retrieval step tells the orchestrator to pass it", () => {
    // Scoped to the step that actually runs the search: `record` and `validate`
    // take `--assessment` too, so a repo-wide match would pass on their mentions
    // alone and prove nothing about retrieval.
    const retrieval = between(
      skill,
      "**1b — Retrieve the org rules",
      "2. **Critique both chains**",
    );
    assertStringIncludes(retrieval, "--assessment");
  });

  await t.step("the orchestrator is told to write the section before it retrieves", () => {
    // Ordering is load-bearing: the section is written at Development Step 0 and
    // read at the retrieval. Reversed, every query would scope against an unwritten
    // section and degrade to org-wide without anything reporting it.
    // assertOrder throws on a missing pattern; a bare `indexOf < indexOf` would read a renamed
    // heading's -1 as "earlier than everything" and pass silently.
    assertOrder(
      skill,
      "## Affected paths",
      "**1b — Retrieve the org rules",
      "`## Affected paths` must be written before the retrieval step reads it",
    );
  });

  await t.step("retrieval keys on the plan and the footprint, never on gate selections", () => {
    // The whole reason it can run in PARALLEL with the threat chain. Keyed on a gate
    // it would have to wait for one, which is the sequence this phase removed.
    const retrieval = between(
      skill,
      "**1b — Retrieve the org rules",
      "2. **Critique both chains**",
    );
    // Flattened: the doc is hand-wrapped, so matching raw text would tie this to line breaks.
    assertStringIncludes(flatten(retrieval), "never on gate selections");
    assertStringIncludes(retrieval, "wide net");
  });
});

Deno.test("SKILL.md: the orchestrator's own step retrieves rules", async () => {
  const md = await Deno.readTextFile(DEV_FLOW);
  // Retrieval is the orchestrator's own pass, run in session — not a dispatch. It runs in
  // parallel with the threat chain and blocks the guidance step, which is the join. What it
  // keys on is asserted above; here we only pin that it points at the CLI reference rather
  // than restating the command.
  assertStringIncludes(md, "references/lib/ingrain-cli.md");
});

// The assessment file must be written to the ABSOLUTE `assessment_abs`. A relative path
// is resolved by whoever receives it, and a worker subagent has no project root in view —
// it resolves against the file it was reading and creates a stray .ingrain-security/ folder
// there. These fence the wording so a later doc edit cannot quietly reintroduce that.

Deno.test("dev docs: dispatches workers with the absolute assessment_abs", async () => {
  const md = await devDoc();
  assertStringIncludes(md, "assessment_abs");
  // The worker dispatch template must not hand out the relative path as a write target.
  assertStringIncludes(md, "<the minted assessment_abs — the ABSOLUTE path, pasted in full>");
});

Deno.test("session-start: points the orchestrator at assessment_abs", async () => {
  const hook = await Deno.readTextFile(SESSION_START);
  assertStringIncludes(hook, "assessment_abs");
});

Deno.test("session-start: injects the branch-delta runner Phase select routes on", async () => {
  const hook = await Deno.readTextFile(SESSION_START);
  // Both prose files promise the ready-to-run command arrives in SessionStart context. Without
  // the runner the orchestrator hand-rolls a merge-base loop, which is the drift this replaces.
  assertStringIncludes(hook, "scripts/branch-delta");
  // Built AND interpolated: a runner that is assembled but never reaches the context block is
  // the failure this pair catches, and one assertion alone would miss it in either direction.
  assertStringIncludes(hook, "diff_runner=");
  assertStringIncludes(hook, "${diff_runner}");
  // The routing signal itself has to reach the agent, not just the command.
  assertStringIncludes(hook, "delta_empty");
});

Deno.test("assessment-mint: emits an instruction and anchors on the git repo root", async () => {
  const script = await Deno.readTextFile(PATH_SCRIPT);
  // The script COMPOSES the flat libs — that is its job — and mint.sh holds only the pure
  // helpers (slugify, count_selected_in_section, resolve_phase) it chains.
  assertStringIncludes(script, "lib/project-root.sh");
  assertStringIncludes(script, "lib/mint.sh");
  assertStringIncludes(script, 'emit_mint_facts "${host}" assessment');
  // The JSON lives in the script: composing five flat libs is the script's job, and the
  // emit is the last step of that composition.
  assertStringIncludes(script, '"instruction":"%s"');
  // The label-parameterized JSON keeps the assessment field names byte-identical.
  assertStringIncludes(script, '"%s_abs":"%s"');
  // Root resolution lives in project-root.sh; the anchoring is covered end-to-end by the
  // "run from a subdirectory" cases in tests/hooks/assessment-mint.test.ts.
  assertStringIncludes(await Deno.readTextFile(PROJECT_ROOT_LIB), "rev-parse --show-toplevel");
});

/**
 * True when `script` really SOURCES `lib` — a `.` command line, in either style the scripts
 * use (`. "${SCRIPT_DIR}/…"` and `if ! . "${SCRIPT_DIR}/…"`).
 *
 * A plain substring search cannot answer this: every source line is preceded by a
 * `# shellcheck source=…/lib/project-root.sh` directive carrying the same text, so a script
 * that DELETED its source line and kept the comment would still pass one. The regression these
 * guards exist to catch would walk straight through.
 */
async function sourcesLib(script: string, lib: string): Promise<boolean> {
  const source = new RegExp(String.raw`^(?:if !\s+)?\.\s+\S*lib/${lib}\.sh`, "m");
  return source.test(await Deno.readTextFile(script));
}

Deno.test("project-root.sh: is sourced by every script that resolves the project root", async () => {
  // The lib exists to keep every one of these in lockstep — a copy drifting back into any of
  // them is the regression this guards. Both hosts' allow-hooks are in the list: they resolve
  // the project root exactly like the scripts do.
  for (const script of [PATH_SCRIPT, ENSURE_DIR, ALLOW_HOOK, CODEX_ALLOW_HOOK]) {
    assertEquals(await sourcesLib(script, "project-root"), true, `${script} must source the lib`);
  }
});

Deno.test("assessment-write.sh: is sourced by both allow-hooks", async () => {
  // The grant itself — the assessment naming and the folder containment check — lives in this
  // one lib so the two hosts cannot drift apart on what they auto-approve. A hook that inlined
  // its own check would pass every other test in this file.
  for (const hook of [ALLOW_HOOK, CODEX_ALLOW_HOOK]) {
    assertEquals(await sourcesLib(hook, "assessment-write"), true, `${hook} must source the lib`);
  }
});

Deno.test("assessment-file.md: names assessment_abs as the write target", async () => {
  const md = await Deno.readTextFile(ASSESSMENT_REF);
  assertStringIncludes(md, "assessment_abs");
});

Deno.test("hook.json: valid JSON configuring a SessionStart hook", async () => {
  const hook = JSON.parse(await Deno.readTextFile(HOOK_JSON));
  const serialized = JSON.stringify(hook);
  assertStringIncludes(serialized, "SessionStart");
});

Deno.test("hook.json: both platforms fire SessionStart on the same four sources", async () => {
  // Claude's matcher was `startup|clear|compact` while Codex's carried `resume` too, so a
  // RESUMED Claude session got no INGRAIN-ASSESSMENT-PATHS block — and everything downstream
  // is keyed on it: the mint command, the plugin root, and the Maintenance instruction the
  // skill writes into every plan file ("re-run the assessment-mint command from your
  // INGRAIN-ASSESSMENT-PATHS session context"). No fallback existed. Asserted as a SET so a
  // future divergence fails on whichever side drifts, rather than only on the one spelled here.
  const sources = async (path: string): Promise<string[]> => {
    const hook = JSON.parse(await Deno.readTextFile(path));
    return String(hook.hooks.SessionStart[0].matcher).split("|").sort();
  };
  const expected = ["clear", "compact", "resume", "startup"];
  assertEquals(await sources(HOOK_JSON), expected);
  assertEquals(await sources(CODEX_HOOK_JSON), expected);
});

Deno.test("hook.json: both platforms pass their host token to session-start", async () => {
  // session-start needs the host so it can inject a host-correct assessment-mint command.
  const claude = JSON.stringify(JSON.parse(await Deno.readTextFile(HOOK_JSON)));
  const codex = JSON.stringify(JSON.parse(await Deno.readTextFile(CODEX_HOOK_JSON)));
  assertStringIncludes(claude, "scripts/session-start claude");
  assertStringIncludes(codex, "scripts/session-start codex");
  // The assessment-folder hook keeps passing its host token too.
  assertStringIncludes(claude, "scripts/ensure-assessment-dir claude");
  assertStringIncludes(codex, "scripts/ensure-assessment-dir codex");
});

Deno.test("hook.json: Claude registers the PreToolUse auto-approve hook", async () => {
  // Without this registration the assessment file prompts on every write, which is the
  // whole reason the hook exists — and nothing else in the suite would notice.
  const hook = JSON.parse(await Deno.readTextFile(HOOK_JSON));
  const pre = hook.hooks?.PreToolUse;
  assertEquals(Array.isArray(pre), true, "PreToolUse must be registered");
  const serialized = JSON.stringify(pre);
  assertStringIncludes(serialized, "claude/allow-assessment-write");
  // The matcher must cover every file-editing tool the hook itself accepts.
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    assertStringIncludes(serialized, tool);
  }
});

Deno.test("hook.json: Codex registers the PermissionRequest auto-approve hook", async () => {
  // Codex's prompt-skipping event is PermissionRequest, not PreToolUse — registering the
  // hook anywhere else would leave the assessment file prompting on every write.
  const hook = JSON.parse(await Deno.readTextFile(CODEX_HOOK_JSON));
  const request = hook.hooks?.PermissionRequest;
  assertEquals(Array.isArray(request), true, "PermissionRequest must be registered");
  const serialized = JSON.stringify(request);
  assertStringIncludes(serialized, "codex/allow-assessment-write");
  // The matcher must cover every tool name the hook itself accepts. Codex reports
  // `apply_patch`; Edit and Write are its documented aliases for the same tool.
  for (const tool of ["apply_patch", "Edit", "Write"]) {
    assertStringIncludes(serialized, tool);
  }
});

Deno.test("allow-assessment-write: both hooks only ever allow, never deny", async () => {
  // The hooks' core safety property, asserted on the sources themselves: they can remove a
  // permission prompt but must never introduce a block. A "deny" verdict appearing here
  // would mean the plugin can silently veto a user's edit.
  const claude = await Deno.readTextFile(ALLOW_HOOK);
  assertStringIncludes(claude, '"permissionDecision":"allow"');
  assertEquals(claude.includes('"permissionDecision":"deny"'), false);

  const codex = await Deno.readTextFile(CODEX_ALLOW_HOOK);
  assertStringIncludes(codex, '"behavior":"allow"');
  assertEquals(codex.includes('"behavior":"deny"'), false);
  // Only additive patch verbs are approved: a delete or a move is outside the grant.
  assertEquals(codex.includes("Delete File: "), false);

  // Both hosts get their grant from the same shared test, so they cannot drift apart on it:
  // the minter's naming, directly inside the assessment folder.
  const lib = await Deno.readTextFile(ALLOW_LIB);
  assertStringIncludes(lib, "assessment*.md");
  assertStringIncludes(lib, "/.ingrain-security");
});

/**
 * Three Part I properties that were specified in prose but pinned by nothing — each was
 * measured to survive a spec-breaking mutation with the suite green. All three are bold
 * literals in SKILL.md already, so they are pinnable in the offline tier rather than in
 * the INTEGRATION tier that never gates a merge.
 */
Deno.test("SKILL.md: the two driver axes run in parallel, not in sequence", async () => {
  const md = await devDoc();
  // Retrieval running AFTER the threat gate is the pre-decision-12 shape: it made rules
  // downstream of threats, which is what forced the "general implementation instruction"
  // category into existence. The flow, the checklist and the overview must all say parallel.
  const flow = flatten(section(md, "## Development — the flow"));
  assertStringIncludes(flow, "Fork the two driver chains");
  assertStringIncludes(flow, "nothing orders them");
  // The sharpest anchor, because it names the shape being prevented rather than the one
  // being kept: retrieval placed after a gate kills this phrase, and no rewording of the
  // parallelism survives it either.
  assertStringIncludes(flow, "rather than after a gate");
  assertStringIncludes(flatten(section(md, "## Development — checklist")), "forked with 1a");
});

Deno.test("SKILL.md: both gates are one user moment, and the rule gate offers accept-all first", async () => {
  const md = await devDoc();
  const flat = flatten(md);
  // One moment: two gates split across two turns is two interruptions for one decision
  // point, and it is what the "presented together" wording exists to prevent.
  assertStringIncludes(flat, "one user moment");
  // Accept-all is what makes the machine prune sound — the user vouches for a curated set
  // in one choice. Without it the rule gate costs one window per retrieved rule, and
  // decision 12's whole justification for pruning-before-presenting collapses.
  assertStringIncludes(flat, "accept-all first");
  assertOrder(
    flatten(section(md, "## Development — the flow")),
    "Offer accept-all first",
    "per-rule windows",
    "accept-all precedes the per-rule windows",
  );
});

Deno.test("SKILL.md: the Testing route is an OR across the two axes", async () => {
  const md = await Deno.readTextFile(SKILL);
  // Decision 12 re-keyed this from "1+ selected threats" to "threats OR rules". Reverting it
  // strands a rules-only review — the analysis syncs, the code gets written, and Testing
  // never runs because no threat was selected (audit finding B2).
  const phaseSelect = flatten(section(md, "## Phase select — do this FIRST"));
  // The OR is now a SUM over the two per-axis counts, resolved inside the mint. Same
  // semantics; what SKILL.md still has to carry is that BOTH axes feed it, since a router
  // keying on threats alone strands a rules-only review (audit B2) and nothing here would
  // notice — the phase field would simply be wrong.
  assertStringIncludes(phaseSelect, "SUMMED, never weighed separately");
  assertStringIncludes(phaseSelect, "alone sustains a verification");
  // Both counts must be DECLARED, not merely named in passing: Phase select's field list is
  // where the orchestrator learns what it holds, and a signal explained only inside another
  // field's paragraph is one it has no reason to carry.
  assertStringIncludes(phaseSelect, "- **`selected_threats` / `selected_rules`**");
});

/**
 * Phase blocks — the `#### <name>` regions that carry stage ownership inside a threat entry.
 *
 * Three copies of that mapping now exist: the schema's block table (meaning), the seeded
 * field card (shape, and the only one a writer actually reads), and the four writer
 * references (each naming the block it fills). The repo's standing parity rule covers the
 * first two for *fields*; these extend it to *which block a field sits in*, because that is
 * the half a stage acts on. A field that drifts into the wrong block is not a cosmetic
 * error: the stage that owns the block it moved to will overwrite it, and the stage that
 * should have written it will read an empty block as "my stage has not run".
 */
const THREAT_BLOCKS = ["gen", "score", "usergate", "test"] as const;

/** The schema's block table, as `[block, [field, …]]` in document order. */
const blockTable = (ref: string): Array<[string, string[]]> =>
  [...ref.matchAll(/^\| `#### (\w+)` \| [^|]+ \| ([^|]+) \|$/gm)]
    .map((row) => [row[1], row[2].split(",").map((field) => field.trim())]);

Deno.test("phase blocks: the card and the schema agree on which block each field sits in", async (t) => {
  const sh = await Deno.readTextFile(TEMPLATE_LIB);
  const ref = await Deno.readTextFile(ASSESSMENT_REF);
  const table = blockTable(ref);

  await t.step("the schema names the four blocks, in the order the stages run", () => {
    // Cardinality first: a reworded table that stops matching would otherwise empty the
    // loops below and let every assertion in this test pass while proving nothing.
    assertEquals(table.map(([block]) => block), [...THREAT_BLOCKS]);
  });

  // The card's block enumeration, sliced per block. Bounded at the prose that follows it
  // so a field named in the ownership paragraph cannot be mistaken for a card entry.
  const card = between(sh, "#### gen", "THE BLOCK IS THE OWNERSHIP RECORD");
  const regions = THREAT_BLOCKS.map((block, nth) => {
    const from = card.indexOf(`#### ${block}`);
    const next = THREAT_BLOCKS[nth + 1];
    const to = next === undefined ? card.length : card.indexOf(`#### ${next}`);
    assertEquals(from !== -1, true, `the card does not enumerate \`#### ${block}\``);
    return card.slice(from, to);
  });

  /**
   * A field as the card ENTERS it — the label followed by its value spec, its separating
   * comma, or the end of a line.
   *
   * A bare substring search cannot do this job. The card's `#### test` region explains
   * that `Robustness justification` is deliberately not called `Justification` — "NOT the
   * risk-scoring Justification above" — so a plain `includes` reads the `score` block's
   * field as living in `test` too. That cross-reference is the whole reason the two
   * rationales stopped being interleaved, so the matcher bends around it rather than the
   * card losing it.
   */
  const declares = (region: string, field: string): boolean =>
    new RegExp(String.raw`\b${field}\s*(\(|,|$)`, "m").test(region);

  await t.step(
    "every field the schema assigns to a block appears in that block's card region",
    () => {
      for (const [block, fields] of table) {
        const region = regions[THREAT_BLOCKS.indexOf(block as typeof THREAT_BLOCKS[number])];
        for (const field of fields) {
          assertEquals(
            declares(region, field),
            true,
            `the card's \`#### ${block}\` region does not name \`${field}\`, which the schema ` +
              `assigns to it — the two must change in the same edit`,
          );
        }
      }
    },
  );

  await t.step("and appears in exactly one region, so no field has two owners", () => {
    for (const [, fields] of table) {
      for (const field of fields) {
        // The case this catches silently loses data: a field that drifted into a second
        // block is rewritten by whichever stage owns that block, and the stage that should
        // have written it reads an empty region as "my stage has not run".
        const owners = regions.filter((region) => declares(region, field)).length;
        assertEquals(owners, 1, `\`${field}\` is declared in ${owners} card regions, expected 1`);
      }
    }
  });
});

Deno.test("phase blocks: only `## Threats` has them, and the rule says why", async () => {
  const sh = await Deno.readTextFile(TEMPLATE_LIB);
  const ref = await Deno.readTextFile(ASSESSMENT_REF);

  // The narrowing this phase settled. A block records which of SEVERAL writers owns a
  // field, and `## Threats` is the one entry written by more than one — so marking any
  // other section would be claiming a shared ownership that does not exist. Asserted as
  // the RULE rather than as an exemption list, because a list is what drifts: the reason
  // survives a new section being added, a list does not.
  assertStringIncludes(ref, "written by more than one **writer**");

  // No other card seeds a marker. Sliced from the `## Threats` card's end so the
  // enumeration inside it is not what this matches.
  const otherCards = sh.slice(sh.indexOf("## Risk score"));
  assertEquals(
    /^\s*#### /m.test(otherCards),
    false,
    "a section after `## Threats` seeds a `####` marker — only `## Threats` carries blocks",
  );
});

Deno.test("phase blocks: each writer names the block it fills, and the seeding rules survive", async (t) => {
  const generator = await Deno.readTextFile(
    `${ROOT}skills/ingrain-security/references/development/ingrain-threat-generator.md`,
  );
  const scorer = await Deno.readTextFile(SCORER_REF);
  const verification = await Deno.readTextFile(
    `${ROOT}skills/ingrain-security/references/testing/verification-pass.md`,
  );
  const flow = await Deno.readTextFile(DEV_FLOW);

  await t.step("each of the four stages names its own block", () => {
    // Deliberately NOT "names exactly one block": the risk scorer legitimately names all
    // four, because re-tagging moves entries and it is the one writer that rewrites them
    // whole — so it has to be told to carry the other three across verbatim. Asserting
    // exclusivity here would have failed on the correct instruction.
    assertStringIncludes(generator, "#### gen");
    assertStringIncludes(scorer, "#### score");
    assertStringIncludes(flow, "#### usergate");
    assertStringIncludes(verification, "#### test");
  });

  await t.step("the generator seeds all four markers and fills only its own", () => {
    // Seeding is what makes every later stage's write a replacement rather than an
    // append, and it is the generator's alone: no other stage creates the entry.
    assertStringIncludes(generator, "you seed all four");
    assertStringIncludes(flatten(generator), "fill only `#### gen`");
  });

  await t.step("no stage seeds `—` into a block it does not own", () => {
    // The load-bearing rule. An empty block IS the signal that its stage has not run, so
    // a placeholder makes an unrun stage indistinguishable from one that ran and had
    // nothing to say — which is how a half-finished review starts reading as complete.
    assertStringIncludes(flatten(generator), "no `—` placeholders");
    assertStringIncludes(flatten(verification), "no `—` placeholders in it");
  });

  await t.step("the scorer is told to carry the blocks it does not own across whole", () => {
    // The one writer that rewrites entries wholesale. Without this clause the block rule
    // and its contract contradict each other, and the resolution it would reach on its
    // own — write only your block — cannot re-tag at all.
    assertStringIncludes(flatten(scorer), "VERBATIM AND WHOLE");
  });

  await t.step("the missing-marker fallback is stated where a writer will meet it", async () => {
    // The writer-side half of tolerance: the parse tests prove a marker-less file is
    // READ correctly, and nothing but this tells a writer what to DO with one.
    const sh = await Deno.readTextFile(TEMPLATE_LIB);
    assertStringIncludes(sh, "Missing marker? Append your fields at the end of the entry.");
  });
});

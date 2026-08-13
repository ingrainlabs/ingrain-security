# Development — the plan review: threats, org rules and implementation guidance

Development's procedure, and the machinery only this phase uses — the worker dispatch shape and
the two user gates.

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate seven worker roles, each defined by a reference file at
`references/development/<name>.md` (`ingrain-relevance-triage`, `ingrain-threat-generator`,
`ingrain-threat-critic`, `ingrain-risk-scorer`, `ingrain-rule-critic`,
`ingrain-guidance-generator`, `ingrain-guidance-critic`). You dispatch each as a fresh subagent,
holding the state between steps yourself. One step is yours alone: the broad org-rule retrieval,
**forked alongside the threat chain rather than after a gate** — Step 1 states exactly what that
overlap is and is not.

This phase produces exactly **two things**: the **assessment file** (the hand-off medium the
workers write section by section, and you finalize) and the modifications to the active **plan** (formal or ad-hoc), carrying the selected threats, the accepted org rules and **all** critiqued guidance.

## How to dispatch a worker

**The prompt is this file's; the mechanism is `dispatch.md`'s.** It owns the subagent primitive
and the in-context fallback, the write rules, the model tier, and the permission gate to open when
a session rule holds subagent dispatch behind the user's request — **ask before your first
dispatch**, which here is Step 0's triage.
→ `references/lib/dispatch.md`, and its § When a session rule gates subagents behind user request.

Dispatch every worker with the same shape. The write target is restated inline because that path
is per-run and the worker has no other way to learn it:

```
Read <plugin_root>/skills/ingrain-security/references/development/<name>.md — the ABSOLUTE
path, with plugin_root from the mint JSON pasted in full — and follow it as your system prompt.
Your ONE permitted write is your own section of the stored analysis file for this run at
<the minted assessment_abs — the ABSOLUTE path, pasted in full> (section: <## Section for this worker>),
written to the field card that file already carries under your section: one field per line,
in the order it lists, with its exact values; a field your stage does not own reads —.
Write that section in ONE call — a single Write or Edit carrying every entry. Where you are
filling fields into entries that already exist, it is one Edit per ENTRY, replacing that
entry's contiguous block of field lines; never one Edit per field.
The card is the write contract — read
<plugin_root>/skills/ingrain-security/references/lib/assessment-file.md
only if you need what a field MEANS.
Write to that exact absolute path, character for character as pasted
above — it is already resolved against the repo root, whose .ingrain-security/ folder
already exists.
Scope tightly: include exactly the findings that would change how this specific
change is reviewed or implemented.
INPUT:
<the finished, detailed implementation plan; plus POINTERS to the sections this
worker must read — e.g. "read <the run's assessment file> § Threats and
§ Threat critique" — on the revision round, the pointer to the prior draft's section +
the critic's itemized feedback>
Write your full Output into your section of the assessment file, then RETURN ONLY:
your branch keyword — the exact set YOUR reference file's hand-off contract names
(minor/major/unclear for triage, approved/needs-revision for a critic) — or headline result, plus
a one-line pointer to the section you wrote, which carries the full output.
```

Branch on the keyword the worker leads its return with (`minor`/`major`/`unclear`,
`approved`/`needs-revision`), and pass the **next** worker a pointer to the sections it must read.

## How to ask the user

The **threat gate** and the **rule gate** are per-driver selection gates — the user includes or
excludes each driver individually and may select any subset, **including none**. They are named by
what they decide, never by ordinal position, and they are presented in **one user moment**: the
threat table and its windows, then the rule table and its windows. **Each gate** is presented in
**two distinct steps, in this order** — table first, then windows. The two gates are not the two
steps; splitting them across turns is what "the same message" below forbids:

1. **Display the findings as a Markdown table** — one row per finding, columns per the gate step.
   The table is where the detail lives, so the user compares every finding in one place before
   deciding. **Mandatory in every mode and on every host** — plan mode, ad-hoc, windowed or
   fallback alike. Printing it is a read-only display action, permitted in every mode.
2. **Then present the selection windows** — one single-choice include/exclude window per finding,
   labeled by id + short title (e.g. `T01 — unauthenticated token refresh`). One window, one
   finding, one binary choice keeps every decision isolated. Mark high/critical findings
   recommended; because each window is its own decision, **selecting none is always reachable**.
   The **rule gate offers accept-all first** — see its step — so the default weigh-in costs one
   choice and the per-rule windows are there for the remaining misses.
   → `references/lib/dispatch.md` § Selection windows for the host mechanism and the
   batching rule where a host caps how many windows it can show at once.

## Context-window discipline — the one carve-out

`SKILL.md` sets the rule both phases follow: hold compact statuses and pointers, never payloads.
**The retrieval pass is this phase's single exception**, and it is Development's alone — Testing
reads `## Org rules` off the file rather than fetching anything. The CLI's rule bodies land in
your context because you are the one writing them into that section. Write them straight through,
then carry the **section pointer** and let every later reader open it for itself.

## Development — the flow

Each step is one dispatch; you hold the state between them. The tracker is **Development —
checklist** at the end of this file.

0. **Triage** — dispatch `ingrain-relevance-triage` with the plan, the resolved `branch_slug` (or
   `unknown`), the task title, and the mint's **`siblings`** list as absolute paths (prefix each
   with `<project_root>/.ingrain-security/`). That list is the prior-analysis lookup, already
   done: hand it over rather than letting the worker glob, which would return this run's own
   file and report the analysis about to be overwritten as prior work.
   → `references/development/ingrain-relevance-triage.md` defines it; you branch on its keyword.
   - `unclear` → **the plan did not tell the worker what the change does. Ask the user.** It is the
     one verdict a worker may decline to give, and it is handed to the user rather than resolved by
     you: they know what the change is, where the plan text does not say. State in one line what
     could not be established, then present **one single-choice window** — run the full review
     (**recommended**) or treat it as minor and stop. Then **write their answer into `## Triage`
     yourself**: `Verdict: major` + `Security relevant: true`, or `Verdict: minor` +
     `Security relevant: false`, and follow that branch below. The user's answer *is* the verdict,
     which is why the field's values stay two. **No answer reachable** — no window mechanism, a
     non-interactive run — take `major`: the asymmetry that makes it the worker's tie-break makes
     it the fallback here.
     → `references/lib/dispatch.md` § Selection windows for the host mechanism.
   - `minor` → **record it, then stop.** Open the assessment at `assessment_abs` and write
     `## Task` → `Description` (one line on what this change does) beside the worker's
     `## Triage`; the file is otherwise left as seeded. Then sync it — best-effort, exactly like
     the Development finalize: `ingrain record design --assessment "<assessment_abs>"`.
     Then state "no security review needed — minor change" and **STOP**; triage is the whole
     pipeline for a minor change, so carry on building the plan.

     **Why a `minor` still records.** "We assessed this and it is not security-relevant" is a
     result the platform stores in its own right, and it is the only way a reviewer can tell an
     assessed change from an unreviewed one. `Description` is written because the CLI requires it
     of any file that is not an untouched skeleton — without it the sync is refused and the record
     is unreachable. The platform skips the push itself when the task already has a prior run, so
     a `minor` re-triage can never wipe a real analysis.
     → `references/lib/ingrain-cli.md` § Recording the assessment. A failed sync never fails the
     review: one line and carry on.
   - `major` → keep any **Prior analysis pointer** for Step 1, then
     **open the assessment file** at `assessment_abs` — the mint already seeded its title, banner
     and every empty section, so fill the `## Task` fields in place rather than writing the page
     over. **Write `Description`** there — one line on what this change does, in your own words;
     it is yours alone to record, and no later stage fills it. Leave `Schema version` as seeded.
     The worker's `## Triage` section is already in it.
     Then **write `Surfaces`** into `## Triage` — a short bullet list naming the security-relevant
     aspects the plan touches ("new file-upload endpoint", "adds JWT verification", "raw SQL with
     user input"). Yours, not the worker's: they feed **both** driver chains — the threat generator
     seeds its list from them and the broad rule retrieval keys its queries on them — and triage's
     one job is deciding whether the change is worth a deeper look, not serving two consumers it
     cannot see. Name security **features**, since that is what a rule query matches on, as well as
     the ways the change could go wrong.
     Then **write `## Affected paths`** — a bullet list of the repository-relative folders the
     plan says this change will touch. A prediction, not a measurement: the code does not exist
     yet, and this is the only record of where it will land. It scopes the org-rule
     retrieval in Step 1b to the right part of the codebase, so it is worth stating
     before that runs.
     → `references/lib/assessment-file.md` § `## Affected paths` for the rules.

1. **Fork the two driver chains — dispatch the threat generator in the same block as retrieval's
   first call.** They share no input, so nothing orders them. Both run recall → precision →
   decision, and they join at the guidance generator, which needs both.

   **What the fork actually buys, stated exactly.** Retrieval is *your* work, not a worker's, and
   it takes more than one turn: probe, then the queries, then the `## Org rules` write. You cannot
   take a turn while suspended on a dispatch, so the generator overlaps whatever shares its block —
   the probe — and has returned by the time you compose the queries. The saving is that the threat
   chain never sits idle behind the whole retrieval leg; it is not two chains running end to end at
   once. Step 2 is where the parallelism is real: two subagents, one block, nothing of yours in
   between.

   **1a — Threats.** Dispatch `ingrain-threat-generator` at the plan **and the `## Triage` section**
   (the Surfaces you wrote seed the search; extend beyond them). **If triage returned a Prior analysis pointer**,
   also point it at that snapshot's `## Threats` and `## Implementation guidance` so it **seeds from
   the prior analysis**, re-derived against the current plan. It writes one `### T<n>` entry per
   threat into `## Threats` and returns a pointer. Ids are assigned in discovery order and are
   **provisional** — stable through the critique so its feedback keys line up, then re-tagged into
   risk order at Step 3.

   **1b — Retrieve the org rules, broadly. Yours alone, no worker.** They are ingested knowledge —
   how *this* team implements auth, validation, secrets, crypto — reached by semantic search over
   the `ingrain` CLI, and this is the review's **one** retrieval pass. It keys on **the plan, the
   triage Surfaces and `## Affected paths`** — all on disk from Step 0 — and **never on gate
   selections**, which is what lets it run here rather than after a gate.

   **Cast a wide net.** Missing a governing rule is the costly failure, and precision is restored
   by the critique that follows rather than by asking fewer questions: run a query per distinct
   security feature the change touches, and prefer more queries and higher limits to a narrow
   sweep. Pass **`--assessment "<assessment_abs>"`** so the search narrows to the rules governing
   the folders you named in `## Affected paths`.

   **Ask them all in ONE call.** Every question is known before the first answer — they key on the
   plan, the Surfaces and `## Affected paths`, all on disk — so nothing about query 2 depends on
   query 1's result. Write the list, then run the whole loop in a single command rather than a turn
   per question; breadth is what this pass is for, and a query-per-turn makes breadth cost round
   trips the run has no reason to pay.
   → `references/lib/ingrain-cli.md` § Retrieval carries the loop.

   Write what comes back — id, title and **full body verbatim**, with `Selection: —` — into
   **`## Org rules`** in the assessment. Nothing retrieved → leave the section empty.
   → `references/lib/ingrain-cli.md` owns the probe, the query and the failure taxonomy;
   `references/lib/assessment-file.md` § `## Org rules` owns the section's schema.

   - **Sandbox or permission denial** → you are in the main session, so the host's native "allow
     this command?" prompt reaches the user. **Recoverable:** re-run so it surfaces, and carry on
     without rules once they decline.
   - **Genuine unavailability** — binary absent, unconfigured, or no matches — degrades gracefully:
     `## Org rules` stays empty, one line on why, carry on. The review then runs on the threat axis
     alone, and the guidance stands on the workers' own analysis. **Take that line from stderr, not
     from the empty array** — an empty result where the repository is not registered on the
     platform looks identical to one where no rule matched, and only stderr tells them apart. The
     first has a fix the user can act on; reported as the second it reads as "we have no rules".

2. **Critique both chains** *(single round each)* — again independent, so dispatch them together.

   **2a — `ingrain-threat-critic`** at `## Threats`, then act on its keyword:
   - `needs-revision` → re-dispatch `ingrain-threat-generator` **once**, with a pointer to
     `## Threats` + `## Threat critique`, then **freeze**. That single revision closes the loop.
   - `approved` → **freeze** the threats.
   - Either way, surface anything the critique left unresolved.

   **2b — `ingrain-rule-critic`** at `## Org rules` and the plan. It judges each retrieved rule's
   applicability to *this* change and writes a transient `## Rule critique` — per rule, keep or
   prune, with one line why. **You then apply the prune**, removing the machine-rejected entries
   from `## Org rules`; a worker never edits another writer's section.

   **The critique is advice, and you hold the pen — keep a rule whose prune reason does not hold.**
   Each verdict comes with its one line of reasoning precisely so you can weigh it: where the reason
   misreads the change, names a surface the plan does touch, or rests on something the plan does not
   say, **keep the entry and carry on**. You need not re-dispatch the critic or justify the
   override; the gate is one line further on and the user decides there. **This runs one way only —
   you may keep what the critic pruned, never prune what it kept.** Keeping widens what the user
   sees and they gate it; pruning past the critic removes a rule from view on your judgement alone,
   unseen and unrecorded, which is the one move nothing downstream can catch.

   **A pruned rule is never presented and never recorded.** Machine judgment here is retrieval
   refinement — the same category as the search ranking — and only *user* decisions reach the
   record. The accepted trade: a critic false-positive **you do not catch** is recoverable only by
   re-review, and that is what buys a curated set the user can vouch for wholesale.

3. **Risk score** — dispatch `ingrain-risk-scorer` at the frozen `## Threats`. It fills each
   entry's five scoring field lines, writes the plan-level residual into `## Risk score`, and
   **re-tags the threats into descending-risk order** — reordering the entries and reassigning ids
   contiguously from `T01`, the most dangerous threat. It is the last stage that can do so safely:
   threat ids pick up their first references at Step 5, when guidance names them. From here
   **the id is the priority** and is permanent: every stage that shows threats shows them in
   **id order** — the ids are the sort.

4. **The user gates — one moment, two axes.** Follow **How to ask the user**. Present the threat
   gate and then the rule gate in the **same message**: they are one decision point about one
   change, and splitting them across turns makes the user answer the same question twice.

   **4a — The threat gate: which threats to act on.** The user must understand each threat without
   re-reading the plan. In order:

   1. **Read** the bounded `## Threats` slice — **required**, and exactly the read the
      context-window discipline permits. **Run the three-check on it while it is in front of you.**
      If the slice is empty or its scoring fields still read `—`, re-dispatch `ingrain-risk-scorer`
      (or `ingrain-threat-generator` where the entries themselves are missing). A wrong enum or a
      missing field line goes back the same way, to the worker that owns that field.
   2. **Display** the scored threats as a Markdown table **in id order — `T01` first**, which the
      scorer already re-tagged into descending risk. Take the ids as the order, and confirm the
      risk scores descend down them; where a score rises, Step 3 goes back for the re-tag.
   3. **Present** one single-choice window per threat; mark high/critical recommended.
   4. **Record** each threat's `Selection` in `## Threats` (act on it → `selected`, accept the risk
      → `excluded`; `undecided` only if the user is explicitly unsure) — a mistyped `Selection`
      here silently drops a threat from Testing's scope.

   | Column | Contents |
   |--------|----------|
   | **Threat** | id + short title (e.g. `T01 — unauthenticated token refresh`) |
   | **Risk** | risk criticality + 0–100 score (e.g. `high · 78`) |
   | **What can go wrong** | the concrete failure, from the threat's Vector/Description, in this change's terms |
   | **Why it matters** | the consequence if realized, grounded in the scorer's impact and score |
   | **Local impact in the plan** | which specific part of *this* change the threat lands on |

   Every cell traces back to an entry a worker wrote. Flag high/critical rows (e.g. `⚑ high · 78`)
   so the table and the windows tell the same story.

   **4b — The rule gate: which org rules govern this change.** Present **only the curated set** —
   the entries surviving the rule critique. A machine-pruned rule is never shown, which is exactly
   what makes vouching for the whole set a reasonable default. In order:

   1. **Read** the bounded `## Org rules` slice and three-check it. Empty section → **no org rule
      applies to this change**; say so in one line and skip to 4c. Do not say *why* it is empty:
      whether retrieval found nothing or the critique pruned everything is machine judgment, and
      only user decisions reach the record. **That silence covers machine judgment, not a
      retrieval that could not run** — where Step 1b already reported the CLI absent,
      unconfigured, or scoped to an unregistered repository, say the section is empty *for that
      reason* instead. "No org rule applies" would claim a review nobody performed.
   2. **Display** the curated rules as a Markdown table.
   3. **Offer accept-all first** — a single choice covering every presented rule. It is the
      expected answer, and it is the user vouching for a curated set rather than an ungated one.
      Behind it, per-rule windows for the case where a retrieval miss survived the critique.
   4. **Record** each entry's `Selection` in `## Org rules` (applies here → `selected`, does not
      apply → `excluded`). Accept-all writes every entry `selected` in one edit.

   | Column | Contents |
   |--------|----------|
   | **Rule** | the rule **title** — ids are machine-facing and stay in the file |
   | **What it requires** | the control the rule prescribes, from its body, in one line |
   | **Why it may apply here** | which part of *this* change it lands on |

   **Selection is the adherence scope.** A `selected` rule is judged at Testing — including one no
   guidance ends up implementing, which is precisely the case a security owner needs to see. An
   `excluded` rule is recorded as deemed inapplicable and left unjudged. Both travel to the
   platform: an exclusion is governable because it is never silent.

   **4c — Route on what both gates selected.** In the **gate message above** — not a later one —
   **name the run's assessment file** (its relative `assessment_path`) and **the plan file** these
   decisions feed into; a **mention only**, since the plan-file write happens at finalize. The
   routing below is decided once the user has answered.

   - **1+ selected on either axis** → proceed to Step 5. Name what was set aside in one line
     ("T02, T05 excluded — risk accepted; 1 rule deemed inapplicable"). **Selected rules alone
     sustain a guidance round** — a rules-only review is an ordinary outcome.
   - **Both gates selected nothing** → skip Steps 5–6. State "no threats selected and no rules in
     scope — review closed", close with a one-line verdict naming the accepted risks and the
     inapplicable rules, then **go to Finalize**. The all-`excluded` sections are the preserved
     context — the decisions *are* the record.

5. **Guidance** — dispatch `ingrain-guidance-generator` with `assessment_abs` and pointers to
   **both driver sections**: the **selected** `## Threats` entries and the **selected** `## Org
   rules` entries. Excluded drivers on either axis are out of scope. It reads the rule bodies from
   the section by pointer, exactly as it reads the threats — no inline paste.

   It writes `## Implementation guidance`, and **every entry names at least one driver**: the
   threats it closes, the rules it implements, or both. An entry driven by a rule alone is ordinary
   guidance, not a leftover category. **One entry may serve several threats *and* several rules —
   written once, naming them all.**

6. **Critique the guidance** *(single round)* — dispatch `ingrain-guidance-critic` at
   `## Implementation guidance` **and `## Org rules`**, so it can judge each entry against its
   drivers *and* report **selected** rules that no guidance implements. That gap is what this
   critic exists to catch, and reporting it here — while the generator can still revise — is why
   no coverage section is needed downstream.
   - `needs-revision` → re-dispatch `ingrain-guidance-generator` **once**, then **freeze**.
   - `approved` → **freeze** the guidance.
   - Either way, surface anything the critique left unresolved.

   Then **go to Finalize**. There is no guidance gate: all critiqued guidance lands in the plan,
   and the user refines it **there** — the plan is their editing surface, and verification catches
   any drift by judging the code.

## The plan file

The review folds its results into **the plan file** — the implementation plan the coding agent
edits and executes downstream. This is **distinct from the assessment file**: the assessment file
is the security-analysis artifact the workers write; the plan file is where the selected threats,
the accepted org rules and **all** critiqued implementation guidance land.

In **plan mode** it is a concrete on-disk file (e.g. `.${coding_agent_root}/plans/<name>.md`) whose
path you already hold, since it is the file you are editing — **name it** when you reference it.
In **ad-hoc mode** it is the inline plan you are building in the conversation.

## Finalize

Reached from the gates (both selected nothing) or from Step 6. Two writes and a closing verdict:

**1. Finalize the assessment file in place.** Set `## Task` → `Latest stage: development`, then:

- **Prune `## Org rules` by Selection.** A `selected` entry persists **in full** — its body is what
  the Testing pass reads as the rule's specification, whether or not any guidance drives it. An
  `excluded` entry keeps its heading and `Selection: excluded` line and **drops its body**: the
  decision is the record, the payload was provenance.
- **Delete the three transient sections — `## Threat critique`, `## Rule critique` and
  `## Guidance critique`** (heading and body): they are iteration scratch.
- **Leave every field card where it is** — they are persistent, and the Testing pass runs in a
  later session with no reference in context.

One write, to `assessment_abs`; the file already lives at its final path, so finalizing it in place
*is* persisting it.

**No coverage section is written.** An unaddressed selected driver was already reported by the
guidance critic, when the generator could still revise, and Testing **proves** it afterwards — an
unaddressed selected threat reads `weak`, an unimplemented selected rule reads `not-followed`.
Name any that remain in the closing verdict below instead.

**LAST — close with a one-line verdict.** Visible output in the conversation, not a file write — the
last thing the user reads, and the only place three otherwise-homeless statements land:

- **any selected driver left unaddressed** — the replacement for the deleted `## Coverage`
  section, which is why it is a sentence rather than a section: no derived join to keep honest;
- **the plan-level residual risk, with the scorer's one-line justification for it** — `## Risk
  score` holds `Score` and `Criticality` and nothing else, so the justification the
  `ingrain-risk-scorer` returned has no field to sit in and is said here or nowhere;
- **whether the sync landed**, in the same line if it did and one line of its own if it did not.

The both-gates-empty route reaches this step too: there the verdict names the accepted risks and
the rules deemed inapplicable, which is the whole of what that review produced.

**On a re-assessment, empty `## Rule adherence` back to its heading and card.** Those entries were
judged against the previous implementation and the previous rule scope, so once the analysis is
rewritten they describe a revision that no longer exists — and any whose rule the new gate did not
select has fallen out of adherence scope entirely, which the CLI rejects rather than syncs.
Clearing it restores the section to the state Testing expects to write into. Nothing is lost: the
platform holds the prior verdicts against the revision they judged.

**Run the three-check over the finished file** on the read this step already requires. Here it is
strict: a field left `—` whose stage *has* run is itself a defect, where mid-run it was the
expected state. Everything downstream has this file and nothing else.

**Then sync it — best-effort.** Once the file is written, run
`ingrain record design --assessment "<assessment_abs>"` so the team sees the analysis. **After**
the write, never before: the CLI reads the file off disk, so syncing first would send the previous
state. One file, one flag — the org rules travel inside it.
→ `references/lib/ingrain-cli.md` § Recording the assessment owns the commands and the failure
taxonomy. **A failed sync never fails the review** — report it in one line and carry on to the
plan write; the assessment file is the output that matters.

**2. Write the results into the plan file.** Incorporate the selected threats, the accepted org
rules and **all critiqued guidance** — every entry, not a subset: there is no guidance gate, and
the plan is where the user refines it. **Say so in one line**: tell them the guidance is theirs to
edit here, and that verification later judges the code rather than this list. Plus two supporting
things:

- **A link to the assessment file** — the **relative** `assessment_path`, because a plan file
  outlives the absolute path and stays valid after a clone or move. It is git-ignored by default
  (share it with `git add -f <file>`).
- **The Maintenance instruction** — tell the implementing agent to keep the assessment file
  **in sync** as the implementation changes across iteration loops, and to locate it by
  **re-running the `assessment-mint` command** from `INGRAIN-ASSESSMENT-PATHS`, writing to
  the `assessment_abs` it returns. Point it at the mint rather than the relative link: that agent
  runs in a later session with no project root in view. Re-minting is deterministic in
  branch + title, so it resolves to the same file.

In plan mode, **name the plan file you write to**; ad-hoc, this is the inline plan. The guidance is
now part of what the coding agent implements — incorporate it, refine it as you would any other
part of the plan, and carry on planning.

## Development — checklist

The procedure is **Development — the flow**; this is the tracker. Tick only what is actually done.
Work top to bottom, in the order listed — **except where a line says otherwise**: 1a and 1b
fork and run together, as do 2a and 2b.
**The field cards seeded in `assessment_abs` are the write contract — yours and every worker's.
The three-check runs at the user gates and at finalize, on the reads those steps already make;
never on a fresh read of `references/lib/assessment-file.md`.**

- [ ] 0. Triage dispatched — `unclear` → ask user; `minor` → `Description`, sync, stop; `major` → open file, write `Description` + `## Affected paths`
- [ ] 1a. Threats generated into `## Threats`, seeded from any prior analysis
- [ ] 1b. Org rules retrieved by YOU, forked with 1a — keyed on plan/Surfaces/paths, not a gate; broad; ALL queries in ONE call; bodies verbatim, `Selection: —`
- [ ] 2a. Threat critique dispatched — one revision at most, then threats frozen
- [ ] 2b. Rule critique dispatched — YOU applied the prune, keeping any unfounded one; a pruned rule is never presented and never recorded
- [ ] 3. Risk scored — five fields per threat plus the plan-level residual; threats re-tagged into risk order (`T01` = highest)
- [ ] 4a. Threat gate — slice three-checked, table displayed FIRST, then one window per threat; `Selection` recorded
- [ ] 4b. Rule gate, SAME user moment — curated set only, table FIRST, then accept-all and per-rule windows; `Selection` recorded on every entry
- [ ] 4c. Routed on the OR of both gates — 1+ selected on either axis proceeds; only both empty ends the review
- [ ] 5. Guidance generated from BOTH selected driver sets, by pointer; every entry names ≥1 driver; a multi-driver entry written ONCE
- [ ] 6. Guidance critique pass done — selected rules left unapplied reported; guidance frozen. No guidance gate: it lands in the plan
- [ ] Finalize — `Latest stage: development`, `## Org rules` pruned by Selection, all three critique sections deleted, cards kept, file three-checked
- [ ] Plan written — ALL critiqued guidance, the assessment linked, Maintenance stated, and one line telling the user the guidance is theirs to refine here
- [ ] Synced — `ingrain record design --assessment "<assessment_abs>"` AFTER that write; best-effort, so a failure is one line and never fails the review

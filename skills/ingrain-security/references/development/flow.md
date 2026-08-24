# Development — the plan review: threats, org rules and implementation guidance

Development's procedure, and the machinery only this phase uses — the worker dispatch shape and
the two user gates.

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate three worker roles, each defined by a reference file at
`references/development/<name>.md` (`ingrain-threat-generator`,
`ingrain-threat-critic`, `ingrain-rule-critic`). You dispatch each as a fresh subagent, holding
the state between steps yourself. **Everything else in this phase is yours**: Step 0's review
question and the prior-analysis lookup behind it, the broad org-rule retrieval — **forked
alongside the threat chain rather than after a gate**, and Step 1 states exactly what that overlap
is and is not — the risk scoring at Step 3, and the implementation guidance at Step 5.

Each of those three needs fresh eyes on the plan and the repo, which is what a dispatch buys and
what it is worth a wave for — SKILL.md § Security review loop states the rule. Scoring the threats
you are about to gate, and writing guidance from two driver sets already in your context, are not
that.

This phase produces exactly **two things**: the **assessment file** (the hand-off medium the
workers and you write section by section, and you finalize) and the modifications to the active
**plan** (formal or ad-hoc), carrying the selected threats, the accepted org rules and **all** the
guidance.

## How to dispatch a worker

**The prompt is this file's; the mechanism is `dispatch.md`'s.** It owns the subagent primitive
and the in-context fallback, the write rules, the model tier, and the permission gate to open when
a session rule holds subagent dispatch behind the user's request — **ask before your first
dispatch**, which here is Step 1a's threat generator.
→ `references/lib/dispatch.md`, and its § When a session rule gates subagents behind user request.

Dispatch every worker with the same shape. The write target is restated inline because that path
is per-run and the worker has no other way to learn it:

```
Read <plugin_root>/skills/ingrain-security/references/development/<name>.md — the ABSOLUTE
path, with plugin_root from the mint JSON pasted in full — and follow it as your system prompt.
Your ONE permitted write is your own section of the stored analysis file for this run at
<the minted assessment_abs — the ABSOLUTE path, pasted in full> (section: <## Section for this worker>),
written to the field card that file already carries under your section: one field per line,
in the order it lists, with its exact values. Write ONLY the fields your own phase block
owns, and leave every other block exactly as you found it — markers included, and an empty
one still empty: that emptiness is how the stage owning it is known not to have run yet.
Write that section in ONE call — a single Write or Edit carrying every entry. Where you are
filling fields into entries that already exist, it is one Edit per ENTRY, replacing the run
between your own marker and the next; never one Edit per field.
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
(approved/needs-revision for a critic) — or headline result, plus
a one-line pointer to the section you wrote, which carries the full output.
```

Branch on the keyword the worker leads its return with (`approved`/`needs-revision`), and pass
the **next** worker a pointer to the sections it must read.

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

You hold the state between steps. The tracker is **Development — checklist** at the end of this
file.

0. **The review question — yours, no worker, and the FIRST thing you do.** Put it before any read,
   any write and any lookup. Everything else in this step exists to feed Step 1, which a `No`
   never reaches, so doing any of it first only spends the user's time on a review they have not
   asked for. The answer *is* the verdict, which is why the field's values stay two.

   **One thing may precede it, and it is routing rather than analysis:** a run that arrived as
   `phase: requires_judgement` / `siblings_present` resolves its siblings first, because that
   decides which file this run writes into. Nothing else goes ahead of the question.

   One single-choice window, worded so the answer stands on its own as a record:

   > **Run a security review for this change?**
   > - **Yes — it touches a security surface**
   > - **No — this change is not security-relevant**

   Word the options that way rather than as "do you want to" / "skip for now". A `no` is written
   into the file as `Verdict: minor` and syncs as *assessed, found not security-relevant*, so the
   option the user picked has to say that much; a "skip" option would record a claim they never
   made.

   **Mark `Yes` recommended whenever the change plausibly touches any of these** — authentication,
   authorization, access control, sessions; data storage, queries, user or sensitive data; network
   calls, API endpoints, webhooks, external services; file upload, download or filesystem work;
   cryptography, hashing, token generation; user input handling and validation; infrastructure,
   deployment, CI/CD; dependency additions or upgrades; configuration that changes runtime
   behaviour; any backend or server-side logic.

   **Mark `No` recommended only when the change is ONLY** cosmetic or UI (colour, font, spacing),
   a typo fix in docs or comments, reformatting or lint-only edits, static content, a rename with
   no behavioural change, or a non-executable asset.

   **Borderline recommends `Yes`.** A needless review is cheap; a missed security concern is
   expensive. State your reading in one line above the window so the user can correct it — the
   recommendation is a default, never a decision, and their answer is what gets recorded either
   way. **No window mechanism reachable** — a non-interactive run — take `Yes`, for the same
   asymmetry.
   → `references/lib/dispatch.md` § Selection windows for the host mechanism.

   **Write `## Triage` yourself** from the answer — `Verdict: major` + `Security relevant: true`,
   or `Verdict: minor` + `Security relevant: false`. Then take that branch:

   - `minor` → **record it, then stop.** Open the assessment at `assessment_abs` and write
     `## Task` → `Description` (one line on what this change does) beside the `## Triage` you just
     wrote, with `Prior analysis: none` — no lookup ran, and none was owed. The file is otherwise
     left as seeded. Then sync it — best-effort, exactly like the Development finalize:
     `ingrain record design --assessment "<assessment_abs>"`.
     Then state "no security review needed — minor change" and **STOP**; the question is the whole
     pipeline for a minor change, so carry on building the plan.

     **Why a `minor` still records.** "We assessed this and it is not security-relevant" is a
     result the platform stores in its own right, and it is the only way a reviewer can tell an
     assessed change from an unreviewed one. `Description` is written because the CLI requires it
     of any file that is not an untouched skeleton — without it the sync is refused and the record
     is unreachable. The platform skips the push itself when the task already has a prior run, so
     a later `minor` answer can never wipe a real analysis.
     → `references/lib/ingrain-cli.md` § Recording the assessment. A failed sync never fails the
     review: one line and carry on.
   - `major` → two things, in this order.

     **Find the prior analysis first.** The mint handed you a **`siblings`** list — the assessments
     already on this branch that this run's title did not produce, already filtered to written
     files and already excluding the file this run is about to write. Read those candidates as
     absolute paths (prefix each with `<project_root>/.ingrain-security/`).
     **Do not glob the folder**: a glob returns this run's own file, so you would report the
     analysis about to be overwritten as prior work.
     - **Match on the task, strictly.** A shared branch may hold several concurrent tasks'
       assessments, so the list can hold files belonging to *other* work. For each candidate read
       its `## Task` Title and compare the branch and the title against the current plan — a match
       needs the same branch **and** a title describing the *same* work. On ties prefer the most
       recently modified. Anything looser is `none` and starts fresh: a sibling task's analysis
       would mislead every stage downstream, so starting fresh is strictly safer.
     - **A matched snapshot whose `## Threats` section is non-empty** is your **Prior analysis**
       pointer — its path and threat count. Step 1a hands it to the threat generator, which seeds
       from it. Nothing matched, or no candidate carries threats → `none`.

     Then **open the assessment file** at `assessment_abs` — the mint already seeded its title,
     banner and every empty section, so fill the `## Task` fields in place rather than writing the
     page over. **Write `Description`** there — one line on what this change does, in your own
     words; it is yours alone to record, and no later stage fills it. Leave `Schema version` as
     seeded. Then **write `Prior analysis`** into `## Triage` — the pointer from the lookup above,
     or `none` — and **`Surfaces`** beside it: a short bullet list naming the security-relevant
     aspects the plan touches ("new file-upload endpoint", "adds JWT verification", "raw SQL with
     user input"). They feed **both** driver chains — the threat generator seeds its list from them
     and the broad rule retrieval keys its queries on them. Name security **features**, since that
     is what a rule query matches on, as well as the ways the change could go wrong.
     Then **write `## Affected paths`** — a bullet list of the repository-relative folders the
     plan says this change will touch. A prediction, not a measurement: the code does not exist
     yet, and this is the only record of where it will land. It scopes the org-rule
     retrieval in Step 1b to the right part of the codebase, so it is worth stating
     before that runs.
     → `references/lib/assessment-file.md` § `## Affected paths` for the rules.

1. **Fork the two driver chains — dispatch the threat generator in the same block as retrieval's
   first call.** They share no input, so nothing orders them. Both run recall → precision →
   decision, and they join at the guidance step, which needs both.

   **What the fork actually buys, stated exactly.** Retrieval is *your* work, not a worker's, and
   it takes more than one turn: probe, then the queries, then the `## Org rules` write. You cannot
   take a turn while suspended on a dispatch, so the generator overlaps whatever shares its block —
   the probe — and has returned by the time you compose the queries. The saving is that the threat
   chain never sits idle behind the whole retrieval leg; it is not two chains running end to end at
   once. Step 2 is where the parallelism is real: two subagents, one block, nothing of yours in
   between.

   **1a — Threats.** Dispatch `ingrain-threat-generator` at the plan **and the `## Triage` section**
   (the Surfaces you wrote seed the search; extend beyond them).
   **If Step 0's lookup left you a Prior analysis pointer**, also point it at that snapshot's
   `## Threats` and `## Implementation guidance` so it **seeds from the prior analysis**,
   re-derived against the current plan. It writes one `### T<n>` entry per
   threat into `## Threats` and returns a pointer. Ids are assigned in discovery order and are
   **provisional** — stable through the critique so its feedback keys line up, then re-tagged into
   risk order at Step 3.

   **1b — Retrieve the org rules, broadly. Yours alone, no worker.** They are ingested knowledge —
   how *this* team implements auth, validation, secrets, crypto — reached by semantic search over
   the `ingrain` CLI, and this is the review's **one** retrieval pass. It keys on **the plan, the
   `## Triage` Surfaces and `## Affected paths`** — all on disk from Step 0 — and **never on gate
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
     alone, and the guidance stands on the analysis in hand. **Take that line from stderr, not
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

3. **Risk score — yours, no worker.** Judgement and bookkeeping, in that order: you score, then a
   script re-tags. **Read the frozen `## Threats` slice once** — this is the bounded read the
   context-window discipline permits, and it is the same one the threat gate needs, so it is made
   here and serves both.

   **Score every entry in the section, and only those.** The membership is settled. An entry whose
   `#### usergate` block already records a `Selection` is a re-assessment carrying a prior pass's
   decision — context travelling with the entry, never a filter on what you score.

   For each threat, **reason before you score**, because the block is filled top-down and this
   schema doubles as a reasoning schema:
   - **Justification** — a sentence or two on how probable and how damaging this threat is *for
     this change*. Reasoning, not a restatement of the fields above it. It drives the rest.
   - **Impact** — how damaging it would be if realized.
   - **Likelihood** — how probable it is to be realized for this change.
   - **Risk score** — likelihood × impact, normalized to `0`–`100`; higher is more dangerous.
   - **Criticality** — the band that score falls in.

   Write them into each entry's **`#### score` block** — one Edit per entry, replacing the run
   between that marker and the next, and leaving `#### gen`, `#### usergate` and `#### test`
   untouched. Then write the **plan-level residual** into `## Risk score` — `Score` and
   `Criticality` for the change as a whole. **Keep your one-line justification for that residual in
   hand**: the section has no field for it, and the closing verdict is where it lands.

   **Then re-tag, with the script — never by hand.** It sorts the entries into descending-risk
   order and renumbers them contiguously from `T01`, the most dangerous threat. Unlike the Phase
   select batch, SessionStart does not inject this one ready to run: paste `plugin_root` and
   `assessment_abs` in from the mint JSON, both in full.

   ```ingrain-script
   bash <plugin>/skills/ingrain-security/scripts/threat-retag --assessment "<assessment_abs>"
   ```

   Entries move by line span, so every phase block travels with its threat byte for byte and only
   the `T<nn>` token in a heading is rewritten. **Take the new ids from its JSON**, which is the
   whole of what the threat gate's table needs beside the entry text you already read:

   - **`retagged`** — `true` when the file was rewritten. Read it before anything else.
   - **`threats`** — the new order, `T01` first. Each carries its new **`tag`**, the
     **`previous_tag`** it had when you scored it, its **`title`**, **`risk_score`** and
     **`criticality`**. **The ids you were holding are stale from here** — take every one from
     this list.
   - **`reason`** and **`malformed`** — why nothing was rewritten, when `retagged` is `false`.
     `unscored-entries` means an entry has no readable `Risk score` and `malformed` names it:
     fill that block and run the script again. Re-tagging a half-scored list would freeze the
     wrong priority permanently, so it refuses whole rather than ordering what it can.
   - Obey the `instruction` field, as with every bundled script.

   **This is the last stage that may reorder.** Threat ids pick up their first references at
   Step 5, when guidance names them. From here **the id is the priority** and is permanent:
   every stage that shows threats shows them in **id order** — the ids are the sort.

4. **The user gates — one moment, two axes.** Follow **How to ask the user**. Present the threat
   gate and then the rule gate in the **same message**: they are one decision point about one
   change, and splitting them across turns makes the user answer the same question twice.

   **4a — The threat gate: which threats to act on.** The user must understand each threat without
   re-reading the plan. In order:

   1. **Take** the scored threats from Step 3 — the entry text you read there, under the ids the
      re-tag returned; no second read.
      **Run the three-check on what Step 3 had in front of it.** Where the entries themselves are
      missing, re-dispatch `ingrain-threat-generator`; where a `#### score` block is wrong or
      incomplete, it is yours to fix — Step 3 wrote it.
   2. **Display** the scored threats as a Markdown table **in id order — `T01` first**, which the
      re-tag already sorted into descending risk. Take the ids as the order.
   3. **Present** one single-choice window per threat; mark high/critical recommended.
   4. **Record** each threat's `Selection` into its **`#### usergate` block** (act on it →
      `selected`, accept the risk → `excluded`; `undecided` only if the user is explicitly
      unsure) — that block is yours and the three around it are not, so write between its
      marker and the next and leave `#### gen`, `#### score` and `#### test` untouched. A
      mistyped `Selection` here silently drops a threat from Testing's scope.

   | Column | Contents |
   |--------|----------|
   | **Threat** | id + short title (e.g. `T01 — unauthenticated token refresh`) |
   | **Risk** | risk criticality + 0–100 score (e.g. `high · 78`) |
   | **What can go wrong** | the concrete failure, from the threat's Vector/Description, in this change's terms |
   | **Why it matters** | the consequence if realized, grounded in the impact and score you set |
   | **Local impact in the plan** | which specific part of *this* change the threat lands on |

   Every cell traces back to an entry in the file. Flag high/critical rows (e.g. `⚑ high · 78`)
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
   - **Both gates selected nothing** → skip Step 5. State "no threats selected and no rules in
     scope — review closed", close with a one-line verdict naming the accepted risks and the
     inapplicable rules, then **go to Finalize**. The all-`excluded` sections are the preserved
     context — the decisions *are* the record.

5. **Guidance — yours, no worker.** Write `## Implementation guidance` from **both selected driver
   sets**: the `selected` `## Threats` entries you just gated, and the `selected` `## Org rules`
   entries whose bodies are already in your context from the retrieval carve-out. Excluded drivers
   on either axis are out of scope. Nothing here needs a fresh read, which is why nothing is
   dispatched for it.

   One `### M<n> — <title>` entry per piece of **work**, to the field card under that heading:

   - **Every entry names at least one driver.** `Threats` and `Rule refs` may each be `—`, but
     **never both**: work that traces to no stated goal cannot be attributed, verified or governed,
     and both the CLI and the platform refuse such a file outright.
   - **`Rule refs` may only name a `selected` rule**, and each id is **copied whole and verbatim**
     from `## Org rules` — never abbreviated to a prefix. An id is an exact-match key, so a
     shortened copy silently names no rule at all.
   - **One entry may serve several threats *and* several rules — write it once, naming them all.**
     A single control routinely closes two threats *and* satisfies the rule that prescribes it.
     Copying it per driver reads as several pieces of work everywhere downstream.
   - **Rule-driven guidance is ordinary guidance.** An entry naming a rule and no threat is fully
     anchored: it states how a standing org requirement becomes concrete in this change.
   - **Ids are permanent**, assigned in the order you write them.

   **Order the list by what an entry is worth, never by which axis drove it** — the two axes are
   symmetric, and sorting rule-driven work to the bottom as a class contradicts that on the one
   surface the user reads. Threat-driven entries rank by the **lowest threat id** each one closes
   (the ids are in risk order, so that is the highest risk it addresses); a rule-driven-only entry
   ranks by the **Yield** it claims, interleaved with them rather than appended after them; ties
   break by higher Yield, then lower Effort.

   **Then check your own coverage, before you leave this step.** Everything it needs is in front of
   you, so it costs no read:
   - every entry names ≥ 1 driver;
   - every **selected** threat is named by some entry's `Threats`;
   - every **selected** rule is named by some entry's `Rule refs`.

   A gap is not a defect to hide: close it if the driver deserves work, and **name it in the
   closing verdict** if it does not. An accepted rule that nothing implements is exactly what a
   security owner needs to see, and Testing will read it as `not-followed` either way.

   Then **go to Finalize**. There is no guidance gate: all the guidance lands in the plan, and the
   user refines it **there** — the plan is their editing surface, and verification catches any
   drift by judging the code.

## The plan file

The review folds its results into **the plan file** — the implementation plan the coding agent
edits and executes downstream. This is **distinct from the assessment file**: the assessment file
is the security-analysis artifact this review writes; the plan file is where the selected threats,
the accepted org rules and **all** the implementation guidance land.

In **plan mode** it is a concrete on-disk file (e.g. `.${coding_agent_root}/plans/<name>.md`) whose
path you already hold, since it is the file you are editing — **name it** when you reference it.
In **ad-hoc mode** it is the inline plan you are building in the conversation.

## Finalize

Reached from the gates (both selected nothing) or from Step 5. Two writes and a closing verdict:

**1. Finalize the assessment file in place.** Set `## Task` → `Latest stage: development`, then:

- **Prune `## Org rules` by Selection.** A `selected` entry persists **in full** — its body is what
  the Testing pass reads as the rule's specification, whether or not any guidance drives it. An
  `excluded` entry keeps its heading and `Selection: excluded` line and **drops its body**: the
  decision is the record, the payload was provenance.
- **Delete the two transient sections — `## Threat critique` and `## Rule critique`** (heading and
  body): they are iteration scratch.
- **Leave every field card where it is** — they are persistent, and the Testing pass runs in a
  later session with no reference in context.

One write, to `assessment_abs`; the file already lives at its final path, so finalizing it in place
*is* persisting it.

**No coverage section is written.** Step 5's own check already found any unaddressed selected
driver, while the guidance could still be changed, and Testing **proves** whatever survives — an
unaddressed selected threat reads `weak`, an unimplemented selected rule reads `not-followed`.
Name any that remain in the closing verdict below instead.

**LAST — close with a one-line verdict.** Visible output in the conversation, not a file write — the
last thing the user reads, and the only place three otherwise-homeless statements land:

- **any selected driver left unaddressed** — the replacement for the deleted `## Coverage`
  section, which is why it is a sentence rather than a section: no derived join to keep honest;
- **the plan-level residual risk, with your one-line justification for it** — `## Risk score` holds
  `Score` and `Criticality` and nothing else, so the reasoning you formed at Step 3 has no field to
  sit in and is said here or nowhere;
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
strict: a field left `—` inside a block whose stage *has* run is itself a defect. A block
belonging to a **later** stage is expected to be empty and must stay that way — at this point
every threat's `#### test` block is empty, and that is the correct finished state, not something
to fill in. Everything downstream has this file and nothing else.

**Then sync it — best-effort.** Once the file is written, run
`ingrain record design --assessment "<assessment_abs>"` so the team sees the analysis. **After**
the write, never before: the CLI reads the file off disk, so syncing first would send the previous
state. One file, one flag — the org rules travel inside it.
→ `references/lib/ingrain-cli.md` § Recording the assessment owns the commands and the failure
taxonomy. **A failed sync never fails the review** — report it in one line and carry on to the
plan write; the assessment file is the output that matters.

**2. Write the results into the plan file.** Incorporate the selected threats, the accepted org
rules and **all the guidance** — every entry, not a subset: there is no guidance gate, and
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

- [ ] 0. Review question FIRST, before any lookup or write; `## Triage` + `Description`; `minor` → sync + stop; `major` → prior analysis, Surfaces, paths
- [ ] 1a. Threats generated into `## Threats`, seeded from any prior analysis; all four phase markers seeded, only `#### gen` filled
- [ ] 1b. Org rules retrieved by YOU, forked with 1a — keyed on plan/Surfaces/paths, not a gate; broad; ALL queries in ONE call; bodies verbatim, `Selection: —`
- [ ] 2a. Threat critique dispatched — one revision at most, then threats frozen
- [ ] 2b. Rule critique dispatched — YOU applied the prune, keeping any unfounded one; a pruned rule is never presented and never recorded
- [ ] 3. Risk scored BY YOU — slice read once, every `#### score` filled, residual written, then `scripts/threat-retag` re-tagged (`T01` first)
- [ ] 4a. Threat gate — table displayed FIRST, in the re-tag's id order, then one window per threat; `Selection` recorded into `#### usergate`
- [ ] 4b. Rule gate, SAME user moment — curated set only, table FIRST, then accept-all and per-rule windows; `Selection` recorded on every entry
- [ ] 4c. Routed on the OR of both gates — 1+ selected on either axis proceeds; only both empty ends the review
- [ ] 5. Guidance written BY YOU from BOTH selected driver sets; every entry names ≥1 driver; a multi-driver entry written ONCE; own coverage check run
- [ ] Finalize — `Latest stage: development`, `## Org rules` pruned by Selection, both critique sections deleted, cards kept, file three-checked
- [ ] Plan written — ALL the guidance, the assessment linked, Maintenance stated, and one line telling the user the guidance is theirs to refine here
- [ ] Synced — `ingrain record design --assessment "<assessment_abs>"` AFTER that write; best-effort, so a failure is one line and never fails the review

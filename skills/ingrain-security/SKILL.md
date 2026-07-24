---
name: ingrain-security
description: >-
  Use at BOTH ends of a security-relevant change; it detects which phase to run from repo
  state, so invoke it at either moment. Each phase owns one moment: Development runs before
  code for the task exists, Testing after it.
  **Development — plan review:** run AS THE FINAL STEP of building an implementation plan,
  ad-hoc inline or in a formal plan-mode / design-doc session — once the plan is comprehensive
  and detailed (affected files, concrete implementations, tests), but before you present it or
  write any code. It folds selected threats and adopted mitigations back into that plan.
  **Testing — verification:** run AFTER you have implemented code for that plan, but before
  you present or commit it. It measures how robust the applied mitigations are against the
  branch diff, and reports; the coding agent implements.
  If there is even a 1% chance the change touches security, invoke it — triage decides
  whether a full review is warranted.
---

<SUBAGENT-STOP>
If you were dispatched as a worker subagent (ingrain-relevance-triage, ingrain-threat-generator,
ingrain-threat-critic, ingrain-risk-scorer, ingrain-mitigation-generator,
ingrain-mitigation-critic, ingrain-threat-verifier), do the one job you were given
and return. The orchestration — Development and Testing alike — is run by the session that
dispatched you; you are one step inside it.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
Security analysis is the FINAL step of planning. Build the plan in full first — affected files,
concrete implementations, tests. The trigger is that *state*, reached alike by an **ad-hoc plan**
worked out inline and a **formal planning session** (plan mode, a design doc): detailed plan,
implementation still ahead. Run the review there, before you present it or write any code, then
fold its results back into the plan. At a 1% chance of touching security, run it — triage decides
minor vs. major.
</EXTREMELY-IMPORTANT>

## Phase select — do this FIRST

Two phases. **Development — plan review** is the flow below: it runs on a finished plan, before
code. **Testing — verification** (`references/testing/verification-pass.md`) runs on the code that
plan produced. Decide which from repo state, before anything else.

**If the user named a phase, that is the answer.** "Verify the mitigations" → **Testing**.
"Review this plan" → **Development**. Skip the table.

Otherwise **issue all three bundled scripts in ONE block** — read-only, deterministic and mutually
independent, so together they cost a single round-trip. Your SessionStart context carries each one
ready to run (plugin root and host already substituted):

    bash <plugin>/skills/ingrain-security/scripts/assessment-path <host> mint --title "<task title>"
    bash <plugin>/skills/ingrain-security/scripts/rules-path <host> mint --title "<same title>"
    bash <plugin>/skills/ingrain-security/scripts/branch-diff <host>

Keep `assessment_abs`, `rules_abs`, `branch_slug`, `file_exists`, `base_ref`, `diff_ref`,
`delta_empty` and `fallback` from that one batch and **reuse them for the whole run** — no step
below re-mints anything. Obey each script's `instruction` field.

- **`assessment_abs`** — the absolute path — is the write target for every worker dispatch, every
  Write/Edit, and finalize. The relative `assessment_path`
  (`.ingrain-security/assessment-<branch-slug>-<task-slug>.md`) is a **display form** only: prose,
  tables and plan-file links.
- **`file_exists` reports written content, not presence.** The mint seeds an empty skeleton, so it
  stays `false` until a stage fills a section — which is what keeps it usable as the signal.
- **`delta_empty: false`** means commits since the fork point, an uncommitted change, or both.
  → `references/lib/branch-diff.md` owns the refs and why this, not `git status`, is the signal.

If `file_exists: true`, read the bounded `## Mitigations` slice of that file. Then:

| `file_exists` | `selected` mitigation rows | branch delta | Phase |
|---|---|---|---|
| `false` | — | anything | **Development** — no assessment for this task, so it starts at triage |
| `true` | none | anything | **Development** — resume this task's analysis in place |
| `true` | 1+ | empty (`delta_empty: true`) | **Development** — the plan was reviewed; implementation is still ahead |
| `true` | 1+ | non-empty (`delta_empty: false`) | **Testing** — read `references/testing/verification-pass.md` NOW |

**Testing requires all three: an assessment for THIS task, adopted mitigations in it, and a
non-empty branch delta.** Anything else is Development. Three cases look like Testing and are not:

- **A branch delta alone routes to Development.** A fresh task on a branch already carrying
  unrelated commits or WIP mints a fresh path → `file_exists: false` → row 1. The mint is keyed on
  branch **+ task title**, which is what binds an assessment to one task — so take `file_exists` at
  its word rather than globbing the folder, which surfaces some other task's file.
- **`Latest stage: testing` records that a verification ran**, not that the task is closed. A
  branch delta grown since is **Testing again** — re-test every selected threat, overwriting
  `Robustness` and `Justification`.
- **A `minor` triage lands on row 2** — no mitigations to verify. An explicit request sends you to
  Testing, which stops at "no adopted mitigations to verify"; otherwise row 2 resumes Development
  and triage re-confirms `minor`. Either way the run ends at triage, which is right for a minor
  change.

Announce the phase you picked in your opening line, so a misroute costs the user one turn.

# Security review loop

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate six worker roles, each defined by a reference file at
`references/development/<name>.md` (`ingrain-relevance-triage`, `ingrain-threat-generator`,
`ingrain-threat-critic`, `ingrain-risk-scorer`, `ingrain-mitigation-generator`,
`ingrain-mitigation-critic`). You dispatch each as a fresh subagent, in order, holding the state
between steps yourself. One step is yours alone: the org-rules retrieval at Step 2.

The process produces exactly **two things**: the **assessment file** (the hand-off medium the
workers write section by section, and you finalize) and the **user-selected finding set folded
into the plan** at Gate 1 and Gate 2.

**Context-window discipline:** hold only the compact statuses and pointers workers return, and
read a bounded slice of the assessment file at the two gates and at finalize — those bounded reads
are the whole of what the analysis costs your context. The file is the shared state, so you move
data between workers by pointing them at its sections and letting each read for itself.

**The one carve-out is Step 5's retrieval**, where the CLI's rule bodies land in your context
because you are the one writing them to the sidecar. That is the *only* bulk payload you handle
directly: write it straight through and then carry the sidecar's **path**, letting every later
reader open it.

## How to dispatch a worker

A worker is a role a fresh subagent adopts by reading its reference file. Dispatch a **fresh
worker subagent** and tell it to become that worker; the reference file is its logic. **This skill
is built for an agent-based host — one fresh subagent per worker is the designed and expected mode**,
because that is what gives each worker clean context and its own recommended model tier.
→ `references/development/dispatch.md` maps this onto your host (subagent/task primitive, or the
sequential in-context fallback where none exists), and carries the rule that independent calls go
out in **one block**. Where a **session rule says** subagent dispatch waits on the user's request,
treat it as a permission gate over a mechanism the host already has: **ask the user to allow the
subagent flow before your first dispatch** →
`references/development/dispatch.md` § When a session rule gates subagents behind user request.

**Every change to the assessment file goes through the Edit or Write tool**, and **a write is one
call** — one Write or Edit per section, one Edit per *entry* where fields are being filled in.
→ `references/development/dispatch.md` § Writing the assessment file owns the rest.

Dispatch every worker with the same shape — restate its write target inline, because that path is
per-run and the worker has no other way to learn it:

```
Read references/development/<name>.md and follow it as your system prompt.
Your ONE permitted write is your own section of the stored analysis file for this run at
<the minted assessment_abs — the ABSOLUTE path, pasted in full> (section: <## Section for this worker>),
written to the field card that file already carries under your section: one field per line,
in the order it lists, with its exact values; a field your stage does not own reads —.
Write that section in ONE call — a single Write or Edit carrying every entry. Where you are
filling fields into entries that already exist, it is one Edit per ENTRY, replacing that
entry's contiguous block of field lines; never one Edit per field.
The card is the write contract — read references/formatting/assessment-file.md
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
your branch keyword (minor/major, approved/needs-revision) or headline result, plus
a one-line pointer to the section you wrote, which carries the full output.
```

Branch on the keyword the worker leads its return with (`minor`/`major`,
`approved`/`needs-revision`), and pass the **next** worker a pointer to the sections it must read.

**Model:** set each worker's model from the **Recommended model** line in its own reference file.
You stay on the session model. Host-dependent — ignore where per-subagent model selection is
unsupported.

### The three-check

**Check what was written against its field card — never by re-reading the schema.** Three things,
and nothing else:

1. every field label present, in the order the card lists;
2. every enumerated value one of the words the card names, verbatim;
3. every field whose stage has not run yet still `—`.

**It costs no read of its own.** Run it on the reads you already make — the bounded `## Threats`
slice at Gate 1, the bounded `## Mitigations` slice at Gate 2, and the finished file at finalize.
Each sits upstream of everything that consumes the section, so a malformed entry is cheapest to
repair there: re-dispatch the worker that produced it with the problem quoted back.

## How to ask the user

Gate 1 and Gate 2 are **per-finding selection gates** — the user includes or excludes each finding
individually and may select any subset, **including none**. Always in **two distinct steps, in
this order**:

1. **Display the findings as a Markdown table** — one row per finding, columns per the gate step.
   The table is where the detail lives, so the user compares every finding in one place before
   deciding. **Mandatory in every mode and on every host** — plan mode, ad-hoc, windowed or
   fallback alike. Printing it is a read-only display action, permitted in every mode.
2. **Then present the selection windows** — one single-choice include/exclude window per finding,
   labeled by id + short title (e.g. `T01 — unauthenticated token refresh`). One window, one
   finding, one binary choice keeps every decision isolated. Mark high/critical findings
   recommended; because each window is its own decision, **selecting none is always reachable**.
   → `references/development/dispatch.md` § Selection windows for the host mechanism and the
   batching rule where a host caps how many windows it can show at once.

## Development — the flow

Each step is one dispatch; you hold the state between them. The tracker is **Development —
checklist** at the end of this file.

0. **Triage** — dispatch `ingrain-relevance-triage` with the plan, the resolved `branch_slug` (or
   `unknown`), the task title, and the **absolute** `<project_root>/.ingrain-security/` folder from
   the mint JSON (a relative folder silently matches nothing and would wrongly report `none`).
   → `references/development/ingrain-relevance-triage.md` defines it; you branch on its keyword.
   - `minor` → state "no security review needed — minor change" and **STOP**. Triage is the whole
     pipeline for a minor change; carry on building the plan.
   - `major` → keep its **Surfaces** notes and any **Prior analysis pointer** for Step 1, then
     **open the assessment file** at `assessment_abs` — the mint already seeded its title, banner
     and every empty section, so fill the `## Task` fields in place rather than writing the page
     over. The worker's `## Triage` section is already in it.

1. **Threats** — dispatch `ingrain-threat-generator` at the plan **and the `## Triage` section**
   (Surfaces seed the search; extend beyond them). **If triage returned a Prior analysis pointer**,
   also point it at that snapshot's `## Threats` and `## Mitigations` so it **seeds from the prior
   analysis**, re-derived against the current plan. It writes one `### T<n>` entry per threat into
   `## Threats` and returns a pointer. Ids are assigned in discovery order and are **permanent**;
   Step 3 sets priority by scoring, not by renumbering.

2. **Critique threats, and retrieve the org rules in the SAME block.** They are independent, so
   issuing them together costs the retrieval no wall-clock of its own.

   - **Dispatch `ingrain-threat-critic`** at `## Threats` *(single round)*.
   - **Retrieve the org rules yourself, in this session — there is no worker.** They are ingested
     knowledge — how *this* team implements auth, validation, secrets, crypto — reached by semantic
     search over the `ingrain` CLI, and this is the review's **one** retrieval pass. Probe the CLI,
     reason from the plan and the generated threats about which security features need org guidance
     ("how do we authenticate service-to-service calls"), and run one query per distinct question.
     Write what comes back — id, title and **full body verbatim** — into `## Retrieved rules` at
     the already-minted `rules_abs`. Nothing retrieved → leave the sidecar unwritten.
     → `references/lib/ingrain-cli.md` owns the probe, the query and the failure taxonomy;
     `references/formatting/rules-file.md` owns the sidecar's schema.

   Then act on the critic's keyword:
   - `needs-revision` → re-dispatch `ingrain-threat-generator` **once**, with a pointer to
     `## Threats` + `## Threat critique`, then **freeze**. That single revision closes the loop.
     Retrieval does **not** re-run: the revision works from the rules already on disk, and Step 6's
     critic is what flags a gap.
   - `approved` → **freeze** the threats.
   - Either way, surface anything the critique left unresolved.

   Running before Gate 1 means retrieval keys on **all** generated threats, not the selected
   subset. Rules are best-effort supporting context, so the extra breadth is harmless; on a
   zero-selection Gate 1 the pass was spent for nothing, which costs tokens, not time.
   - **Sandbox or permission denial** → you are in the main session, so the host's native "allow
     this command?" prompt reaches the user. **Recoverable:** re-run so it surfaces, and carry on
     without rules once they decline.
   - **Genuine unavailability** — binary absent, unconfigured, or no matches — degrades gracefully:
     sidecar unwritten, one line on why, carry on. The mitigations then stand on the workers' own
     analysis.

3. **Risk score** — dispatch `ingrain-risk-scorer` at the frozen `## Threats`. It fills each
   entry's five scoring field lines and writes the plan-level residual into `## Risk score`, moving
   and renumbering nothing. From here **priority is the risk score**: every stage that shows
   threats sorts by it descending, breaking ties by impact, then likelihood, then id.

4. **Gate 1 — the user selects which threats to address.** Follow **How to ask the user**; the user
   must understand each threat without re-reading the plan. In order:

   1. **Read** the bounded `## Threats` slice — **required**, and exactly the read the
      context-window discipline permits. **Run the three-check on it while it is in front of you.**
      If the slice is empty or its scoring fields still read `—`, re-dispatch `ingrain-risk-scorer`
      (or `ingrain-threat-generator` where the entries themselves are missing). A wrong enum or a
      missing field line goes back the same way, to the worker that owns that field.
   2. **Display** the scored threats as a Markdown table, **sorted by risk score descending**
      (ties: impact, then likelihood, then id) — the ids will not be in order.
   3. **Present** one single-choice window per threat; mark high/critical recommended.
   4. **Record** each threat's `Selection` in `## Threats` (include → `selected`, exclude →
      `excluded`; `undecided` only if the user is explicitly unsure) — a mistyped `Selection` here
      silently drops a threat from Testing's scope.

   | Column | Contents |
   |--------|----------|
   | **Threat** | id + short title (e.g. `T01 — unauthenticated token refresh`) |
   | **Risk** | risk criticality + 0–100 score (e.g. `high · 78`) |
   | **What can go wrong** | the concrete failure, from the threat's Vector/Description, in this change's terms |
   | **Why it matters** | the consequence if realized, grounded in the scorer's impact and score |
   | **Local impact in the plan** | which specific part of *this* change the threat lands on |

   Every cell traces back to an entry a worker wrote. Flag high/critical rows (e.g. `⚑ high · 78`)
   so the table and the windows tell the same story. In the same message, **name the run's
   assessment file** (its relative `assessment_path`) and **the plan file** these decisions feed
   into — a **mention only**; the plan-file write happens at finalize.

   - **1–N selected** → only those proceed to Step 5. Name the excluded in one line
     ("T02, T05 excluded — risk accepted").
   - **None selected** → skip Steps 5–7. State "no threats selected — review closed", close with a
     one-line verdict naming the threats as accepted risk, then **go to Finalize** — the
     all-`excluded` `## Threats` section is the preserved context. Then carry on planning.

5. **Mitigate** — dispatch `ingrain-mitigation-generator` with the **user-selected threats only**
   (excluded threats are out of scope), `assessment_abs`, and `rules_abs` — pointing it at the
   sidecar's `## Retrieved rules` so it grounds its proposals in established org practice. It
   proposes both **threat mitigations** and **general implementation instructions** for the full
   scoped task; both belong in the plan. It writes the mitigation rows and the sidecar's
   `## Per-mitigation mapping`, working from the rules already on disk — it has no CLI of its own.

6. **Critique mitigations** *(single round)* — dispatch `ingrain-mitigation-critic` at
   `## Mitigations` **and the `rules-<…>.md` sidecar**, so it can judge the mitigations against the
   rules they cite *and* against the retrieved rules they leave unapplied. A retrieved rule that no
   mitigation applies is exactly the gap this critic reports.
   - `needs-revision` → re-dispatch `ingrain-mitigation-generator` **once**, then **freeze**.
   - `approved` → **freeze** the mitigations.
   - Either way, surface anything the critique left unresolved.

7. **Gate 2 — the user selects which mitigations to adopt.** Follow **How to ask the user**. In
   order:

   1. **Read** the bounded `## Mitigations` slice, and the `rules-<…>.md` sidecar to resolve rule
      titles. **Run the three-check on the slice**; a wrong enum or a missing field line goes back
      to `ingrain-mitigation-generator` before you display the table.
   2. **Display** the frozen mitigations as a Markdown table, **ordered by the highest risk score
      among the threats each covers**, general instructions last.
   3. **Present** one single-choice window per mitigation, labeled by short title + the threat
      id(s) it addresses (or `general`).
   4. **Record** each mitigation's `Selection` in `## Mitigations` (adopt → `selected`, decline →
      `excluded`).

   | Column | Contents |
   |--------|----------|
   | **Mitigation** | short title of the proposed mitigation |
   | **Addresses** | the threat id(s) it covers (`T01`, `T03`, …), or `— (general)` |
   | **What it does** | the task-specific guidance, from the mitigation's Description |
   | **Yield** | the risk it removes over the current baseline |
   | **Effort** | how much work it takes to implement |
   | **Follows rules** | the **title(s)** of the org rule(s) it follows, resolved from that mitigation's entry in the sidecar (e.g. `Authenticated service calls`); `—` for a pure threat mitigation |

   For each id in a mitigation's **Rule refs**, take the title from its `### <id> — <title>` entry
   in the sidecar. **Print rule titles** — the ids are machine-facing and stay in the file. Where an
   id has no matching sidecar entry (or no sidecar exists), print the rule count (e.g. `2 org rules`).

   - **1–N selected** → incorporate exactly those. If the selection leaves a `selected` threat with
     no covering mitigation, **say so in the closing verdict**.
   - **None selected** → incorporate nothing; record the selected threats as accepted risk in the
     closing verdict.
   - Then **go to Finalize**. This is the last step — close with a one-line verdict.

## The plan file

The review folds its results into **the plan file** — the implementation plan the coding agent
edits and executes downstream. This is **distinct from the assessment file**: the assessment file
is the security-analysis artifact the workers write; the plan file is where the selected threats
and adopted mitigations land.

In **plan mode** it is a concrete on-disk file (e.g. `.${coding_agent_root}/plans/<name>.md`) whose
path you already hold, since it is the file you are editing — **name it** when you reference it.
In **ad-hoc mode** it is the inline plan you are building in the conversation.

## Finalize

Reached from Gate 1 (none selected) or Gate 2. Two writes:

**1. Finalize the assessment file in place.** Fill `## Coverage / open items` with any `selected`
threat left without a `selected` covering mitigation, and set `## Task` →
`Latest stage: development`. Then **delete the two transient sections — `## Threat critique` and
`## Mitigation critique`** (heading and body): they are iteration scratch. **Leave every field card
where it is, and leave the `rules-<…>.md` sidecar in place** — both are persistent artifacts the
Testing pass reads in a later session. One write, to `assessment_abs`; the file already lives at
its final path, so finalizing it in place *is* persisting it.

**Run the three-check over the finished file** on the read this step already requires. Here it is
strict: a field left `—` whose stage *has* run is itself a defect, where mid-run it was the
expected state. Everything downstream has this file and nothing else.

**2. Write the results into the plan file.** Incorporate the selected threats and adopted
mitigations, plus two supporting things:

- **A link to the assessment file** — the **relative** `assessment_path`, because a plan file
  outlives the absolute path and stays valid after a clone or move. It is git-ignored by default
  (share it with `git add -f <file>`). **When a `rules-<…>.md` sidecar was written, link its
  relative `rules_path` too.**
- **The Maintenance instruction** — tell the implementing agent to keep the assessment file
  **in sync** as the implementation changes across iteration loops, and to locate it by
  **re-running the `assessment-path` mint command** from `INGRAIN-ASSESSMENT-PATHS`, writing to
  the `assessment_abs` it returns. Point it at the mint rather than the relative link: that agent
  runs in a later session with no project root in view. Re-minting is deterministic in
  branch + title, so it resolves to the same file.

In plan mode, **name the plan file you write to**; ad-hoc, this is the inline plan. The adopted
mitigations are now part of what the coding agent implements — incorporate them and carry on
planning.

## Testing — verification

Testing measures how robust the adopted mitigations are, by **negative testing**: for each threat
Gate 1 selected, can it still be realized in the code as built? The threats define the scope. It
fires when **Phase select** lands on Testing — an assessment for this task exists, it carries
`selected` mitigations, and `scripts/branch-diff` reported `delta_empty: false`.
**Everything above this line belongs to Development:** Steps 0–7, both gates, the critique steps,
and the org-rules CLI lookup.

**Read `references/testing/verification-pass.md` NOW and follow it.** The full loop lives there;
this section is a pointer, and the procedure is in that file.

## Rules that are easy to miss

Environment-specific facts that defy a reasonable assumption. The flow above is the procedure;
these are what it cannot infer.

| Situation | Do this |
|-----------|---------|
| `.ingrain-security/` appears to be missing | Re-run the mint and use the path it returns. The folder self-ignores, so `git status` stays silent about it — "missing" means the path resolved elsewhere. |
| Naming the assessment file to a worker | Pass the absolute `assessment_abs`. A worker has no project root in view, so a relative path resolves against the file it was reading and creates a stray folder there. |
| The minted file looks empty but `file_exists` is `false` | Correct — the mint seeds a skeleton and `file_exists` reports written content, not presence. Fill it in place. |
| Deciding the phase on a clean tree | Route on `delta_empty`, never `git status`: a fully committed implementation still belongs to Testing. |
| Writing on Codex | Approval is granted per **patch** — one touching the assessment *and* another file prompts as a whole. Keep assessment edits in their own patch. |
| A write to `.ingrain-security/` is held in plan mode | Ask the user to allow writes to that folder — one line on which file and why — then retry the same write. The folder is the run's artifact store, separate from the plan file. |
| Minting in a later session | Use the recorded Title **verbatim**. The mint is keyed on branch + title, so a paraphrase mints a different file and silently loses the task. |
| A worker's section looks correct | Three-check it against its field card at the next gate anyway — an enum typo stays invisible until it breaks in a later session. |
| About to open the schema reference mid-run | Only for what a field *means*. The card under the section is the whole of the shape; re-reading the reference to recover it is the cost this skill exists to avoid. |
| A **session rule says** to call the subagent tool once the user has requested it | A permission gate over a mechanism the host already has. Ask the user to allow the subagent flow before your first dispatch — → `references/development/dispatch.md` § When a session rule gates subagents behind user request. The sequential fallback is for a host whose only mode is the main session. |
| The `ingrain` fetch was sandbox-blocked | Step 2 runs in the main session — re-run and let the host's native prompt reach the user. Continue without rules only once they decline. |

## Development — checklist

The procedure is **Development — the flow**; this is the tracker. Tick only what is actually done.
Work top to bottom, one step at a time, in the order listed.
**The field cards seeded in `assessment_abs` are the write contract — yours and every worker's.
The three-check runs at both gates and at finalize, on the reads those steps already make;
never on a fresh read of `references/formatting/assessment-file.md`.**

- [ ] 0. Triage dispatched — bias to `major` when uncertain; `minor` → stop, `major` → open the assessment file
- [ ] 1. Threats generated into `## Threats`, seeded from any prior analysis
- [ ] 2. Threat critique dispatched AND org rules retrieved by YOU in ONE block — one revision at most, then threats frozen; sidecar written, or none
- [ ] 3. Risk scored — five scoring fields per threat plus the plan-level residual; ids untouched
- [ ] 4. Gate 1 — slice three-checked, table displayed FIRST, then one window per threat; `Selection` recorded (zero selected ends the review)
- [ ] 5. Mitigations generated for the selected threats ONLY, grounded in the sidecar; generator ran without a shell of its own
- [ ] 6. Single mitigation critique pass done — approved, or one revision applied; mitigations frozen
- [ ] 7. Gate 2 — slice three-checked, table displayed FIRST, then one window per mitigation; `Selection` recorded
- [ ] Finalize — `Latest stage: development` set, critique sections deleted, sidecar + cards kept, file three-checked, plan file links it + Maintenance

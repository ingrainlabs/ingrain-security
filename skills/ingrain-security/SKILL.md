---
name: ingrain-security
description: >-
  Use at BOTH ends of a security-relevant change; it detects which phase to run from
  repo state, so invoke it at either moment. Each phase owns one moment: Development runs
  before code for the task exists, Testing after it.
  **Development — plan review:** run AS THE FINAL STEP of building an implementation plan,
  ad-hoc inline or in a formal plan-mode / design-doc session. Invoke once the plan is
  comprehensive and detailed (affected files, concrete implementations, tests) but
  before you present it or write any code. It triages the change and folds selected
  threats and adopted mitigations back into the plan you produce.
  **Testing — verification:** run AFTER you have implemented code for that plan, but
  before you present or commit it. It measures how robust the applied mitigations are
  by negative testing: for each threat the plan selected, it checks the branch diff —
  everything committed and uncommitted since this branch diverged from its parent — to
  see whether that threat can still be realized in the code as built. The threats
  define the scope. It reports each threat's robustness and, for any still reachable,
  the residual path an attacker would take. It reports; the coding agent implements.
  If there is even a 1% chance the change touches security, invoke it — triage decides
  whether a full review is warranted.
---

<SUBAGENT-STOP>
If you were dispatched as a worker subagent (ingrain-relevance-triage, ingrain-threat-generator,
ingrain-threat-critic, ingrain-risk-scorer, ingrain-mitigation-generator, ingrain-rule-expander,
ingrain-mitigation-critic, ingrain-threat-verifier), do the one job you were given
and return. The orchestration — Development and Testing alike — is run by the session that
dispatched you; you are one step inside it.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
Security analysis is the FINAL step of planning.
First build your implementation plan in full — the affected files, the concrete
implementations, the tests. The trigger is the *state*: an **ad-hoc plan**
worked out inline and a **formal planning session** (plan mode, a design doc) both reach
the same moment — the plan is comprehensive and detailed, and implementation is still ahead.
Once that state holds, and before you present it or write any code, run this review with
the finished plan as its input, then fold its results back into the plan. It still belongs
to planning: the plan you hand back already reflects it. If there is even a 1% chance the
change touches security, run it — triage is what decides minor vs. major.
</EXTREMELY-IMPORTANT>

## Phase select — do this FIRST

This skill has two phases. **Development — plan review** is the checklist below, and is
everything the `<EXTREMELY-IMPORTANT>` block describes: it runs on a finished plan, before
code. **Testing — verification** (`references/testing/verification-pass.md`) runs on the code that
plan produced. Decide which one you are in **from repo state, before anything else** — the
two shell calls below are the whole basis for that decision.

**If the user named a phase, that is the answer.** "Verify the mitigations" → **Testing**.
"Review this plan" → **Development**. Skip the table.

Otherwise resolve the state with **two cheap shell calls**. The first is **the mint call you
already have to make**: Development mints `assessment_abs` at Step 0 anyway, so run it now, keyed
on this task's title, and read `file_exists` off its JSON — minting resolves the path, ensures
the folder, and seeds the file's empty skeleton if it is not there yet, and is safe in either
phase. **The seeded skeleton does not count as an assessment**: `file_exists` reports written
content, so it stays `false` until a stage actually fills a section, and the table below reads
the same as it always did. The second resolves the **branch delta**.

**Mint the path with the bundled `scripts/assessment-path` script** and reuse its output
everywhere — the script is what resolves it. Your SessionStart context carries the concrete,
ready-to-run command (plugin root and host already substituted); it takes the form:

    bash <plugin>/skills/ingrain-security/scripts/assessment-path <host> mint --title "<task title>"

Use its **`assessment_abs`** — the **absolute** path — verbatim as the write target for
every worker dispatch, every Write/Edit, and at finalize, and obey the `instruction` field
it carries. The relative `assessment_path` is a **display form** only: put it in prose,
tables and plan-file links; every write target takes the absolute form.
→ `references/formatting/assessment-file.md` owns what the script resolves, the name's derivation, and
the file's schema — read it before your first write.

**Every write to `assessment_abs` is followed by a validation run** — yours and every worker's
alike. Run the bundled `scripts/validate-assessment` script on the path you just wrote, with
`--lenient` while the run is in progress and **without it at finalize**, and fix what it
reports before the next step. The ready-to-run command is in your
`INGRAIN-ASSESSMENT-PATHS` session context.
→ `references/formatting/assessment-file.md` § **Validation — run it after every write** owns the
two modes, the exit codes and the bounded fix-and-re-run rule.

The third signal is the **branch delta**. Resolve it with the bundled `scripts/branch-diff`
script and read **`delta_empty`** off its JSON: `true` means the branch delta is empty; `false`
means this branch has commits since the fork point, an uncommitted change, or both. **Keep its
`base_ref`, `diff_ref` and `fallback`** — Testing diffs against exactly that `diff_ref`.
→ `references/lib/branch-diff.md` owns the script, the refs it returns, and why `delta_empty` —
rather than `git status` — is the routing signal; read it before routing on the delta.

If `file_exists: true`, read the bounded `## Mitigations` slice of that file (the bounded
read the context-window discipline permits). Then:

| `file_exists` | `selected` mitigation rows | branch delta | Phase |
|---|---|---|---|
| `false` | — | anything | **Development** — no assessment for this task, so it starts at triage |
| `true` | none | anything | **Development** — resume this task's analysis in place (Step 0's `file_exists: true`) |
| `true` | 1+ | empty (`delta_empty: true`) | **Development** — the plan was reviewed; implementation is still ahead |
| `true` | 1+ | non-empty (`delta_empty: false`) | **Testing** — read `references/testing/verification-pass.md` NOW |

**Testing requires all three: an assessment for THIS task, adopted mitigations in it, and a
non-empty branch delta.** Anything else is Development. Three signals look like Testing but
route elsewhere; here is what each actually means:

- **Testing needs all three signals together; a branch delta alone routes to Development.** A
  fresh task on a branch that already carries unrelated commits, or unrelated WIP, mints a fresh
  path → `file_exists: false` → row 1 → **Development**.
  **Let the mint answer the question.** It is keyed on branch **+ task title**, and that
  keying is what binds each assessment to exactly one task — so a glob over
  `.ingrain-security/` would surface some *other* task's file. Take `file_exists` at its word.
- **`Latest stage: testing` records that a verification ran.** The task stays open, and a later
  code change earns another round. An
  assessment already at `Latest stage: testing` whose branch delta has grown again — the user revised
  the code after a verification round — is **Testing again**: re-test every selected threat and
  overwrite the `Robustness` and `Justification` columns.
  Re-verification is driven by the code, which changed; the plan is unchanged, so Testing is
  the phase that runs again.
- **A `minor` triage lands on row 2** — its scope holds no mitigations to verify. If
  the user explicitly asked to verify, the override sends you to Testing, which stops at "no
  adopted mitigations to verify" — the correct, cheap answer. Otherwise row 2 resumes Development,
  where triage re-confirms `minor` in one dispatch and stops. Either way the run ends at triage,
  which is the right outcome for a minor change.

Announce the phase you picked in your opening line, so a misroute costs the user one turn.

# Security review loop

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate seven worker roles, each defined by a reference file at
`references/development/<name>.md` (`ingrain-relevance-triage`, `ingrain-threat-generator`,
`ingrain-threat-critic`, `ingrain-risk-scorer`, `ingrain-mitigation-generator`,
`ingrain-rule-expander`, `ingrain-mitigation-critic`). You dispatch each as a fresh subagent,
in order, holding the state between steps yourself — all coordination flows through you.
One step is yours alone: Step 5, where you run the org-rules retrieval **in this session**.

The process produces exactly **two things**: the **assessment file** (the hand-off medium
the workers write section by section, and you finalize) and the **user-selected finding set
folded into the plan** at Gate 1 and Gate 2.

**Context-window discipline:** hold only the compact statuses and pointers workers return,
and read a bounded slice of the assessment file at the two gates and at finalize — those
bounded reads are the whole of what the analysis costs your context. The file is the shared
state, so you move data between workers by pointing them at its sections and letting each one
read for itself.

**The one carve-out is Step 5.** Retrieving the org rules yourself means the CLI's rule bodies
land in your context, because you are the one writing them into the sidecar. That is
deliberate and it is the *only* bulk payload you handle directly. Write the rules straight
through to the sidecar and then work from the sidecar's path, not from what you read — every
later step (the generator, the expander, the critic, Gate 2) reads that file for itself.
Carry the sidecar's **path** forward into each dispatch and let its readers open it; your copy
of the bodies has done its work the moment they are on disk.

## How to dispatch a worker

A worker is a role a fresh subagent adopts by reading its reference file. Dispatch a **fresh
worker subagent** and tell it to become that worker; the reference file is its logic.
→ `references/development/dispatch.md` maps this onto your host (subagent/task primitive, or
the sequential in-context fallback where none exists) — read it if you are unsure which
primitive to use.

Dispatch every worker with the same shape — restate its write target inline, because that path
is per-run and the worker has no other way to learn it:

```
Read references/development/<name>.md and follow it as your system prompt.
Your ONE permitted write is your own section of the stored analysis file for this run at
<the minted assessment_abs — the ABSOLUTE path, pasted in full> (section: <## Section for this worker>),
written to the schema in references/formatting/assessment-file.md — use exactly its fields and
enum values. Write to that exact absolute path, character for character as pasted
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
`approved`/`needs-revision`), and pass the **next** worker a pointer to the sections it must
read.

**Validate on every return, before you dispatch the next worker.** The worker wrote the file;
you are the one who can check it, because the shell is yours alone — run
`scripts/validate-assessment` with `--lenient` on `assessment_abs` after every worker that
wrote it, and fix what it reports. A malformed section is cheapest to repair here, while the worker that produced it can
still be re-dispatched with the violations quoted back to it, and while it is still upstream of
the next worker, which reads the file for itself.

**Model:** set each worker's model from the **Recommended model** line in its own reference
file. You stay on the session model. Host-dependent — ignore where per-subagent model
selection is unsupported.

## How to ask the user

Gate 1 and Gate 2 are **per-finding selection gates** — the user includes or excludes each
finding individually and may select any subset, **including none**. Always in **two distinct
steps, in this order**:

1. **Display the findings as a Markdown table** — one row per finding, columns per the gate
   step. The table is where the detail lives, so the user can read and compare every finding
   in one place before deciding. **Mandatory in every mode and on every host** — plan mode,
   ad-hoc, windowed or fallback alike. It is **visible output in the conversation**, printed
   there on top of whatever the plan and assessment files record: printing it is a read-only
   display action, permitted in every mode.
2. **Then present the selection windows** — one single-choice include/exclude window per
   finding, labeled by tag + short title (e.g. `T1 — unauthenticated token refresh`). One
   window, one finding, one binary choice keeps every decision isolated and deliberate, so
   each finding stays a distinct choice of its own. Mark
   high/critical findings recommended. Because each window is its own decision, **selecting
   none is always reachable** — the user excludes every window.
   → `references/development/dispatch.md` § Selection windows for the host mechanism and the
   batching rule where a host caps how many windows it can show at once.

**Keep every finding a decision of its own: one table row, one window, one binary choice.**
The table comes first and the windows second; each window's options reference the table by
finding tag, leaving the detail where the user can compare it side by side.

## Development — the flow

Each step is one dispatch; you hold the state between them. The tracker for these steps is
**Development — checklist** at the end of this file.

0. **Triage** — dispatch `ingrain-relevance-triage` with the plan, the resolved
   `branch_slug` (or `unknown`), the task title, and the **absolute**
   `<project_root>/.ingrain-security/` folder from the mint JSON (a relative folder silently
   matches nothing, and it would wrongly report `none`). It checks for a prior analysis of
   this task before it classifies.
   → `references/development/ingrain-relevance-triage.md` defines what it does; you only branch on its
   keyword.
   - `minor` → state "no security review needed — minor change" and **STOP**. For a minor
     change, triage is the whole pipeline; carry on building the plan.
   - `major` → keep its **Surfaces** notes and any **Prior analysis pointer** for Step 1, then
     **open the assessment file** at `assessment_abs` — the mint already seeded it with its
     title, banner and every empty section, so fill the `## Task` fields in place rather than
     writing the page over (`file_exists: true` means you are resuming this task's prior
     analysis).
     The worker's `## Triage` section is already in it. Then **validate it** (`--lenient` — the
     file is a skeleton at this point, which is exactly what that mode is for).

1. **Threats** — dispatch `ingrain-threat-generator`, pointing it at the plan **and the
   `## Triage` section** (Surfaces seed the search; extend beyond them). **If triage returned a
   Prior analysis pointer**, also point it at that snapshot's `## Threats` and `## Mitigations`
   so it **seeds from the prior analysis** — re-derive and refresh it against the current plan. It writes the `## Threats` rows under working tags `T1…` and returns a
   pointer. Its tags record discovery order; the risk-scorer assigns priority at Step 3.

2. **Critique threats** *(single round)* — dispatch `ingrain-threat-critic` at `## Threats`.
   - `needs-revision` → re-dispatch `ingrain-threat-generator` **once**, with a pointer to
     `## Threats` + `## Threat critique`, then **freeze** the threats. That single revision
     closes the loop.
   - `approved` → **freeze** the threats.
   - Either way, surface anything the critique left unresolved.

3. **Risk score** — dispatch `ingrain-risk-scorer` at the frozen `## Threats`. It fills each
   row's scoring columns, writes the plan-level residual into `## Risk score`, and **re-tags
   the threats into descending-risk order** — contiguous `T1…Tn`, `T1` the most critical. From
   here the tag *is* the priority and every stage reads the table top-down. (The re-tag belongs
   to the scorer's job.)

4. **Gate 1 — the user selects which threats to address.** Follow **How to ask the user**.
   The user is deciding per threat whether it is worth acting on, so they must understand each
   threat without re-reading the plan. In order:

   1. **Read** the bounded `## Threats` slice — this read is **required**, and it is exactly
      the read the context-window discipline permits. If the slice is empty or its scoring
      columns are unfilled, stop and re-dispatch `ingrain-risk-scorer` (or
      `ingrain-threat-generator` where the rows themselves are missing); the gate resumes once
      the table has content to show.
   2. **Display** the scored threats as a Markdown table in the conversation, **in tag order
      (`T1` first)**, with the columns below.
   3. **Present** one single-choice window per threat; mark high/critical recommended.
   4. **Record** each threat's `Selection` in `## Threats` (include → `selected`, exclude →
      `excluded`; `undecided` only if the user is explicitly unsure), then **validate**
      (`--lenient`) — a mistyped `Selection` here silently drops a threat from Testing's scope.

   | Column | Contents |
   |--------|----------|
   | **Threat** | tag + short title (e.g. `T1 — unauthenticated token refresh`) |
   | **Risk** | risk criticality + 0–100 score (e.g. `high · 78`) |
   | **What can go wrong** | the concrete failure, drawn from the threat's Vector/Description and stated in this change's terms |
   | **Why it matters** | the consequence if realized, grounded in the scorer's impact and score (what an attacker gains, what data or guarantee is lost) |
   | **Local impact in the plan** | which specific part of *this* change the threat lands on (the component, file, or step from the plan) |

   Keep the table faithful to the frozen threats and scores — every cell traces back to a row
   the workers wrote. Flag high/critical rows (e.g. `⚑ high · 78`) so the table and the windows tell the
   same story. In the same message, **name the run's assessment file** (its relative
   `.ingrain-security/assessment-<branch-slug>-<task-slug>.md` path) and **the plan file**
   these decisions feed into — a **mention only**; the plan-file write happens at finalize.

   - **1–N selected** → only those proceed to Step 5. Name the excluded ones in one line
     ("T2, T5 excluded — risk accepted").
   - **None selected** → skip Steps 5–9. State "no threats selected — review closed", close
     with a one-line verdict naming the threats as accepted risk, then **go to Finalize** — the
     all-`excluded` `## Threats` section is the preserved context. Then continue building the
     plan.

5. **Retrieve org rules** — **you run this yourself, in this session; there is no worker.**
   The org's security rules are ingested knowledge — how *this* team implements auth,
   validation, secrets, crypto — retrieved by semantic search over the `ingrain` CLI. This
   first pass is driven by the plan and the selected threats, because no mitigation exists
   yet; Step 7 runs a second pass once one does.
   1. Mint `rules_abs` with the `rules-path` command from your `INGRAIN-ASSESSMENT-PATHS`
      session context, exactly as you minted `assessment_abs`.
   2. Probe that the CLI is available.
   3. From the plan and the selected threats, reason about which security features need org
      guidance (e.g. "how do we authenticate service-to-service calls"), and run one query
      per distinct question.
   4. Write the returned rules — id, title, and **full body verbatim** — into the sidecar's
      `## Retrieved rules` at `rules_abs`. Cite exactly what came back — id, title and body as
      the CLI returned them. Where nothing was retrieved, the sidecar stays unwritten.
   → `references/lib/ingrain-cli.md` owns the probe, the query command and its flags, the
   returned shape, and how to classify a failure.
   → `references/formatting/rules-file.md` owns the sidecar's schema and lifecycle.
   - **Sandbox or permission denial** → you are in the main session, so the host's native
     "allow this command?" prompt reaches the user directly. **Treat the denial as
     recoverable:** re-run so the prompt surfaces, and carry on without rules once the user
     **declines** (or where no permission channel exists), noting that access was declined.
   - **Genuine unavailability** — binary absent, CLI unconfigured, or no matches — degrades
     gracefully: leave the sidecar unwritten, note why in one line, carry on. A
     `command not found` probe settles Step 7 too — the expander reaches the same CLI, so that
     step is skipped.

6. **Mitigate** — dispatch `ingrain-mitigation-generator` with the **user-selected threats
   only** (excluded threats are out of scope), `assessment_abs`, and `rules_abs` — pointing it
   at the sidecar's `## Retrieved rules` so it grounds its proposals in established org
   practice. It proposes both **threat mitigations** and
   **general implementation instructions** for the full scoped task — both belong in the plan.
   It writes the mitigation rows and the sidecar's `## Per-mitigation mapping`, and works from
   the rules already on disk — it has no CLI of its own.

7. **Expand rules** — dispatch `ingrain-rule-expander` at the `## Mitigations` table and the
   sidecar, with `rules_abs` as its write target. Step 5 queried from the threats; now that
   concrete mitigations name concrete mechanisms, it searches on those mechanisms and
   **appends** what it finds to the sidecar.
   **This is the one worker that gets the shell/exec tool** — dispatch it with Bash/exec in
   addition to its file tools, and say so in its dispatch. No other worker gets a shell.
   **It runs exactly once**, before the Step 8 loop — the critic is what carries its findings
   into the mitigations. Skip this
   step entirely if Step 5's probe reported the CLI absent, and say so when you do.
   → `references/development/ingrain-rule-expander.md` owns the lookup and its failure modes.
   - `fetch blocked — permission needed` → the lookup was denied by the sandbox and the worker
     could not surface a prompt itself. Ask the user for access using the same window
     primitive the gates use, and on grant **re-dispatch with exec access** — this recovery
     re-run completes the one expansion pass. Only if the user **declines** (or no permission channel
     exists) do you continue with Step 5's rules alone, noting that access was declined.

8. **Critique mitigations** *(single round)* — dispatch `ingrain-mitigation-critic` at
   `## Mitigations` **and the expanded `rules-<…>.md` sidecar**, so it can judge the
   mitigations against the rules they cite *and* against the rules Step 7 added. A rule the
   expander found that no mitigation applies is exactly the gap this critic reports.
   - `needs-revision` → re-dispatch `ingrain-mitigation-generator` **once** (the generator
     alone; the expander has already had its single pass), then **freeze** the mitigations.
     That single revision closes the loop.
   - `approved` → **freeze** the mitigations.
   - Either way, surface anything the critique left unresolved.

9. **Gate 2 — the user selects which mitigations to adopt.** Follow **How to ask the user**.
   In order:

   1. **Read** the bounded `## Mitigations` slice, and the `rules-<…>.md` sidecar to resolve
      rule titles.
   2. **Display** the frozen mitigations as a Markdown table in the conversation, **in tag
      order (`M1` first)**, with the columns below.
   3. **Present** one single-choice window per mitigation, labeled by short title + the threat
      tag(s) it addresses (or `general`).
   4. **Record** each mitigation's `Selection` in `## Mitigations` (adopt → `selected`, decline
      → `excluded`), then **validate** (`--lenient`).

   | Column | Contents |
   |--------|----------|
   | **Mitigation** | short title of the proposed mitigation |
   | **Addresses** | the threat tag(s) it covers (`T1`, `T3`, …), or `— (general)` for a general implementation instruction |
   | **What it does** | the task-specific guidance, from the mitigation's Description |
   | **Yield** | the risk it removes over the current baseline |
   | **Effort** | how much work it takes to implement |
   | **Follows rules** | the **title(s)** of the org rule(s) it follows, resolved from that mitigation's entry in the sidecar (e.g. `Authenticated service calls`); `—` for a pure threat mitigation |

   Keep the table faithful to the frozen mitigations — every cell traces back to a row the
   generator wrote. For each id in a mitigation's **Rule refs**, take the title from its
   `### <id> — <title>` entry in the sidecar. **Print rule titles** — the ids are
   machine-facing and stay in the file. Where an id has no matching sidecar entry (or no
   sidecar exists), print the mitigation's rule count (e.g. `2 org rules`).

   - **1–N selected** → incorporate exactly those. If the selection leaves a `selected` threat
     with no covering mitigation, **say so in the closing verdict**.
   - **None selected** → incorporate nothing; record the selected threats as accepted risk in
     the closing verdict.
   - Then **go to Finalize**. This is the last step — close with a one-line verdict.

## The plan file

The review folds its results into **the plan file** — the implementation plan the coding
agent edits and executes downstream. This is **distinct from the assessment file**: the
assessment file is the security-analysis artifact the workers write; the plan file is the
implementation plan the selected threats and adopted mitigations become part of.

In **plan mode** it is a concrete on-disk file (e.g. `.${coding_agent_root}/plans/<name>.md`);
you already hold its path, since it is the file you are editing — **name it** when you
reference it. In **ad-hoc mode** the plan file is "the inline plan you are building" in the
conversation.

## Finalize

Reached from Gate 1 (none selected) or Gate 2. Two writes:

**1. Finalize the assessment file in place.** Fill `## Coverage / open items` with any
`selected` threat left without a `selected` covering mitigation, and set `## Task` →
`Latest stage: development` — the plan review is the Development phase, and Testing is what
later advances the field to `testing`. Then **delete the two
transient sections — `## Threat critique` and `## Mitigation critique`** (heading and body):
they are iteration scratch, and the finalized file carries only end results. **Leave the
`rules-<…>.md` sidecar in place** — it is a persistent, linked artifact that the Testing
verification pass reads in a later session. One write, to the minted `assessment_abs`; the
file already lives at its final path, so **finalizing it in place *is* persisting it**.

Then **validate it strictly — no `--lenient`**: this is the finished file, and the file is
finalized only once the script comes back clean. Validate the `rules-<…>.md` sidecar the same
way when one was written. Fix and re-run per the bounded rule
(`references/formatting/assessment-file.md` § **Validation — run it after every write**); if
anything survives two attempts, name it in your closing verdict so the user hears it in the
same turn. Everything downstream — the plan file's link, the implementing agent, the Testing
pass in a later session — has this file and nothing else; the run that wrote it is gone by then.

**2. Write the results into the plan file.** Incorporate the selected threats and adopted
mitigations, plus two supporting things:

- **A link to the assessment file** — use the **relative** `assessment_path` here, because a
  plan file outlives the absolute path and stays valid after a clone or move. Note that it is
  git-ignored by default (share it with `git add -f <file>`). **When a `rules-<…>.md` sidecar
  was written, link its relative `rules_path` too.**
- **The Maintenance instruction** — tell the implementing agent to keep the assessment file
  **in sync** as the implementation changes across iteration loops, and to locate it by
  **re-running the `assessment-path` mint command** from its `INGRAIN-ASSESSMENT-PATHS`
  session context and writing to the `assessment_abs` it returns. Point it at the mint
  command rather than the relative link: that agent runs in a later session with no project
  root in view, so a relative path would resolve against whatever file it is editing and
  create a stray `.ingrain-security/` folder there. Re-minting is deterministic in
  branch + title, so it resolves to the same file.

In plan mode, **name the plan file you write to**; ad-hoc, this is the inline plan you are
building. The adopted mitigations are now part of the plan the coding agent implements —
incorporate them and continue planning.

## Testing — verification

Testing measures how robust the adopted mitigations are, by **negative testing**: for each
threat Gate 1 selected, can it still be realized in the code as built? The threats define the
scope. It fires when
**Phase select** lands on Testing — an assessment for this task exists, it carries `selected`
mitigations, and the branch delta is non-empty (`scripts/branch-diff` → `delta_empty: false`).
**Everything above this line belongs to Development:** Steps 0–9, both gates, the critique
steps, and the org-rules CLI lookup.

**Read `references/testing/verification-pass.md` NOW and follow it.** The full loop lives
there; this section is a pointer, and the procedure is in that file.

## Rules that are easy to miss

| Situation | Do this |
|-----------|---------|
| The change looks trivial | Run triage — it makes the minor/major call. |
| The plan is finished and ready to present | Run the review now, on the finished plan and before you present it or write code, then fold the results in. It is the final planning step. |
| You have a rough sketch of the plan | Finish the plan to full detail first, then review it — detailed input is what yields specific threats. |
| The review surfaced threats and mitigations | Incorporate the selected threats and adopted mitigations into the plan you present. |
| You are ready to score risk | Score once the threats are frozen — Step 2 freezes them, Step 3 scores them. |
| The user selected zero threats at Gate 1 | Close the review there: record the threats as accepted risk and go to Finalize. |
| You are opening a gate | Present it as a per-finding selection — one single-choice include/exclude window per finding, each decided on its own (zero selected is a valid outcome). |
| The user excluded T2, but it looks important | Record it as accepted risk and move on — the selected subset is the scope. |
| The critic flagged issues | Re-run the generator once with the feedback, then freeze. |
| You have the revised set in hand | Freeze it and surface whatever is unresolved — each step gets exactly one critique pass. |
| A worker's job looks quick enough to do yourself | Dispatch it: each worker runs in its own subagent. |
| You want to know where the run stands | Work from the compact statuses workers return; the bounded gate slices and finalize are the reads available to you. |
| You are naming the assessment file to a worker | Pass the absolute `assessment_abs`. A worker has no project root in view, so a relative path resolves against the file it was reading and creates a stray folder there. |
| `.ingrain-security/` appears to be missing | Re-run the mint script and use the path it returns — the script created the folder at the repo root, and it self-ignores, so `git status` stays silent about it. A missing folder means the path was resolved somewhere else. |
| You are deleting the scratch sections at finalize | Delete the two critique sections and keep the `rules-<…>.md` sidecar — it is a **persistent** linked artifact the Testing verification pass reads later. |
| No org rules came back | Leave the sidecar unwritten. Its absence is the signal, and Gate 2 and verification work from the Descriptions. |
| The `ingrain` CLI errored or is unconfigured | Carry on without rules at Step 5 and Step 7 alike, note why in one line, and still propose mitigations — genuine unavailability (binary absent, unconfigured, no matches) degrades gracefully. |
| The `ingrain` fetch was blocked by the sandbox | Recover it: at Step 5 you are in the main session, so re-run and let the host's native prompt reach the user; at Step 7 the worker returns `fetch blocked — permission needed`, so prompt and re-dispatch. Continue without rules once the user declines. |
| The mitigation-generator is missing a rule | Rely on the two retrieval passes around it — Step 5 retrieves before it runs, Step 7 expands after — and on a revision round it re-reads the completed sidecar. The generator works from disk. |
| The expander found new rules | Let the critic carry them in: it flags an unapplied rule, the generator revises, and the expander's single pass stands. (A re-run after a permission block is a recovery of that same pass.) |
| You need a rule to back a mitigation | Cite exactly the rules `ingrain context` returned, by their real ids. |
| A worker's section looks correct | Run `scripts/validate-assessment` on it anyway (`--lenient` mid-run, strict at finalize) — the schema is what the next reader depends on, and an enum typo stays invisible until it breaks in a later session. |
| The validator still fails after your fixes | Fix what it names, re-run at most twice, and **say so in one line** naming the remaining violations — the user learns of it in the same turn. |
| You are about to present a gate | Display the findings as a table first, then present the single-choice windows. |
| A write to `.ingrain-security/` is held back in plan mode | Ask the user to allow writes to that folder — name in one line which file the run needs to write and why — then retry the same write to `assessment_abs` / `rules_abs` and carry on. The folder is the run's own artifact store, separate from the plan file. |
| You are in plan mode or keeping output lean | Print the gate table all the same — it is mandatory visible output in every mode. Read the bounded slice of the assessment file, which is the read the context-window discipline permits, and print the table before any window. |

## Development — checklist

The procedure is **Development — the flow**; this is the tracker. Tick only what is actually
done. Work top to bottom, one step at a time, in the order listed. (The
`ingrain-risk-scorer` re-tagging threats into risk order at step 3 belongs to its job.) Each
gate incorporates exactly the selected subset.
**After every write to `assessment_abs` — yours, or a worker's the moment it returns — run
`scripts/validate-assessment` (`--lenient` until finalize) and fix what it reports.**

- [ ] 0. Triage dispatched — bias to `major` when uncertain; `minor` → stop, `major` → open the assessment file
- [ ] 1. Threats generated into `## Threats`, seeded from any prior analysis
- [ ] 2. Single threat critique pass done — approved, or one revision applied; threats frozen
- [ ] 3. Risk scored; threats re-tagged into descending-risk order
- [ ] 4. Gate 1 — table displayed in the conversation FIRST, then one window per threat; `Selection` recorded (zero selected ends the review)
- [ ] 5. Org rules retrieved by YOU via the `ingrain` CLI, from plan + selected threats; sidecar written (or none, if nothing came back)
- [ ] 6. Mitigations generated for the selected threats ONLY, grounded in the sidecar; generator ran without a shell of its own
- [ ] 7. Rule expander dispatched ONCE — second pass keyed on the mitigations; appended to the sidecar (skipped only if the CLI is absent)
- [ ] 8. Single mitigation critique pass done — approved, or one revision applied; only the generator re-dispatched; mitigations frozen
- [ ] 9. Gate 2 — table displayed FIRST, then one window per mitigation; `Selection` recorded
- [ ] Finalize — `Latest stage: development` set, critique sections deleted, sidecar kept, assessment validated strictly, plan file links it + Maintenance

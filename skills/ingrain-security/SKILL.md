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
and return. Do NOT run this orchestration — neither Development nor Testing — you are part of it.
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
change touches security, run it — triage decides minor vs. major, you do not pre-judge it
away.
</EXTREMELY-IMPORTANT>

## Phase select — do this FIRST

This skill has two phases. **Development — plan review** is the checklist below, and is
everything the `<EXTREMELY-IMPORTANT>` block describes: it runs on a finished plan, before
code. **Testing — verification** (`references/testing/verification-pass.md`) runs on the code that
plan produced. Decide which one you are in **from repo state, before anything else** — never
from a guess about what the user meant, and never by reading ahead into the checklist.

**If the user named a phase, that is the answer.** "Verify the mitigations" → **Testing**.
"Review this plan" → **Development**. Skip the table.

Otherwise resolve the state with **two cheap shell calls**. The first is **the mint call you
already have to make**: Development mints `assessment_abs` at Step 0 anyway, so run it now, keyed
on this task's title, and read `file_exists` off its JSON — minting only resolves the path and
ensures the folder, and is safe in either phase. The second resolves the **branch delta**.

**Do not hand-build the path.** Mint it with the bundled `scripts/assessment-path` script
and reuse its output everywhere. Your SessionStart context carries the concrete,
ready-to-run command (plugin root and host already substituted); it takes the form:

    bash <plugin>/skills/ingrain-security/scripts/assessment-path <host> mint --title "<task title>"

Use its **`assessment_abs`** — the **absolute** path — verbatim as the write target for
every worker dispatch, every Write/Edit, and at finalize, and obey the `instruction` field
it carries. The relative `assessment_path` is a **display form** only: put it in prose,
tables and plan-file links, never in a write target.
→ `references/formatting/assessment-file.md` owns what the script resolves, the name's derivation, and
the file's schema — read it before your first write.

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
  **Do not glob `.ingrain-security/` for "some assessment on this branch."** The mint is keyed
  on branch **+ task title**, and that keying is what binds each assessment to exactly one
  task. Take `file_exists` at its word.
- **`Latest stage: testing` records that a verification ran.** The task stays open, and a later
  code change earns another round. An
  assessment already at `Latest stage: testing` whose branch delta has grown again — the user revised
  the code after a verification round — is **Testing again**: re-test every selected threat and
  overwrite the `Robustness` and `Justification` columns.
  Re-verification is driven by the code, which changed; the plan is unchanged. Never re-run
  Development to "re-review" it.
- **A `minor` triage lands on row 2** — its scope holds no mitigations to verify. If
  the user explicitly asked to verify, the override sends you to Testing, which stops at "no
  adopted mitigations to verify" — the correct, cheap answer. Otherwise row 2 resumes Development,
  where triage re-confirms `minor` in one dispatch and stops. Either way the run ends at triage,
  which is the right outcome for a minor change.

Announce the phase you picked in your opening line, so a misroute costs the user one turn.

# Security review loop

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate seven **read-only** worker roles, each defined by a reference file at
`references/development/<name>.md` (`ingrain-relevance-triage`, `ingrain-threat-generator`,
`ingrain-threat-critic`, `ingrain-risk-scorer`, `ingrain-mitigation-generator`,
`ingrain-rule-expander`, `ingrain-mitigation-critic`). You dispatch each as a fresh subagent,
in order, holding the state between steps yourself — all coordination flows through you.
One step is yours alone: Step 5, where you run the org-rules retrieval **in this session**.

The process produces exactly **two things**: the **assessment file** (the hand-off medium
the workers write section by section, and you finalize) and the **user-selected finding set
folded into the plan** at Gate 1 and Gate 2.

**Context-window discipline:** do **not** read the full running analysis into your own
context. Hold only the compact statuses and pointers workers return; read a bounded slice of
the assessment file only at the two gates and at finalize. The file is the shared state — you
move data between workers by pointing them at its sections, never by pasting a prior worker's
output into the next dispatch.

**The one carve-out is Step 5.** Retrieving the org rules yourself means the CLI's rule bodies
land in your context, because you are the one writing them into the sidecar. That is
deliberate and it is the *only* bulk payload you handle directly. Write the rules straight
through to the sidecar and then work from the sidecar's path, not from what you read — every
later step (the generator, the expander, the critic, Gate 2) reads that file for itself. Do
not carry rule bodies forward into a dispatch, and do not re-read the sidecar in full
afterwards.

## How to dispatch a worker

A worker is a role a fresh subagent adopts by reading its reference file. Dispatch a **fresh
worker subagent** and tell it to become that worker; the reference file is its logic.
→ `references/development/dispatch.md` maps this onto your host (subagent/task primitive, or
the sequential in-context fallback where none exists) — read it if you are unsure which
primitive to use.

Dispatch every worker with the same shape — restate the read-only constraint inline, because
on hosts without tool-level enforcement it is the only thing enforcing it:

```
Read references/development/<name>.md and follow it as your system prompt.
You do no code or repo edits — use only Read/Grep/Glob on the codebase. Your ONE
permitted write is your own section of the stored analysis file for this run at
<the minted assessment_abs — the ABSOLUTE path, pasted in full> (section: <## Section for this worker>),
written to the schema in references/assessment-file.md — use exactly its fields and
enum values. Write to that exact absolute path: never shorten it, never resolve it
against a file you happen to be reading, and never create an ingrain-security/ folder
yourself — the one for this repo already exists.
Scope tightly: include only findings genuinely relevant to THIS plan — if an item
would not change how this specific change is reviewed or implemented, omit it.
INPUT:
<the finished, detailed implementation plan; plus POINTERS to the sections this
worker must read — e.g. "read <the run's assessment file> § Threats and
§ Threat critique" — on revision rounds, the pointer to the prior draft's section +
the critic's itemized feedback>
Write your full Output into your section of the assessment file, then RETURN ONLY:
your branch keyword (minor/major, approved/needs-revision) or headline result, plus
a one-line pointer to the section you wrote. Do not return the full output.
```

Branch on the keyword the worker leads its return with (`minor`/`major`,
`approved`/`needs-revision`), and pass the **next** worker a pointer to the sections it must
read.

**Model:** set each worker's model from the **Recommended model** line in its own reference
file. You stay on the session model. Host-dependent — ignore where per-subagent model
selection is unsupported.

**One exception to the read-only constraint:** the `ingrain-mitigation-generator`
is additionally allowed to run the read-only `ingrain context security_rules
"<query>"` CLI lookup to fetch the org's security rules — dispatch it with the
Bash/exec tool available in addition to Read/Grep/Glob, and say so in its
dispatch. It still makes no edits and runs no other commands. **Every other
worker stays strictly Read/Grep/Glob.** If the CLI is genuinely unavailable or
unconfigured, the generator degrades gracefully and proceeds without rules. But a
**sandbox / permission denial is recoverable** — the generator first relies on the
host's native "allow this command?" prompt to the user, and where it cannot surface
one it returns a `fetch blocked — permission needed` signal so **you** ask the user
for access and re-dispatch it (see **On a `fetch blocked` signal** under step 5, and
`references/platform-dispatch.md`).

## Model tiers

1. **Display the findings as a Markdown table** — one row per finding, columns per the gate
   step. The table is where the detail lives, so the user can read and compare every finding
   in one place before deciding. **Mandatory in every mode and on every host** — plan mode,
   ad-hoc, windowed or fallback alike. It is **visible output in the conversation**, never
   only written into the plan or assessment file, and never skipped as "extra output":
   printing it is a read-only display action, permitted in every mode.
2. **Then present the selection windows** — one single-choice include/exclude window per
   finding, labeled by tag + short title (e.g. `T1 — unauthenticated token refresh`). One
   window, one finding, one binary choice keeps every decision isolated and deliberate, so
   each finding stays a distinct choice of its own. Mark
   high/critical findings recommended. Because each window is its own decision, **selecting
   none is always reachable** — the user excludes every window.
   → `references/development/dispatch.md` § Selection windows for the host mechanism and the
   batching rule where a host caps how many windows it can show at once.

**Never collapse a gate into a single yes/no over the whole set, and never fold all findings
into one combined list.** Never fold the information into the window options alone — the
table comes first, the windows second; each window's options reference the table by finding
tag rather than restating its detail.

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
   - `minor` → state "no security review needed — minor change" and **STOP**. Dispatch no
     other worker. There is nothing to fold into the plan — carry on building it.
   - `major` → keep its **Surfaces** notes and any **Prior analysis pointer** for Step 1, then
     **create or open the assessment file** at `assessment_abs` with its title + banner and the
     `## Task` section (`file_exists: true` means you are resuming this task's prior analysis).
     The worker's `## Triage` section is already in it.

1. **Display the information first.** Before asking anything, present the full
   findings to the user as a **Markdown table** — one row per finding, with the
   columns the gate step specifies. The table is where the detail lives, so the
   user can read and compare every finding in one place before deciding.
   **Displaying the table is mandatory in every mode and on every host** — plan
   mode, ad-hoc, windowed or fallback selection alike. It is rendered as
   **visible output in the conversation**, never only written into the plan or
   assessment file, and never skipped as "extra output": printing it is a
   read-only display action that no mode forbids. To build it, **read the
   bounded gate slice of the assessment file** (`## Threats` at Gate 1,
   `## Mitigations` at Gate 2) — this read is **required**, and it is exactly
   the read the context-window discipline permits. If the slice is empty or
   missing, stop and re-dispatch the worker that owns it rather than skipping
   the table or rendering it empty. In the
   same message, **name the plan file** these decisions feed into (in plan mode,
   the active plan-file path, e.g. `.${coding_agent_root}/plans/<name>.md`; ad-hoc, the inline
   plan you are building — see **The plan file**), so the user sees where the
   selected findings will land, **and name the run's assessment file** (its
   `ingrain-security/assessment-<branch-slug>-<task-slug>.md` path) so the user knows the full
   analysis backing the table lives there. These are a **mention only** — nothing is
   written to the plan file at the gates; the write happens at finalize.
2. **Then present the selection windows.** Only after the table is displayed,
   present the findings as **multiple single-choice windows — one window per
   finding** — each a single **include/exclude** decision labeled by its tag +
   short title (e.g. `T1 — unauthenticated token refresh`). One window, one
   finding, one binary choice keeps every decision isolated and deliberate, so
   findings never blur together the way they do in a single multi-toggle list.
   Mark findings the `ingrain-risk-scorer` scored **high or critical** as
   recommended. Where the host caps how many windows it can show at once,
   present them in **consecutive batches in table order** — tags ascend as
   priority descends, so this is `T1, T2, …` (and `M1, M2, …`), most important
   first — and merge the choices. Because each window is its own include/exclude
   decision, **selecting none is always reachable** — the user simply excludes
   every window. This is a generic primitive; do not assume any one platform's
   tool. See `references/platform-dispatch.md` for the per-platform mapping.
   **Never collapse the gate into a single yes/no over the whole set, and never
   fold all findings into one combined list** — one window per finding, and the
   user decides each one.

2. **Critique threats** *(loop, max 3)* — dispatch `ingrain-threat-critic` at `## Threats`.
   - `needs-revision` → re-dispatch `ingrain-threat-generator` with a pointer to `## Threats`
     + `## Threat critique`, and repeat.
   - `approved`, or 3 rounds spent → **freeze** the threats. Surface anything left unresolved.

3. **Risk score** — dispatch `ingrain-risk-scorer` at the frozen `## Threats`. It fills each
   row's scoring columns, writes the plan-level residual into `## Risk score`, and **re-tags
   the threats into descending-risk order** — contiguous `T1…Tn`, `T1` the most critical. From
   here the tag *is* the priority and every stage reads the table top-down. (The re-tag belongs
   to the scorer's job.)

The review persists its analysis to a **single file written directly into
`ingrain-security/`** at the project root — it is both the living working copy the workers
write during the run and its persisted record, so there is **no separate temp file and no
finalize copy**. **Do not hand-build its path.** Mint it once, at the start of the review,
by running the bundled **`scripts/assessment-path`** script and reuse its output
everywhere. Your SessionStart context carries the concrete, ready-to-run command (plugin
root and host already substituted); it takes the form:

    bash <plugin>/skills/ingrain-security/scripts/assessment-path <host> mint --title "<task title>"

The script returns a JSON object. Use its **`assessment_abs`** — the **absolute** path —
verbatim as the file path for every worker dispatch, every Write/Edit, and at finalize, and
obey the `instruction` field it carries. The relative `assessment_path` is a **display form**
only: put it in prose, tables and plan-file links, never in a write target. This distinction
is the whole guard against a stray `ingrain-security/` folder being created next to whatever
file an agent is editing — a relative path is resolved by whoever receives it, and a worker
subagent has no way to know the project root. The script resolves the root from the git repo,
creates the one folder, and hands you the finished absolute path; there is nothing to rebuild.

The path is deterministic in the branch + task:

    <project_root>/ingrain-security/assessment-<branch-slug>-<task-slug>.md

so it doubles as the task's identity — re-reviewing the **same task on the same branch**
resolves to the **same file** (the run resumes/updates it in place; `file_exists: true`
signals this), while a different task or branch gets its own file. This task-slug keying is
**by design how two concurrent tasks on one branch stay isolated**: distinct titles mint
distinct files, so parallel reviews never write over each other — the separation is
structural, not left to a worker's judgement. The `assessment-` prefix
always leads; any unresolvable segment is dropped (no branch → `assessment-<task-slug>.md`;
no title → `assessment-<branch-slug>.md`; both → `assessment.md`). The file is
**git-ignored** (the folder self-ignores), so it stays uncommitted. It is a
**living document** and the **hand-off medium** between workers:
each worker writes its own named section, the orchestrator frames and finalizes it, and the
plan you produce links it and carries the **Maintenance** instruction for the implementing
agent.

**The script resolves the current branch once** and returns it as `branch_slug` (with a
`branch_known` flag). Under the hood it uses `git branch --show-current` (fallback
`git rev-parse --abbrev-ref HEAD`, never `.git/HEAD`), lowercased and reduced to
`[a-z0-9-]`; a detached HEAD or non-git checkout yields an **unknown** branch, which drops
the `<branch-slug>-` segment and tells triage the branch is unknown (see Step 0). Running
the script is the orchestrator's one shell call.

Its **section layout and content template are defined in
`references/assessment-file.md`** — follow that reference exactly, so every enumerated
field (`impact`, `likelihood`, `criticality`, `yield`, `effort`, and the Gate
selection `selected`/`excluded`/`undecided`) uses exactly the values it lists.

## The plan file

The review folds its results into **the plan file** — the implementation plan the
coding agent edits and executes downstream. This is **distinct from the assessment
file**: the assessment file (`ingrain-security/assessment-<branch-slug>-<task-slug>.md`) is the security-analysis
artifact the workers write; the plan file is the implementation plan the selected
threats and adopted mitigations become part of.

In **plan mode** it is a concrete on-disk file (e.g. `.${coding_agent_root}/plans/<name>.md`); you
already hold its path, since it is the file you are editing — **name it** when you
reference it. In **ad-hoc mode** there is no file — the plan file is "the inline plan
you are building" in the conversation. Reference the plan file at both gate displays
(mention only — see **How to ask the user**) and write the results into it at finalize.

## Flow

```mermaid
flowchart TD
    planning([Plan is comprehensive & detailed — final planning step]) --> triage[ingrain-relevance-triage]
    triage --> majorQ{major?}
    majorQ -->|minor| stop([Stop — nothing to fold in; keep planning])
    majorQ -->|major| threatGen[ingrain-threat-generator]

    threatGen --> threatCritic[ingrain-threat-critic]
    threatCritic --> threatsOk{threats ok?}
    threatsOk -->|needs-revision max 3| threatGen
    threatsOk -->|approved| freezeThreats[Freeze threats]

    freezeThreats --> riskScorer[ingrain-risk-scorer]
    riskScorer --> gate1{Gate 1: select threats 0–N}
    gate1 -->|none selected| done([Fold results into the plan; keep planning])
    gate1 -->|1+ selected| mitGen[ingrain-mitigation-generator<br/>+ retrieve org rules via ingrain CLI]

    mitGen --> mitCritic[ingrain-mitigation-critic]
    mitCritic --> mitsOk{mitigations ok?}
    mitsOk -->|needs-revision max 3| mitGen
    mitsOk -->|approved| freezeMits[Freeze mitigations]

    freezeMits --> gate2{Gate 2: select mitigations 0–N}
    gate2 -->|1+ selected → incorporate| done
    gate2 -->|none selected| done
```

Throughout the flow, each worker writes its own section of **the run's assessment
file** (the `assessment_abs` you minted) and you pass the next worker a pointer to the
sections it needs — the file is the shared state, so your own context stays lean.

## Steps — in strict order

0. **Triage** — dispatch the `ingrain-relevance-triage` worker with the plan, **plus the
   resolved `<branch-slug>` (or "unknown") and the task title**. Instruct it to first
   **check for a prior analysis** of this task in the assessment folder — pass it the
   **absolute** folder, `<project_root>/ingrain-security/`, from the mint JSON, so its
   Glob cannot drift (matching on branch + task title — a shared branch may
   hold other concurrent tasks' assessments, so a loose match returns `none`) before it
   classifies — per `references/ingrain-relevance-triage.md`. If it finds a prior snapshot whose
   `## Threats` are non-empty, it returns a **Prior analysis** pointer (path + threat
   count) alongside its verdict; keep that pointer to forward to the generator in Step 1.
   - If the verdict is `minor`: state "no security review needed — minor change"
     and **stop here**. Do not dispatch any other worker; there is nothing to fold
     into the plan — carry on building it.
   - If the verdict is `major`: keep its **Surfaces** notes — you forward them to
     the generator in Step 1 — and continue to run the full cycle. **Create or open the
     assessment file** at the minted `assessment_abs` (see **The assessment file**;
     `file_exists: true` means you are resuming this task's prior analysis) with its title +
     banner and the `## Task` section; the triage worker's `## Triage` section
     (verdict + Surfaces) is now in it. This is the hand-off medium for every step
     that follows — its schema and template live in `references/assessment-file.md`.
1. **Threats** — dispatch the `ingrain-threat-generator` worker, pointing it at the plan
   **and the `## Triage` section** (Surfaces are starting points, not a ceiling).
   **If triage returned a Prior analysis pointer**, also point the generator at that prior
   snapshot's `## Threats` (and `## Mitigations`) so it **seeds from the prior analysis**
   rather than starting from scratch — re-derive and refresh against the current plan, do
   not blindly copy. It writes
   the threat rows (descriptive columns, `T1…`; most tasks warrant 3–6 rows — a target, not a hard cap) into the `## Threats` table per the
   `references/assessment-file.md` schema and returns a pointer.
2. **Critique threats** *(loop, max 3)* — dispatch the `ingrain-threat-critic` worker,
   pointing it at the `## Threats` section. On `needs-revision`, re-dispatch
   `ingrain-threat-generator` with a pointer to `## Threats` + `## Threat critique` and
   repeat. Then **freeze** the threats (the frozen list lives in the `## Threats` section).
3. **Risk score** — dispatch the `ingrain-risk-scorer` worker, pointing it at the frozen
   `## Threats` section. It fills each row's scoring columns (Justification, Impact,
   Likelihood, Risk score 0–100, Criticality) and writes the plan-level residual risk into
   `## Risk score` — per the `references/assessment-file.md` schema.
4. **Ask user — select which threats to address (Gate 1).** Follow the two-step
   display-then-ask pattern (see **How to ask the user**). The user is deciding
   per threat whether it is worth acting on, so they must understand each
   threat without re-reading the plan.

   **First, display the scored threats as a Markdown table in the conversation** —
   always, in every mode (plan mode included) — one row per threat,
   ordered by risk score (highest first), with these columns:

   | Column | Contents |
   |--------|----------|
   | **Threat** | tag + short title (e.g. `T3 — unauthenticated token refresh`) |
   | **Risk** | risk criticality + 0–100 score (e.g. `high · 78`) |
   | **What can go wrong** | the concrete failure, drawn from the threat's Vector/Description and stated in this change's terms |
   | **Why it matters** | the consequence if realized, grounded in the scorer's impact and score (what an attacker gains, what data or guarantee is lost) |
   | **Local impact in the plan** | which specific part of *this* change the threat lands on (the component, file, or step from the plan) |

   Keep the table faithful to the frozen threats and scores — don't invent,
   soften, or re-score. Flag rows whose risk criticality is high or critical (e.g.
   `⚑ high · 78` in the Risk column) — these are the ones you mark recommended
   in the selection windows, so the table and the windows tell the same story.
   In the same message, **name the run's assessment file** (its
   `ingrain-security/assessment-<branch-slug>-<task-slug>.md` path) so the user can open the full
   analysis behind the table, alongside the plan file mention (see **How to ask
   the user**).

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
      `## Retrieved rules` at `rules_abs`. Cite only what came back; never invent a rule or an
      id. Write **no sidecar at all** if nothing was retrieved.
   → `references/lib/ingrain-cli.md` owns the probe, the query command and its flags, the
   returned shape, and how to classify a failure.
   → `references/formatting/rules-file.md` owns the sidecar's schema and lifecycle.
   - **Sandbox or permission denial** → you are in the main session, so the host's native
     "allow this command?" prompt reaches the user directly. **Do not accept the review
     without org rules yet:** re-run so the prompt surfaces, and proceed without rules only
     if the user **declines** (or no permission channel exists), noting that access was
     declined.
   - **Genuine unavailability** — binary absent, CLI unconfigured, or no matches — degrades
     gracefully: skip the sidecar, note why in one line, carry on. A `command not found` probe also
     means **Step 7 is skipped**, since the expander has no CLI to reach either.

   To build the table, read only the bounded `## Threats` slice of the assessment
   file — not the whole running analysis. This read is **required**, not a
   context-discipline violation. Every table cell and every window label comes
   from that slice; if the slice is empty or its scoring columns are unfilled,
   stop and re-dispatch the `ingrain-risk-scorer` (or the `ingrain-threat-generator` if the
   rows themselves are missing) rather than skipping the table or rendering it
   empty. **After the user decides, record each
   threat's `Selection`** in the `## Threats` table (include → `selected`, exclude →
   `excluded`; `undecided` only if the user is explicitly unsure), per the
   `references/assessment-file.md` schema.

   - **1–N selected** — incorporate the selected threats into the plan; only
     they proceed to mitigation. Name the excluded ones in one line (e.g. "T2,
     T5 excluded — risk accepted").
   - **None selected** — incorporate no mitigations, skip Steps 5–7, state "no threats
     selected — review closed" and close with a one-line verdict naming the
     threats as accepted risk. Still **fold the assessment link + maintenance
     instruction into the plan** (the `## Threats` section, with every threat marked
     `excluded`, is the preserved context) and **delete the `## Threat critique`
     section** (iteration scratch). The assessment file already lives at its
     `ingrain-security/assessment-<branch-slug>-<task-slug>.md` path — no snapshot copy is
     needed — so just finalize it in place, then continue building the plan.
5. **Mitigate** — dispatch the `ingrain-mitigation-generator` worker with the
   user-selected threats — only those; excluded threats are out of scope. It proposes
   both **threat mitigations** (covering the selected threats) and **general
   implementation instructions** for the full scoped task that are not tied to a single
   threat — both belong in the mitigation plan. As part
   of this step the generator retrieves the org's **security rules** — authoritative
   guidance on *how to implement* the needed security features — by running
   `ingrain context security_rules "<query>"`, and folds them into its proposals so
   the mitigations reflect established org practice, not just generic advice. If the
   CLI is unavailable or unconfigured it degrades gracefully and proceeds without
   rules. If instead the rule fetch is **blocked by the sandbox / permission layer**,
   the generator asks for access via the host's native prompt or signals back so you
   can prompt and retry (see **On a `fetch blocked` signal** below) — a permission
   denial is not silently dropped. The generator records **compact Rule refs (rule
   ids)** on each mitigation row of `## Mitigations` — persisted and part of the plan,
   but **never shown to the user** — **plus** the fuller rule detail (titles, bodies,
   applicable rules) in the transient `## Org rules` section, where the critic reads it.
   Gate 2 renders each mitigation's rule **titles** from that transient section; it is
   deleted at finalize.

   **On a `fetch blocked` signal.** If the generator returns
   `fetch blocked — permission needed` (its `ingrain context` lookup was denied by the
   sandbox and it could not surface a permission prompt itself), do **not** accept the
   review without org rules yet. **Ask the user for permission** to run the org-rules
   fetch — using the host's selection-window / question primitive, the same one the
   gates use (see **How to ask the user** and `references/platform-dispatch.md` →
   **Selection windows**). On grant, **re-dispatch the `ingrain-mitigation-generator`**
   with exec access granted so the fetch can complete. Only if the user **declines**
   (or no permission channel exists) do you let it proceed with graceful degradation —
   note that no org rules were retrieved because access was declined.
6. **Critique mitigations** *(loop, max 3)* — dispatch the `ingrain-mitigation-critic`
   worker, pointing it at `## Mitigations` **and the transient `## Org rules` section**
   (so it can judge the mitigations against the rules they cite); re-dispatch
   `ingrain-mitigation-generator` on `needs-revision`. Then **freeze** the mitigations.
7. **Ask user — select which mitigations to adopt (Gate 2).** Follow the
   two-step display-then-ask pattern (see **How to ask the user**).

   **First, display the frozen mitigations as a Markdown table in the
   conversation** — always, in every mode (plan mode included) — one row per
   mitigation, with these columns:

   | Column | Contents |
   |--------|----------|
   | **Mitigation** | short title of the proposed mitigation |
   | **Addresses** | the threat tag(s) it covers (`T1`, `T3`, …), or `— (general)` for a general implementation instruction |
   | **What it does** | the task-specific guidance, from the mitigation's Description |
   | **Yield** | the risk it removes over the current baseline |
   | **Effort** | how much work it takes to implement |
   | **Follows rules** | the **title(s)** of the org rule(s) it follows, resolved from that mitigation's entry in the sidecar (e.g. `Authenticated service calls`); `—` for a pure threat mitigation |

   Keep the table faithful to the frozen mitigations — don't invent or re-scope.
   The **Follows rules** column names the rules by **title**: for each id in the
   mitigation's **Rule refs**, take the title from its `M<n> → "<title>" (<id>)` citation
   in `## Org rules`. The rule **ids** stay in the persisted **Rule refs** column of
   `## Mitigations` — machine-facing, never shown to the user. The rule **bodies** stay in
   `## Org rules` and are deleted at finalize. If a **Rule ref** id has no matching
   citation, no title is available: print the mitigation's rule count (e.g. `2 org rules`)
   rather than falling back to the id.

   **Then present one single-choice window per mitigation** asking which
   mitigations to adopt — each window a single include/exclude decision for that
   mitigation, labeled by its short title + the threat tag(s) it addresses (or
   `general` when it addresses no specific threat).
   Where the host caps how many windows show at once, batch them in table order.
   The user may include any subset, including none (exclude every window).

## The plan file

   **Finalize the assessment file in place:** record each mitigation's `Selection` in the
   `## Mitigations` table (adopt → `selected`, decline → `excluded`), and fill
   `## Coverage / open items` with any `selected` threat left without a `selected`
   covering mitigation — per the `references/assessment-file.md` schema. Then
   **delete the three transient sections — `## Threat critique`, `## Mitigation critique`,
   and `## Org rules`** (heading and body) — they are iteration scratch; the finalized
   file carries only end results and matches the schema template. Write to the minted
   `assessment_abs`; the file already lives there, so there is **no snapshot to copy** —
   finalizing it *is* persisting it.

   Then **write the results into the plan file** (see **The plan file**) — the
   implementation plan the coding agent edits and executes. Incorporate the selected
   threats and adopted mitigations, and fold in two supporting things: (1) a link to
   the run's assessment file — use the **relative** `assessment_path` here, because a
   plan file outlives the absolute path and stays valid after a clone or move — noting
   that it is git-ignored by default (share it with `git add -f <file>`); and (2) the
   maintenance instruction — tell the implementing agent to keep that file in sync as
   the implementation changes across iteration loops, and to locate it by **re-running
   the `assessment-path` mint command** from its `INGRAIN-ASSESSMENT-PATHS` session
   context and writing to the `assessment_abs` it returns. Never tell it to write to the
   relative link: that agent runs in a later session with no project root in view, and it
   will resolve the path against whatever file it is editing, creating a stray
   `ingrain-security/` folder there. Re-minting is deterministic in branch + title, so it
   resolves to the same file. In plan mode, **name the plan
   file you write to** (e.g. `.${coding_agent_root}/plans/<name>.md`); ad-hoc, this is the inline
   plan you are building.

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

**2. Write the results into the plan file.** Incorporate the selected threats and adopted
mitigations, plus two supporting things:

- **A link to the assessment file** — use the **relative** `assessment_path` here, because a
  plan file outlives the absolute path and stays valid after a clone or move. Note that it is
  git-ignored by default (share it with `git add -f <file>`). **When a `rules-<…>.md` sidecar
  was written, link its relative `rules_path` too.**
- **The Maintenance instruction** — tell the implementing agent to keep the assessment file
  **in sync** as the implementation changes across iteration loops, and to locate it by
  **re-running the `assessment-path` mint command** from its `INGRAIN-ASSESSMENT-PATHS`
  session context and writing to the `assessment_abs` it returns. Never tell it to write to
  the relative link: that agent runs in a later session with no project root in view, and it
  will resolve the path against whatever file it is editing, creating a stray
  `.ingrain-security/` folder there. Re-minting is deterministic in branch + title, so it
  resolves to the same file.

In plan mode, **name the plan file you write to**; ad-hoc, this is the inline plan you are
building. The adopted mitigations are now part of the plan the coding agent implements —
incorporate them and continue planning.

## Testing — verification

Testing measures how robust the adopted mitigations are, by **negative testing**: for each
threat Gate 1 selected, can it still be realized in the code as built? The threats define the
scope. It fires when
**Phase select** lands on Testing — an assessment for this task exists, it carries `selected`
mitigations, and the branch delta is non-empty (`scripts/branch-diff` → `delta_empty: false`).
**Everything above this line belongs to Development:** Steps 0–9, both gates, the critic
loops, and the org-rules CLI lookup.

**Read `references/testing/verification-pass.md` NOW and follow it.** The full loop lives
there; this section is a pointer, and the procedure is in that file.

## Red flags — stop if you catch yourself thinking…

| Thought | Reality |
|---------|---------|
| "This change is obviously trivial, skip triage" | Triage decides minor/major, not you. Run it. |
| "The plan's done — I'll present it and run security after" | The review is the final planning step: run it on the finished plan, before you present it or write code, and fold the results in. |
| "I'll run the review on a rough sketch to save a step" | Run it on the comprehensive, detailed plan — vague input yields vague threats. Finish the plan first. |
| "The review found things, but I'll keep them out of the plan" | The selected threats and adopted mitigations belong in the plan you present — incorporate them, don't sideline them. |
| "Let me score risk before the threats are settled" | Never score before threats are frozen. |
| "I'll write mitigations even though the user selected zero threats" | Zero threats selected at Gate 1 ends the review — nothing proceeds to mitigation. |
| "I'll make the gate one yes/no over the whole set" | Each gate is a per-finding selection — one single-choice include/exclude window per finding; the user decides each individually (zero is allowed). |
| "The user excluded T2, but it's important — I'll mitigate it anyway" | Excluded findings are out of scope. Record them as accepted risk and move on. |
| "The critic flagged issues but it's good enough" | Re-run the generator with the feedback (up to 3 rounds). |
| "This loop could keep improving forever" | Cap each critic loop at 3 rounds; surface what's unresolved. |
| "I'll just answer the worker's job myself instead of dispatching" | Each worker runs in its own read-only subagent — dispatch it, don't inline it. |
| "`ingrain-security/assessment-….md` is clear enough — the worker will find it" | It won't. A relative path is resolved by whoever receives it, and a worker has no project root in view — it resolves against the file it was reading and creates a stray folder there. Pass the absolute `assessment_abs`, always. |
| "I'll create the `ingrain-security/` folder since it's missing" | It is not missing — the script created it at the repo root and it self-ignores, so `git status` never shows it. If you think it's absent, you resolved the path wrong. Re-run the mint script. |
| "The `ingrain` CLI errored / isn't configured, so I'll stop the review" | Genuine unavailability (binary absent, unconfigured, no matches) degrades gracefully — proceed without rules, note why, and still propose mitigations. |
| "The `ingrain` fetch was blocked by the sandbox, so I'll just proceed without rules" | A permission/sandbox denial is recoverable, not graceful-degradation — ask the user for access (native prompt, or the generator's `fetch blocked — permission needed` signal → you prompt and re-dispatch) and retry. Only proceed without rules if the user declines. |
| "I'll cite a plausible-sounding org rule to back this mitigation" | Cite only rules actually returned by `ingrain context` — never invent a rule or an id. |
| "I'll put all the detail in the window options and skip the table" | Display the findings as a table first, then present the single-choice windows — never the windows alone. |
| "I'm in plan mode / keeping output lean, so I'll skip printing the gate table" | The gate table is mandatory visible output in every mode. Read the bounded slice of the assessment file — that read is the one the context-window discipline permits — and print the table before any window. |

## Development — checklist

- **The final planning step, not a coding step.** This runs *after your
  implementation plan is comprehensive and detailed but before you present it or
  write code* — it takes the finished plan as input and folds security back into
  it. Its products are content folded into the plan you produce plus the local
  assessment artifact; it writes no code.
- **Read-only on the codebase; two outputs.** Workers make **no code or repo
  edits** — Read/Grep/Glob on the codebase only — and their sole write is their own
  section of the stored analysis file (the `assessment_abs` the orchestrator minted).
  Restate that constraint in every dispatch, since without tool-level enforcement it
  is advisory. The process produces exactly two things: **the assessment file** (the
  hand-off medium the workers write, section by section, and you finalize) and
  **the user-selected finding set folded into the plan** at Gate 1 and Gate 2 (the
  plan file when in plan mode), which also links the assessment file and instructs
  the implementing agent to maintain it. Each gate incorporates exactly the selected
  subset — never an unselected or unreviewed finding. Zero selections at Gate 1 end
  the review; zero selections at Gate 2 incorporate nothing.
- **Hand off by pointer; keep your context lean.** Move data between workers by
  pointing them at sections of the assessment file — never by pasting a prior
  worker's full output into the next dispatch — and do not read the full running
  analysis into your own context. Read only compact statuses and the bounded gate
  slices. See **The assessment file** and **How to dispatch a worker**.
- **Triage first.** Run the full cycle only when `ingrain-relevance-triage` returns
  `major`; bias to `major` when uncertain.
- **No skipping / no resequencing the pipeline.** Never score before threats are frozen,
  never mitigate before Gate 1, never present mitigations before they are frozen. (This is
  about the order of the *stages* — the `ingrain-risk-scorer` re-tagging the threats into
  risk order is part of its job, not a violation of it.)
- **Bounded loops.** Cap each critic loop at 3 rounds; surface anything left
  unresolved rather than looping forever or hiding it.

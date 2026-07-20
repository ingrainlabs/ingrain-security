---
name: ingrain-security
description: >-
  Use this AS THE FINAL STEP of building an implementation plan — whether the plan
  is an ad-hoc approach you sketched inline in the conversation or a formal
  plan-mode / design-doc session. Run it once your plan is comprehensive and
  detailed (affected files, concrete implementations, tests) but before you present
  it or write code. It takes the finished plan as input and folds security back into
  it. It first triages the change and
  only runs the full review for security-relevant ("major") changes: threats →
  0-100 risk score → user selects which threats to address (0–N) → mitigations →
  user selects which mitigations to adopt, with critic-driven improvement loops,
  via dedicated read-only subagents. Mitigations are informed by the org's own
  security rules, retrieved through the ingrain CLI, so they reflect established
  org practice for how to implement the fix. The selected threats and adopted
  mitigations become part of the plan you produce.
---

<SUBAGENT-STOP>
If you were dispatched as a worker subagent (ingrain-relevance-triage, ingrain-threat-generator,
ingrain-threat-critic, ingrain-risk-scorer, ingrain-mitigation-generator, ingrain-mitigation-critic), do the one
job you were given and return. Do NOT run this orchestration — you are part of it.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
Security analysis is the FINAL step of planning, not a separate phase after it.
First build your implementation plan in full — the affected files, the concrete
implementations, the tests. This applies to both shapes of planning: an **ad-hoc
plan** worked out inline in the conversation (no plan mode, no plan artifact) and a
**formal planning session** (plan mode, a design doc, a written spec). The trigger
is the *state*, not the mode: the moment the plan is comprehensive and detailed and
no code has been written yet — reached by either path. Once that state holds, and
before you present it or write any code, run this review with the finished plan
as its input, then fold its results back into the plan. It still belongs to
planning: the plan you hand back already reflects it. If there is even a 1%
chance the change touches security, run it — triage decides minor vs. major, you
do not pre-judge it away.
</EXTREMELY-IMPORTANT>

# Security review loop

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate six **read-only** worker roles, each defined by a reference file
at `references/<name>.md` (`ingrain-relevance-triage`, `ingrain-threat-generator`,
`ingrain-threat-critic`, `ingrain-risk-scorer`, `ingrain-mitigation-generator`,
`ingrain-mitigation-critic`). You dispatch each one as a fresh
subagent (see **How to dispatch a worker**), in order, holding the state between
steps yourself — workers cannot call each other or you. On revision rounds you
pass the worker its prior draft plus the critic's issues to address.

## How to dispatch a worker

A worker is a role defined by a reference file, not a platform-native agent. You
never run a worker's logic yourself — you dispatch a **fresh worker subagent**
(read-only on the codebase; its sole write is its own section of the assessment
file) and tell it to become that worker by reading its reference file. This keeps the
review cross-platform: it works
wherever a subagent primitive exists, and degrades to sequential in-context
execution where one does not. See `references/platform-dispatch.md` for the
per-platform mapping (host with a subagent/task primitive → that primitive;
no-subagent fallback → sequential in-context execution).

Dispatch every worker with the same shape — restate the read-only constraint
inline, because on hosts without tool-level enforcement it is the only thing
enforcing it. **Hand off by pointer, not by content:** tell the worker to write its
result into its own section of the stored analysis file and to return only a compact
status, and pass downstream workers a pointer to the sections they need to read
rather than pasting prior output into the prompt:

```
Read references/<name>.md and follow it as your system prompt.
You do no code or repo edits — use only Read/Grep/Glob on the codebase. Your ONE
permitted write is your own section of the stored analysis file for this run at
<the minted assessment_abs — the ABSOLUTE path, pasted in full> (section: <## Section for this worker>),
written to the schema in references/assessment-file.md — use exactly its fields and
enum values. Write to that exact absolute path: never shorten it, never resolve it
against a file you happen to be reading, and never create an .ingrain-security/ folder
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
`approved`/`needs-revision`). Thread the pipeline by passing the **next** worker a
pointer to the sections it must read — the workers share no state, so the stored file
is the shared state.

**Context-window discipline:** do **not** read the full running analysis into your
own context during the loop. Hold only the compact statuses/pointers workers return.
Read a bounded slice of the file only when you must — at Gate 1 and Gate 2, to render
the prepared table for the user, and at finalize. This keeps your context lean across
the whole review.

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

Dispatch workers on a **cheap model** by default — they are narrow, mechanical,
read-only jobs that don't need a frontier model.

**The one exception is the `ingrain-relevance-triage`: dispatch it on a mid-tier
model.** It is the ungated first stage — a `minor` verdict ends the review with no
threat analysis at all, and on `major` the surfaces it names seed the
`ingrain-threat-generator`. 

You (the orchestrator) stay on the session model. This applies only where the host
supports per-subagent model selection; otherwise ignore it.

## How to ask the user (the selection windows)

Gate 1 and Gate 2 are **per-finding selection gates** — the user includes or
excludes each finding individually and may select any subset, **including
none**. Always do this in **two distinct steps, in this order**:

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
   `.ingrain-security/assessment-<branch-slug>-<task-slug>.md` path) so the user knows the full
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

Never fold the information into the window options alone — the table comes first,
the windows second. Each window's options reference the table (by finding tag)
rather than restating its full detail.

## The assessment file

The review persists its analysis to a **single file written directly into
`.ingrain-security/`** at the project root — it is both the living working copy the workers
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
is the whole guard against a stray `.ingrain-security/` folder being created next to whatever
file an agent is editing — a relative path is resolved by whoever receives it, and a worker
subagent has no way to know the project root. The script resolves the root from the git repo,
creates the one folder, and hands you the finished absolute path; there is nothing to rebuild.

The path is deterministic in the branch + task:

    <project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md

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
file**: the assessment file (`.ingrain-security/assessment-<branch-slug>-<task-slug>.md`) is the security-analysis
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
   **absolute** folder, `<project_root>/.ingrain-security/`, from the mint JSON, so its
   Glob cannot drift (matching on branch + task title — a shared branch may
   hold other concurrent tasks' assessments, so a loose match returns `none`) before it
   classifies — per `references/ingrain-relevance-triage.md`. If it finds a prior snapshot whose
   `## Threats` are non-empty, it returns a **Prior analysis** pointer (path + threat
   count) alongside its verdict; keep that pointer to forward to the generator in Step 1.
   - If the verdict is `minor`: state "no security review needed — minor change"
     and **stop here**. Do not dispatch any other worker; there is nothing to fold
     into the plan — carry on building it.
   - If the verdict is `major`: keep its **Surfaces** notes — you forward them to
     the generator in Step 1 — and continue to run the full cycle.
1. **Threats** — dispatch the `ingrain-threat-generator` worker with the plan **and the
   triage Surfaces notes** (its starting points, not a ceiling) → threat list (`T1…`).
2. **Critique threats** *(loop, max 3)* — dispatch the `ingrain-threat-critic` worker. On
   `needs-revision`, re-dispatch `ingrain-threat-generator` with the prior list + critique
   and repeat. Then **freeze** the threats.
3. **Risk score** — dispatch the `ingrain-risk-scorer` worker with the frozen threats →
   per-threat 0–100 (likelihood × impact) plus an overall plan score and criticality.
4. **Ask user — select which threats to address (Gate 1).** Follow the two-step
   display-then-ask pattern (see **How to ask the user**). The user is deciding
   per threat whether it is worth acting on, so they must understand each
   threat without re-reading the plan.

   **First, display the scored threats as a Markdown table in the conversation** —
   always, in every mode (plan mode included) — one row per threat, **in tag order
   (`T1` first)**, which the risk-scorer has already made highest-risk-first, with these
   columns:

   | Column | Contents |
   |--------|----------|
<<<<<<< HEAD
   | **Threat** | tag + short title (e.g. `T1 — unauthenticated token refresh`) |
=======
   | **Threat** | tag + short title (e.g. `T3 — unauthenticated token refresh`) |
>>>>>>> dfe63ee (Rework threat schem (#5))
   | **Risk** | risk criticality + 0–100 score (e.g. `high · 78`) |
   | **What can go wrong** | the concrete failure, drawn from the threat's Vector/Description (not a generic category) |
   | **Why it matters** | the consequence if realized, grounded in the ingrain-risk-scorer's impact and score (what an attacker gains, what data or guarantee is lost) |
   | **Local impact in the plan** | which specific part of *this* change the threat lands on (the component, file, or step from the plan) |

   Keep the table faithful to the frozen threats and scores — don't invent,
   soften, or re-score. Flag rows whose risk criticality is high or critical (e.g.
   `⚑ high · 78` in the Risk column) — these are the ones you mark recommended
   in the selection windows, so the table and the windows tell the same story.
   In the same message, **name the run's assessment file** (its
   `.ingrain-security/assessment-<branch-slug>-<task-slug>.md` path) so the user can open the full
   analysis behind the table, alongside the plan file mention (see **How to ask
   the user**).

   **Then present one single-choice window per threat** asking which threats to
   address — each window a single include/exclude decision for that threat,
   labeled by its tag + short title (e.g. `T1 — unauthenticated token refresh`);
   mark high/critical threats as recommended. Where the host caps how many
   windows show at once, batch them in tag order (`T1`, `T2`, … — highest risk
   first). The user may include any subset, including none (exclude every window).

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
     `.ingrain-security/assessment-<branch-slug>-<task-slug>.md` path — no snapshot copy is
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
   mitigation, **in tag order (`M1` first)**, which the generator has already made
   highest-priority-first, with these columns:

   | Column | Contents |
   |--------|----------|
   | **Mitigation** | short title of the proposed mitigation |
   | **Addresses** | the threat tag(s) it covers (`T1`, `T3`, …), or `— (general)` for a general implementation instruction not tied to a threat |
   | **What it does** | the task-specific guidance, from the mitigation's Description |
   | **Yield** | the risk it removes over the current baseline |
   | **Effort** | how much work it takes to implement |
   | **Follows rules** | the title(s) of the org rule(s) it follows, resolved from that mitigation's citation line in the transient `## Org rules` section (e.g. `Authenticated service calls`); `—` for a pure threat mitigation. Never print rule ids. |

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
   Where the host caps how many windows show at once, batch them in table order
   (`M1`, `M2`, … — highest priority first).
   The user may include any subset, including none (exclude every window).

   - **1–N selected** — incorporate exactly the selected mitigations into the
     plan. If the selection leaves a selected threat with no covering
     mitigation, say so in the closing verdict — never silently.
   - **None selected** — incorporate nothing; note that the selected threats
     remain unmitigated.

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
   `.ingrain-security/` folder there. Re-minting is deterministic in branch + title, so it
   resolves to the same file. In plan mode, **name the plan
   file you write to** (e.g. `.${coding_agent_root}/plans/<name>.md`); ad-hoc, this is the inline
   plan you are building.

   This is the last step — close with a one-line verdict. The adopted mitigations
   (and the threats they cover) are now part of the plan file the coding agent
   implements; incorporate them and continue planning.

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
| "`.ingrain-security/assessment-….md` is clear enough — the worker will find it" | It won't. A relative path is resolved by whoever receives it, and a worker has no project root in view — it resolves against the file it was reading and creates a stray folder there. Pass the absolute `assessment_abs`, always. |
| "I'll create the `.ingrain-security/` folder since it's missing" | It is not missing — the script created it at the repo root and it self-ignores, so `git status` never shows it. If you think it's absent, you resolved the path wrong. Re-run the mint script. |
| "The `ingrain` CLI errored / isn't configured, so I'll stop the review" | Genuine unavailability (binary absent, unconfigured, no matches) degrades gracefully — proceed without rules, note why, and still propose mitigations. |
| "The `ingrain` fetch was blocked by the sandbox, so I'll just proceed without rules" | A permission/sandbox denial is recoverable, not graceful-degradation — ask the user for access (native prompt, or the generator's `fetch blocked — permission needed` signal → you prompt and re-dispatch) and retry. Only proceed without rules if the user declines. |
| "I'll cite a plausible-sounding org rule to back this mitigation" | Cite only rules actually returned by `ingrain context` — never invent a rule or an id. |
| "I'll put all the detail in the window options and skip the table" | Display the findings as a table first, then present the single-choice windows — never the windows alone. |
| "I'm in plan mode / keeping output lean, so I'll skip printing the gate table" | The gate table is mandatory visible output in every mode. Read the bounded slice of the assessment file — that read is the one the context-window discipline permits — and print the table before any window. |

## Rules

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

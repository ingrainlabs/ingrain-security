---
name: ingrain-security
description: >-
  Use at BOTH ends of a security-relevant change; it detects which phase to run from
  repo state, so invoke it at either moment. The phases never overlap: Phase A runs only
  before code for the task exists, Phase B only after.
  **Phase A — plan review:** run AS THE FINAL STEP of building an implementation plan,
  ad-hoc inline or in a formal plan-mode / design-doc session. Invoke once the plan is
  comprehensive and detailed (affected files, concrete implementations, tests) but
  before you present it or write any code. It triages the change and folds selected
  threats and adopted mitigations back into the plan you produce.
  **Phase B — verification:** run AFTER you have implemented code for that plan, but
  before you present or commit it. It checks the working-tree diff against the
  mitigations the plan adopted and reports the maturity level each one reached and
  which still need work. It writes no code.
  If there is even a 1% chance the change touches security, invoke it — triage decides
  whether a full review is warranted.
---

<SUBAGENT-STOP>
If you were dispatched as a worker subagent (ingrain-relevance-triage, ingrain-threat-generator,
ingrain-threat-critic, ingrain-risk-scorer, ingrain-mitigation-generator, ingrain-mitigation-critic,
ingrain-mitigation-verifier, ingrain-blind-maturity-reviewer), do the one job you were given
and return. Do NOT run this orchestration — neither Phase A nor Phase B — you are part of it.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
Security analysis is the FINAL step of planning, not a separate phase after it.
First build your implementation plan in full — the affected files, the concrete
implementations, the tests. The trigger is the *state*, not the mode: an **ad-hoc plan**
worked out inline and a **formal planning session** (plan mode, a design doc) both reach
the same moment — the plan is comprehensive and detailed, and no code is written yet.
Once that state holds, and before you present it or write any code, run this review with
the finished plan as its input, then fold its results back into the plan. It still belongs
to planning: the plan you hand back already reflects it. If there is even a 1% chance the
change touches security, run it — triage decides minor vs. major, you do not pre-judge it
away.
</EXTREMELY-IMPORTANT>

## Phase select — do this FIRST

This skill has two phases. **Phase A — plan review** is the checklist below, and is
everything the `<EXTREMELY-IMPORTANT>` block describes: it runs on a finished plan, before
code. **Phase B — verification** (`references/verification-pass.md`) runs on the code that
plan produced. Decide which one you are in **from repo state, before anything else** — never
from a guess about what the user meant, and never by reading ahead into the checklist.

**If the user named a phase, that is the answer.** "Verify the mitigations" → **Phase B**.
"Review this plan" → **Phase A**. Skip the table.

Otherwise resolve the state with **the mint call you already have to make**: Phase A mints
`assessment_abs` at Step 0 anyway, so run it now, keyed on this task's title, and read
`file_exists` off its JSON. This is the same one shell call, not a new one — minting only
resolves the path and ensures the folder, and is safe in either phase.

**Do not hand-build the path.** Mint it with the bundled `scripts/assessment-path` script
and reuse its output everywhere. Your SessionStart context carries the concrete,
ready-to-run command (plugin root and host already substituted); it takes the form:

    bash <plugin>/skills/ingrain-security/scripts/assessment-path <host> mint --title "<task title>"

Use its **`assessment_abs`** — the **absolute** path — verbatim as the write target for
every worker dispatch, every Write/Edit, and at finalize, and obey the `instruction` field
it carries. The relative `assessment_path` is a **display form** only: put it in prose,
tables and plan-file links, never in a write target.
→ `references/assessment-file.md` owns what the script resolves, the name's derivation, and
the file's schema — read it before your first write.

If `file_exists: true`, read the bounded `## Mitigations` slice of that file (the bounded
read the context-window discipline permits). Then:

| `file_exists` | `selected` mitigation rows | working tree | Phase |
|---|---|---|---|
| `false` | — | anything | **A** — no assessment for this task; there is nothing to verify |
| `true` | none | anything | **A** — resume this task's analysis in place (Step 0's `file_exists: true`) |
| `true` | 1+ | clean | **A** — the plan was reviewed, but no code exists yet to verify |
| `true` | 1+ | dirty (`git status --porcelain` non-empty) | **B** — read `references/verification-pass.md` NOW |

**Phase B requires all three: an assessment for THIS task, adopted mitigations in it, and a
dirty tree.** Anything else is Phase A. Note what is deliberately *not* in the table:

- **A dirty tree is never on its own a Phase B signal.** A fresh task whose tree happens to
  be dirty with unrelated WIP mints a fresh path → `file_exists: false` → row 1 → **Phase A**.
  **Do not glob `.ingrain-security/` for "some assessment on this branch."** The mint is keyed
  on branch **+ task title**, and that keying is exactly what stops a new task from adopting a
  different task's assessment. Take `file_exists` at its word.
- **`Latest stage` is not a Phase B guard.** An assessment already at `Latest stage: review`
  whose tree is dirty again — the user revised the code after a verification round — is
  **Phase B again**: re-verify every adopted mitigation and overwrite the `Justification` +
  `Verification level` columns.
  The plan did not change; the code did. Never re-run Phase A to "re-review" it.
  (`Latest stage: review` records that a verification ran; it does not close the task.)
- **A `minor` triage adopts no mitigations, so it never routes to B.** It lands on row 2. If
  the user explicitly asked to verify, the override sends you to Phase B, which stops at "no
  adopted mitigations to verify" — the correct, cheap answer. Otherwise row 2 resumes Phase A,
  where triage re-confirms `minor` in one dispatch and stops. Either way, nothing is verified,
  because by construction there is nothing to verify.

Announce the phase you picked in your opening line, so a misroute costs the user one turn.

# Security review loop

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate six **read-only** worker roles, each defined by a reference file at
`references/<name>.md` (`ingrain-relevance-triage`, `ingrain-threat-generator`,
`ingrain-threat-critic`, `ingrain-risk-scorer`, `ingrain-mitigation-generator`,
`ingrain-mitigation-critic`). You dispatch each as a fresh subagent, in order, holding the
state between steps yourself — workers cannot call each other or you.

The process produces exactly **two things**: the **assessment file** (the hand-off medium
the workers write section by section, and you finalize) and the **user-selected finding set
folded into the plan** at Gate 1 and Gate 2.

**Context-window discipline:** do **not** read the full running analysis into your own
context. Hold only the compact statuses and pointers workers return; read a bounded slice of
the assessment file only at the two gates and at finalize. The file is the shared state — you
move data between workers by pointing them at its sections, never by pasting a prior worker's
output into the next dispatch.

## How to dispatch a worker

A worker is a role defined by a reference file, not a platform-native agent. You never run a
worker's logic yourself — you dispatch a **fresh worker subagent** and tell it to become that
worker by reading its reference file.
→ `references/platform-dispatch.md` maps this onto your host (subagent/task primitive, or
the sequential in-context fallback where none exists) — read it if you are unsure which
primitive to use.

Dispatch every worker with the same shape — restate the read-only constraint inline, because
on hosts without tool-level enforcement it is the only thing enforcing it:

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
`approved`/`needs-revision`), and pass the **next** worker a pointer to the sections it must
read.

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
   ad-hoc, windowed or fallback alike. It is **visible output in the conversation**, never
   only written into the plan or assessment file, and never skipped as "extra output":
   printing it is a read-only display action that no mode forbids.
2. **Then present the selection windows** — one single-choice include/exclude window per
   finding, labeled by tag + short title (e.g. `T1 — unauthenticated token refresh`). One
   window, one finding, one binary choice keeps every decision isolated and deliberate, so
   findings never blur together the way they do in a single multi-toggle list. Mark
   high/critical findings recommended. Because each window is its own decision, **selecting
   none is always reachable** — the user excludes every window.
   → `references/platform-dispatch.md` § Selection windows for the host mechanism and the
   batching rule where a host caps how many windows it can show at once.

**Never collapse a gate into a single yes/no over the whole set, and never fold all findings
into one combined list.** Never fold the information into the window options alone — the
table comes first, the windows second; each window's options reference the table by finding
tag rather than restating its detail.

## Phase A — the flow

Each step is one dispatch; you hold the state between them. The tracker for these steps is
**Phase A — checklist** at the end of this file.

0. **Triage** — dispatch `ingrain-relevance-triage` with the plan, the resolved
   `branch_slug` (or `unknown`), the task title, and the **absolute**
   `<project_root>/.ingrain-security/` folder from the mint JSON (a relative folder silently
   matches nothing, and it would wrongly report `none`). It checks for a prior analysis of
   this task before it classifies.
   → `references/ingrain-relevance-triage.md` defines what it does; you only branch on its
   keyword.
   - `minor` → state "no security review needed — minor change" and **STOP**. Dispatch no
     other worker. There is nothing to fold into the plan — carry on building it.
   - `major` → keep its **Surfaces** notes and any **Prior analysis pointer** for Step 1, then
     **create or open the assessment file** at `assessment_abs` with its title + banner and the
     `## Task` section (`file_exists: true` means you are resuming this task's prior analysis).
     The worker's `## Triage` section is already in it.

1. **Threats** — dispatch `ingrain-threat-generator`, pointing it at the plan **and the
   `## Triage` section** (Surfaces are starting points, not a ceiling). **If triage returned a
   Prior analysis pointer**, also point it at that snapshot's `## Threats` and `## Mitigations`
   so it **seeds from the prior analysis** — re-derive and refresh against the current plan, do
   not blindly copy. It writes the `## Threats` rows under working tags `T1…` and returns a
   pointer. Its tags are discovery order and carry no priority.

2. **Critique threats** *(loop, max 3)* — dispatch `ingrain-threat-critic` at `## Threats`.
   - `needs-revision` → re-dispatch `ingrain-threat-generator` with a pointer to `## Threats`
     + `## Threat critique`, and repeat.
   - `approved`, or 3 rounds spent → **freeze** the threats. Surface anything left unresolved.

3. **Risk score** — dispatch `ingrain-risk-scorer` at the frozen `## Threats`. It fills each
   row's scoring columns, writes the plan-level residual into `## Risk score`, and **re-tags
   the threats into descending-risk order** — contiguous `T1…Tn`, `T1` the most critical. From
   here the tag *is* the priority and every stage reads the table top-down. (The re-tag is part
   of its job, not a resequencing of the pipeline.)

4. **Gate 1 — the user selects which threats to address.** Follow **How to ask the user**.
   The user is deciding per threat whether it is worth acting on, so they must understand each
   threat without re-reading the plan. In order:

   1. **Read** the bounded `## Threats` slice — this read is **required**, and it is exactly
      the read the context-window discipline permits. If the slice is empty or its scoring
      columns are unfilled, stop and re-dispatch `ingrain-risk-scorer` (or
      `ingrain-threat-generator` if the rows themselves are missing) rather than skipping the
      table or rendering it empty.
   2. **Display** the scored threats as a Markdown table in the conversation, **in tag order
      (`T1` first)**, with the columns below.
   3. **Present** one single-choice window per threat; mark high/critical recommended.
   4. **Record** each threat's `Selection` in `## Threats` (include → `selected`, exclude →
      `excluded`; `undecided` only if the user is explicitly unsure).

   | Column | Contents |
   |--------|----------|
   | **Threat** | tag + short title (e.g. `T1 — unauthenticated token refresh`) |
   | **Risk** | risk criticality + 0–100 score (e.g. `high · 78`) |
   | **What can go wrong** | the concrete failure, drawn from the threat's Vector/Description (not a generic category) |
   | **Why it matters** | the consequence if realized, grounded in the scorer's impact and score (what an attacker gains, what data or guarantee is lost) |
   | **Local impact in the plan** | which specific part of *this* change the threat lands on (the component, file, or step from the plan) |

   Keep the table faithful to the frozen threats and scores — don't invent, soften, or
   re-score. Flag high/critical rows (e.g. `⚑ high · 78`) so the table and the windows tell the
   same story. In the same message, **name the run's assessment file** (its relative
   `.ingrain-security/assessment-<branch-slug>-<task-slug>.md` path) and **the plan file**
   these decisions feed into — a **mention only**; nothing is written to the plan file at the
   gates, the write happens at finalize.

   - **1–N selected** → only those proceed to Step 5. Name the excluded ones in one line
     ("T2, T5 excluded — risk accepted").
   - **None selected** → skip Steps 5–7. State "no threats selected — review closed", close
     with a one-line verdict naming the threats as accepted risk, then **go to Finalize** — the
     all-`excluded` `## Threats` section is the preserved context. Then continue building the
     plan.

5. **Mitigate** — dispatch `ingrain-mitigation-generator` with the **user-selected threats
   only** (excluded threats are out of scope), `assessment_abs`, and `rules_abs` (mint the
   sidecar path with the `rules-path` command from your `INGRAIN-ASSESSMENT-PATHS` session
   context). It proposes both **threat mitigations** and **general implementation
   instructions** for the full scoped task — both belong in the plan. It retrieves the org's
   security rules with `ingrain context security_rules "<query>"` and folds them in, so
   mitigations reflect established org practice.
   **This is the one worker that gets the shell/exec tool** — dispatch it with Bash/exec in
   addition to Read/Grep/Glob, and say so in its dispatch. Every other worker stays strictly
   Read/Grep/Glob.
   → `references/ingrain-mitigation-generator.md` owns the lookup and its failure modes;
   `references/rules-file.md` owns the sidecar's schema and lifecycle.
   - `fetch blocked — permission needed` → the lookup was denied by the sandbox and the worker
     could not surface a prompt itself. **Do not accept the review without org rules yet.** Ask
     the user for access using the same window primitive the gates use, and on grant
     **re-dispatch with exec access**. Only if the user **declines** (or no permission channel
     exists) do you proceed without rules, noting that access was declined.

6. **Critique mitigations** *(loop, max 3)* — dispatch `ingrain-mitigation-critic` at
   `## Mitigations` **and the `rules-<…>.md` sidecar**, so it can judge the mitigations against
   the rules they cite.
   - `needs-revision` → re-dispatch `ingrain-mitigation-generator`, and repeat.
   - `approved`, or 3 rounds spent → **freeze** the mitigations.

7. **Gate 2 — the user selects which mitigations to adopt.** Follow **How to ask the user**.
   In order:

   1. **Read** the bounded `## Mitigations` slice, and the `rules-<…>.md` sidecar to resolve
      rule titles.
   2. **Display** the frozen mitigations as a Markdown table in the conversation, **in tag
      order (`M1` first)**, with the columns below.
   3. **Present** one single-choice window per mitigation, labeled by short title + the threat
      tag(s) it addresses (or `general`).
   4. **Record** each mitigation's `Selection` in `## Mitigations` (adopt → `selected`, decline
      → `excluded`).

   | Column | Contents |
   |--------|----------|
   | **Mitigation** | short title of the proposed mitigation |
   | **Addresses** | the threat tag(s) it covers (`T1`, `T3`, …), or `— (general)` for a general implementation instruction |
   | **What it does** | the task-specific guidance, from the mitigation's Description |
   | **Yield** | the risk it removes over the current baseline |
   | **Effort** | how much work it takes to implement |
   | **Follows rules** | the **title(s)** of the org rule(s) it follows, resolved from that mitigation's entry in the sidecar (e.g. `Authenticated service calls`); `—` for a pure threat mitigation |

   Keep the table faithful to the frozen mitigations — don't invent or re-scope. For each id in
   a mitigation's **Rule refs**, take the title from its `### <id> — <title>` entry in the
   sidecar. **Never print rule ids** — they are machine-facing. If an id has no matching
   sidecar entry (or no sidecar exists), print the mitigation's rule count (e.g. `2 org rules`)
   rather than falling back to the id.

   - **1–N selected** → incorporate exactly those. If the selection leaves a `selected` threat
     with no covering mitigation, **say so in the closing verdict — never silently**.
   - **None selected** → incorporate nothing; note that the selected threats remain unmitigated.
   - Then **go to Finalize**. This is the last step — close with a one-line verdict.

## The plan file

The review folds its results into **the plan file** — the implementation plan the coding
agent edits and executes downstream. This is **distinct from the assessment file**: the
assessment file is the security-analysis artifact the workers write; the plan file is the
implementation plan the selected threats and adopted mitigations become part of.

In **plan mode** it is a concrete on-disk file (e.g. `.${coding_agent_root}/plans/<name>.md`);
you already hold its path, since it is the file you are editing — **name it** when you
reference it. In **ad-hoc mode** there is no file — the plan file is "the inline plan you are
building" in the conversation.

## Finalize

Reached from Gate 1 (none selected) or Gate 2. Two writes:

**1. Finalize the assessment file in place.** Fill `## Coverage / open items` with any
`selected` threat left without a `selected` covering mitigation. Then **delete the two
transient sections — `## Threat critique` and `## Mitigation critique`** (heading and body):
they are iteration scratch, and the finalized file carries only end results. **Leave the
`rules-<…>.md` sidecar in place** — it is a persistent, linked artifact that the Phase B
verification pass reads in a later session. Write to the minted `assessment_abs`; the file
already lives there, so there is **no snapshot to copy** — finalizing it *is* persisting it.

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

## Phase B — verification

Phase B checks that the mitigations Gate 2 adopted were actually implemented. It fires when
**Phase select** lands on Phase B — an assessment for this task exists, it carries `selected`
mitigations, and the working tree is dirty. **Nothing above this line applies to it:** the
checklist, both gates, the critic loops, and the org-rules CLI lookup are Phase A only.

**Read `references/verification-pass.md` NOW and follow it.** The full loop lives there — do
not run it from this section's summary: it is a pointer, not the procedure.

**Announce:** open with "Using ingrain-security to verify the implemented mitigations."

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
| "I'll read the whole assessment file to see where we are" | Hold only the compact statuses workers return. The bounded gate slices and finalize are the only reads. |
| "`.ingrain-security/assessment-….md` is clear enough — the worker will find it" | It won't. A relative path is resolved by whoever receives it, and a worker has no project root in view — it resolves against the file it was reading and creates a stray folder there. Pass the absolute `assessment_abs`, always. |
| "I'll create the `.ingrain-security/` folder since it's missing" | It is not missing — the script created it at the repo root and it self-ignores, so `git status` never shows it. If you think it's absent, you resolved the path wrong. Re-run the mint script. |
| "I'll delete the `rules-<…>.md` sidecar at finalize like the scratch sections" | The rules sidecar is a **persistent** linked artifact, not scratch — the Phase B verification pass reads it later. Only the two critique sections are deleted. |
| "No org rules came back, so I'll write an empty `rules-<…>.md`" | The sidecar is written **only when rules were retrieved**. No rules → no file; its absence is the signal, and Gate 2 / verification fall back to Descriptions. |
| "The `ingrain` CLI errored / isn't configured, so I'll stop the review" | Genuine unavailability (binary absent, unconfigured, no matches) degrades gracefully — proceed without rules, note why, and still propose mitigations. |
| "The `ingrain` fetch was blocked by the sandbox, so I'll just proceed without rules" | A permission/sandbox denial is recoverable, not graceful-degradation — ask the user for access (native prompt, or the generator's `fetch blocked — permission needed` signal → you prompt and re-dispatch) and retry. Only proceed without rules if the user declines. |
| "I'll cite a plausible-sounding org rule to back this mitigation" | Cite only rules actually returned by `ingrain context` — never invent a rule or an id. |
| "I'll put all the detail in the window options and skip the table" | Display the findings as a table first, then present the single-choice windows — never the windows alone. |
| "I'm in plan mode / keeping output lean, so I'll skip printing the gate table" | The gate table is mandatory visible output in every mode. Read the bounded slice of the assessment file — that read is the one the context-window discipline permits — and print the table before any window. |

## Phase A — checklist

The procedure is **Phase A — the flow**; this is the tracker. Tick only what is actually
done. Work top to bottom — never skip a step, never reorder the pipeline, never batch. (The
`ingrain-risk-scorer` re-tagging threats into risk order at step 3 is part of its job, not a
resequencing.) Each step is one dispatch: dispatch every worker rather than answering its job
yourself, and hold the state between them. Each gate incorporates exactly the selected
subset — never an unselected or unreviewed finding.

- [ ] 0. Triage dispatched — bias to `major` when uncertain; `minor` → stop, `major` → open the assessment file
- [ ] 1. Threats generated into `## Threats`, seeded from any prior analysis
- [ ] 2. Threat critique loop closed — approved, or 3 rounds spent; threats frozen
- [ ] 3. Risk scored; threats re-tagged into descending-risk order
- [ ] 4. Gate 1 — table displayed in the conversation FIRST, then one window per threat; `Selection` recorded (zero selected ends the review)
- [ ] 5. Mitigations generated for the selected threats ONLY; org rules retrieved
- [ ] 6. Mitigation critique loop closed — approved, or 3 rounds spent; mitigations frozen
- [ ] 7. Gate 2 — table displayed FIRST, then one window per mitigation; `Selection` recorded
- [ ] Finalize — critique sections deleted, sidecar kept, plan file carries the assessment link + Maintenance

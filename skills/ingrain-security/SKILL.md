---
name: ingrain-security
description: >-
  Use at BOTH ends of a security-relevant change; it detects which phase to run from
  repo state, so invoke it at either moment. The phases never overlap: Development runs only
  before code for the task exists, Testing only after.
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
  the residual path an attacker would take. It writes no code.
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
script and read **`delta_empty`** off its JSON: `false` means this branch has commits since the
fork point, or an uncommitted change, or both. **Keep its `base_ref`, `diff_ref` and
`fallback`** — Testing diffs against exactly that `diff_ref`.
→ `references/lib/branch-diff.md` owns the script, the refs it returns, and why a clean working
tree is **not** evidence that no code exists — read it before routing on the delta.

If `file_exists: true`, read the bounded `## Mitigations` slice of that file (the bounded
read the context-window discipline permits). Then:

| `file_exists` | `selected` mitigation rows | branch delta | Phase |
|---|---|---|---|
| `false` | — | anything | **Development** — no assessment for this task; there is nothing to verify |
| `true` | none | anything | **Development** — resume this task's analysis in place (Step 0's `file_exists: true`) |
| `true` | 1+ | empty (`delta_empty: true`) | **Development** — the plan was reviewed, but no code for it exists yet to verify |
| `true` | 1+ | non-empty (`delta_empty: false`) | **Testing** — read `references/testing/verification-pass.md` NOW |

**Testing requires all three: an assessment for THIS task, adopted mitigations in it, and a
non-empty branch delta.** Anything else is Development. Note what is deliberately *not* in the table:

- **A non-empty branch delta is never on its own a Testing signal.** A fresh task on a branch that
  already carries unrelated commits, or unrelated WIP, mints a fresh path → `file_exists: false` →
  row 1 → **Development**.
  **Do not glob `.ingrain-security/` for "some assessment on this branch."** The mint is keyed
  on branch **+ task title**, and that keying is exactly what stops a new task from adopting a
  different task's assessment. Take `file_exists` at its word.
- **`Latest stage: testing` does not mean Testing is done.** The field records that a
  verification ran; it does not close the task, and it is never a reason to skip. An
  assessment already at `Latest stage: testing` whose branch delta has grown again — the user revised
  the code after a verification round — is **Testing again**: re-test every selected threat and
  overwrite the `Robustness`, `Justification` and `Verification level` columns.
  The plan did not change; the code did. Never re-run Development to "re-review" it.
- **A `minor` triage adopts no mitigations, so it never routes to Testing.** It lands on row 2. If
  the user explicitly asked to verify, the override sends you to Testing, which stops at "no
  adopted mitigations to verify" — the correct, cheap answer. Otherwise row 2 resumes Development,
  where triage re-confirms `minor` in one dispatch and stops. Either way, nothing is verified,
  because by construction there is nothing to verify.

Announce the phase you picked in your opening line, so a misroute costs the user one turn.

# Security review loop

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate seven **read-only** worker roles, each defined by a reference file at
`references/development/<name>.md` (`ingrain-relevance-triage`, `ingrain-threat-generator`,
`ingrain-threat-critic`, `ingrain-risk-scorer`, `ingrain-mitigation-generator`,
`ingrain-rule-expander`, `ingrain-mitigation-critic`). You dispatch each as a fresh subagent,
in order, holding the state between steps yourself — workers cannot call each other or you.
One step is yours alone: at Step 5 you run the org-rules retrieval **in this session**, not
through a worker.

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

A worker is a role defined by a reference file, not a platform-native agent. You never run a
worker's logic yourself — you dispatch a **fresh worker subagent** and tell it to become that
worker by reading its reference file.
→ `references/lib/platform-dispatch.md` maps this onto your host (subagent/task primitive, or
the sequential in-context fallback where none exists) — read it if you are unsure which
primitive to use.

Dispatch every worker with the same shape — restate the read-only constraint inline, because
on hosts without tool-level enforcement it is the only thing enforcing it:

```
Read references/development/<name>.md and follow it as your system prompt.
You do no code or repo edits — use only Read/Grep/Glob on the codebase. Your ONE
permitted write is your own section of the stored analysis file for this run at
<the minted assessment_abs — the ABSOLUTE path, pasted in full> (section: <## Section for this worker>),
written to the schema in references/formatting/assessment-file.md — use exactly its fields and
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
   → `references/lib/platform-dispatch.md` § Selection windows for the host mechanism and the
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
     gracefully: no sidecar, note why in one line, carry on. A `command not found` probe also
     means **Step 7 is skipped**, since the expander has no CLI to reach either.

6. **Mitigate** — dispatch `ingrain-mitigation-generator` with the **user-selected threats
   only** (excluded threats are out of scope), `assessment_abs`, and `rules_abs` — pointing it
   at the sidecar's `## Retrieved rules` so it grounds its proposals in established org
   practice rather than its own knowledge alone. It proposes both **threat mitigations** and
   **general implementation instructions** for the full scoped task — both belong in the plan.
   It writes the mitigation rows and the sidecar's `## Per-mitigation mapping`. It is strictly
   Read/Grep/Glob — **it runs no CLI**; the rules it needs are already on disk.

7. **Expand rules** — dispatch `ingrain-rule-expander` at the `## Mitigations` table and the
   sidecar, with `rules_abs` as its write target. Step 5 could only query what the threats
   implied; now that concrete mitigations name concrete mechanisms, it searches for the rules
   that pass could not have known to ask for, and **appends** them to the sidecar.
   **This is the one worker that gets the shell/exec tool** — dispatch it with Bash/exec in
   addition to Read/Grep/Glob, and say so in its dispatch. Every other worker stays strictly
   Read/Grep/Glob.
   **It runs exactly once.** It is not part of the Step 8 loop and is never re-dispatched on a
   revision round — the critic is what carries its findings into the mitigations. Skip this
   step entirely if Step 5's probe reported the CLI absent, and say so when you do.
   → `references/development/ingrain-rule-expander.md` owns the lookup and its failure modes.
   - `fetch blocked — permission needed` → the lookup was denied by the sandbox and the worker
     could not surface a prompt itself. Ask the user for access using the same window
     primitive the gates use, and on grant **re-dispatch with exec access** — this recovery
     re-run is not a second pass. Only if the user **declines** (or no permission channel
     exists) do you continue with Step 5's rules alone, noting that access was declined.

8. **Critique mitigations** *(loop, max 3)* — dispatch `ingrain-mitigation-critic` at
   `## Mitigations` **and the expanded `rules-<…>.md` sidecar**, so it can judge the
   mitigations against the rules they cite *and* against the rules Step 7 added. A rule the
   expander found that no mitigation applies is exactly the gap this critic reports.
   - `needs-revision` → re-dispatch `ingrain-mitigation-generator` (only the generator — never
     the expander), and repeat.
   - `approved`, or 3 rounds spent → **freeze** the mitigations.

9. **Gate 2 — the user selects which mitigations to adopt.** Follow **How to ask the user**.
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
`selected` threat left without a `selected` covering mitigation, and set `## Task` →
`Latest stage: development` — the plan review is the Development phase, and Testing is what
later advances the field to `testing`. Then **delete the two
transient sections — `## Threat critique` and `## Mitigation critique`** (heading and body):
they are iteration scratch, and the finalized file carries only end results. **Leave the
`rules-<…>.md` sidecar in place** — it is a persistent, linked artifact that the Testing
verification pass reads in a later session. One write, to the minted `assessment_abs`; the
file already lives there, so there is **no snapshot to copy** — finalizing it *is*
persisting it.

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
scope — not the mitigation Descriptions. It fires when
**Phase select** lands on Testing — an assessment for this task exists, it carries `selected`
mitigations, and the branch delta is non-empty (`scripts/branch-diff` → `delta_empty: false`).
**Nothing above this line applies to it:** Steps 0–9, both gates, the critic loops, and the
org-rules CLI lookup are Development only.

**Read `references/testing/verification-pass.md` NOW and follow it.** The full loop lives there — do
not run it from this section's summary: it is a pointer, not the procedure.

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
| "I'll delete the `rules-<…>.md` sidecar at finalize like the scratch sections" | The rules sidecar is a **persistent** linked artifact, not scratch — the Testing verification pass reads it later. Only the two critique sections are deleted. |
| "No org rules came back, so I'll write an empty `rules-<…>.md`" | The sidecar is written **only when rules were retrieved**. No rules → no file; its absence is the signal, and Gate 2 / verification fall back to Descriptions. |
| "The `ingrain` CLI errored / isn't configured, so I'll stop the review" | Genuine unavailability (binary absent, unconfigured, no matches) degrades gracefully at Step 5 and Step 7 alike — proceed without rules, note why, and still propose mitigations. |
| "The `ingrain` fetch was blocked by the sandbox, so I'll just proceed without rules" | A permission/sandbox denial is recoverable, not graceful-degradation. At Step 5 you are in the main session — re-run so the host's native prompt reaches the user. At Step 7 the worker returns `fetch blocked — permission needed` → you prompt and re-dispatch. Only proceed without rules if the user declines. |
| "I'll have the mitigation-generator look up a rule it's missing" | The generator has no CLI. Step 5 retrieves before it runs and Step 7 expands after; on a revision round it re-reads the sidecar, which is already complete. |
| "The expander found new rules — I'll run it again after the critic" | It runs **exactly once**. The critic flagging an unapplied rule is what folds new rules into the mitigations; re-dispatching the expander is not the mechanism. (Re-running it because the fetch was permission-blocked is a recovery, not a second pass.) |
| "I'll cite a plausible-sounding org rule to back this mitigation" | Cite only rules actually returned by `ingrain context` — never invent a rule or an id. |
| "I'll put all the detail in the window options and skip the table" | Display the findings as a table first, then present the single-choice windows — never the windows alone. |
| "I'm in plan mode / keeping output lean, so I'll skip printing the gate table" | The gate table is mandatory visible output in every mode. Read the bounded slice of the assessment file — that read is the one the context-window discipline permits — and print the table before any window. |

## Development — checklist

The procedure is **Development — the flow**; this is the tracker. Tick only what is actually
done. Work top to bottom — never skip a step, never reorder the pipeline, never batch. (The
`ingrain-risk-scorer` re-tagging threats into risk order at step 3 is part of its job, not a
resequencing.) Each gate incorporates exactly the selected subset — never an unselected or
unreviewed finding.

- [ ] 0. Triage dispatched — bias to `major` when uncertain; `minor` → stop, `major` → open the assessment file
- [ ] 1. Threats generated into `## Threats`, seeded from any prior analysis
- [ ] 2. Threat critique loop closed — approved, or 3 rounds spent; threats frozen
- [ ] 3. Risk scored; threats re-tagged into descending-risk order
- [ ] 4. Gate 1 — table displayed in the conversation FIRST, then one window per threat; `Selection` recorded (zero selected ends the review)
- [ ] 5. Org rules retrieved by YOU via the `ingrain` CLI, from plan + selected threats; sidecar written (or none, if nothing came back)
- [ ] 6. Mitigations generated for the selected threats ONLY, grounded in the sidecar; generator got no CLI
- [ ] 7. Rule expander dispatched ONCE — second pass keyed on the mitigations; appended to the sidecar (skipped only if the CLI is absent)
- [ ] 8. Mitigation critique loop closed — approved, or 3 rounds spent; only the generator re-dispatched; mitigations frozen
- [ ] 9. Gate 2 — table displayed FIRST, then one window per mitigation; `Selection` recorded
- [ ] Finalize — `Latest stage: development` set, critique sections deleted, sidecar kept, plan file carries the assessment link + Maintenance

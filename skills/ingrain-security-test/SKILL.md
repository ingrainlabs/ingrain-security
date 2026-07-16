---
name: ingrain-security-test
description: >-
  Use this AFTER you have implemented code for a task, once the change is written
  but before you present or commit it — the verification counterpart to the
  ingrain-security planning review. It only applies when the task already has an
  `.ingrain-security` assessment file (produced by the ingrain-security skill at
  planning time) carrying adopted mitigations. It locates that assessment for the
  current branch + task, reviews the working-tree diff, and dispatches one read-only
  subagent per adopted mitigation to verify the implementation actually applies it.
  Each verifier is given the org rule descriptions behind its mitigation, read from the
  linked `rules-<…>.md` sidecar the planning review persisted (no CLI call).
  It then reports back — all mitigations verified, or the specific ones that are
  missing or insufficiently implemented, with evidence and fix guidance, so you can
  revisit them — and marks the assessment checked (records each mitigation's Verified
  status and advances the file's stage to review). It writes no code and does not
  re-run the planning review; it verifies what was planned was built.
---

<SUBAGENT-STOP>
If you were dispatched as a worker subagent (ingrain-mitigation-verifier), do the one
verification job you were given and return your verdict. Do NOT run this orchestration —
you are part of it.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
This is a verification pass, not a planning pass. Run it once code has been written for a
task **whose plan went through the `ingrain-security` review** — i.e. a task with an
`.ingrain-security/assessment-<branch-slug>-<task-slug>.md` file that carries adopted
(`selected`) mitigations. The trigger is the *state*: implementation exists in the working
tree and an assessment with adopted mitigations exists for this task. If there is no
assessment for the task, or it has no `selected` mitigations, there is nothing to verify —
say so and stop. You do not threat-model here and you do not edit code; you check that the
mitigations the plan adopted were actually implemented, and you record the result.
</EXTREMELY-IMPORTANT>

# Mitigation verification loop

**Announce:** open with "Using ingrain-security-test to verify the implemented mitigations."

You orchestrate one **read-only** worker role, `ingrain-mitigation-verifier`, defined by a
reference file at `references/ingrain-mitigation-verifier.md`. You dispatch it **once per
adopted mitigation** as a fresh subagent (see **How to dispatch a verifier**), hold the
verdicts yourself, then record them into the assessment file and report to the coding agent.
Workers do not write the file and cannot call each other or you.

## The assessment file

This skill reads and finalizes the **same** per-task assessment file the `ingrain-security`
planning review wrote — a single file in `.ingrain-security/` at the project root. **Do not
hand-build its path.** Mint it once, at the start of the run, with the bundled
**`scripts/assessment-path`** script (the same one the planning skill uses — it lives in the
sibling skill). Your SessionStart context carries the ready-to-run command (plugin root and
host already substituted); it takes the form:

    bash <plugin>/skills/ingrain-security/scripts/assessment-path <host> mint --title "<task title>"

The script returns a JSON object. Use its **`assessment_abs`** — the **absolute** path —
verbatim as the file path for every read and for the finalize write, and obey the
`instruction` field it carries. The relative `assessment_path` is a **display form** only:
put it in prose and reports, never in a write target. The path is deterministic in the branch
+ task title:

    <project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md

so it resolves to the **same file** the planning review wrote for this task
(`file_exists: true` confirms it). **If `file_exists` is `false`**, no assessment exists for
this task — state "no ingrain-security assessment for this task — nothing to verify" and
**stop**. The file's schema/template lives in
`../ingrain-security/references/assessment-file.md`; follow it exactly, including the
enumerated values for the `Verified` column (`verified` | `insufficient` | `missing`) and the
`Latest stage` field (`planning` | `development` | `review`).

Writes to `assessment_abs` are pre-approved by the `allow-assessment-write` hook, so expect
no permission prompt when you finalize. Write **only** to that absolute path — anything else
prompts the user and stalls the run.

## The diff under review

Verify against the **working tree** — the code as implemented right now. Capture it once, as
your one shell call besides the mint:

- `git status --porcelain` — the set of changed + untracked paths (does anything need
  verifying at all?).
- `git diff HEAD` — the committed-vs-working diff of tracked files.
- New (untracked) files listed by `git status` — read their contents directly.

If the working tree is clean (nothing changed), there is nothing to verify — say so and stop.
Each verifier re-derives the slice of this diff relevant to its own mitigation; you do not
paste the whole diff into every dispatch.

## The rules file

Each adopted mitigation carries **Rule ref ids** (the `Rule refs` column of `## Mitigations`)
but not the rule bodies. The planning review persisted the rule bodies to a **linked sidecar**,
`.ingrain-security/rules-<branch-slug>-<task-slug>.md` — the twin of the assessment file, keyed
by the same branch + task slug (schema: `../ingrain-security/references/rules-file.md`). To let
each verifier judge `verified` vs `insufficient` against *how the org implements* the control —
not just the mitigation's generic Description — locate that sidecar and hand each verifier the
rule descriptions for its mitigation. **This reads a file the planning review already wrote;
there is no CLI call here** — neither you nor the verifiers query `ingrain`.

**Do not hand-build the sidecar path.** Mint it with the bundled **`scripts/rules-path`**
script, the twin of `assessment-path`; your SessionStart context carries the ready-to-run
command:

    bash <plugin>/skills/ingrain-security/scripts/rules-path <host> mint --title "<task title>"

Use its **`rules_abs`** (absolute) as the read path. Because it is keyed by the same branch +
task slug, it resolves to the **same sidecar** the planning review wrote for this task.

- **`file_exists: true`** — the sidecar carries this task's org rules. Read the bounded
  `## Retrieved rules` / `## Per-mitigation mapping` slices you need to give each verifier the
  rule(s) behind its mitigation's Rule refs (by pointer — see **How to dispatch a verifier**).
- **`file_exists: false`** — no org rules were retrieved for this task at planning time (the
  CLI was absent, unconfigured, or returned nothing). There is nothing to hand the verifiers;
  they verify from the mitigation Descriptions alone. This is **never** a finding.

The rules are **supporting context only**: their presence sharpens `verified` vs `insufficient`,
their absence never blocks verification. A mitigation whose `Rule refs` is `—` has no backing
rule — the verifier works from its Description.

## How to dispatch a verifier

A verifier is a role defined by a reference file, not a platform-native agent. You never run
its logic yourself — you dispatch a **fresh worker subagent** and tell it to become the
verifier by reading its reference file. This keeps the check cross-platform: it works wherever
a subagent primitive exists and degrades to sequential in-context execution where one does
not. See `../ingrain-security/references/platform-dispatch.md` for the per-platform mapping
(host with a subagent/task primitive → that primitive, one verifier per call; no-subagent
fallback → sequential in-context execution).

Dispatch every verifier with the same shape. Restate the read-only constraint inline, because
on hosts without tool-level enforcement it is the only thing enforcing it. The verifier is
read-only on the codebase — **Read/Grep/Glob only** — with **one narrow exception**: it may
run **read-only git** (`git diff HEAD`, `git status`, `git show`) to obtain the working-tree
diff. It makes no edits, runs no other commands, and **runs no `ingrain`/CLI commands** — any
org rule it needs is already in the `rules-<…>.md` sidecar (see **The rules file**). **Hand off
by pointer:** point the verifier at its mitigation row **and, when the sidecar exists, the
rule(s) for its Rule refs** rather than pasting the files; the verifier **returns a verdict and
does not write the assessment file** (you record the verdicts, to avoid concurrent writes to
one table):

```
Read references/ingrain-mitigation-verifier.md and follow it as your system prompt.
You do no code or repo edits — use only Read/Grep/Glob on the codebase, plus read-only git
(git diff HEAD, git status, git show) to obtain the working-tree diff. You run NO ingrain/CLI
commands — any org rule you need is in the rules sidecar named below. You write NOTHING —
not the assessment file, not any file; you only return your verdict.
INPUT:
- The run's assessment file is at <the minted assessment_abs — the ABSOLUTE path, pasted in full>.
  Read ONLY its `## Mitigations` row <M-tag> (and the threat rows in `## Threats` it covers)
  — the mitigation you must verify, its Description, and the threat(s) it addresses.
- The org-rules sidecar is at <the minted rules_abs — the ABSOLUTE path — or "none (no rules file for this task)">.
  If it exists, read ONLY the `## Retrieved rules` entries for <M-tag>'s Rule ref ids (found via
  the `## Per-mitigation mapping`) — the org rule bodies behind this mitigation. Treat them as
  SUPPORTING CONTEXT on how the org implements this control; the mitigation Description remains
  the contract you verify against. If the sidecar is absent, or <M-tag>'s Rule refs is `—`,
  verify from the Description alone.
- Verify whether the working-tree diff implements that mitigation as described.
Return ONLY: the verdict word (verified | insufficient | missing) for <M-tag>, then one line
of evidence (file:line in the diff) and, if not verified, the concrete gap. Do not return the
full diff or a long analysis.
```

Branch on the verdict word each verifier leads with. Dispatch verifiers for **all** adopted
mitigations (fan them out where the host runs subagents in parallel; run them in tag order
where it does not).

## Steps — in strict order

0. **Locate the assessment.** Mint the path (see **The assessment file**). If
   `file_exists: false`, state there is no assessment for this task and **stop**.
1. **Capture the diff.** Capture the working-tree diff once (see **The diff under review**).
   If the tree is clean, state "no changes to verify" and **stop**.
2. **Collect adopted mitigations.** Read the bounded `## Mitigations` slice of the assessment
   file and take every row whose **Selection** is `selected` — both threat mitigations and
   general implementation instructions. If **none** are selected, state "no adopted
   mitigations to verify", set `Latest stage: review`, and **stop** (nothing to check). If
   threats were selected but every mitigation was declined, note that the selected threats
   were accepted with no adopted mitigation — there is nothing to verify.
3. **Locate the rules file.** Mint `rules_abs` with the `rules-path` command (see **The rules
   file**). If `file_exists: true`, it carries this task's org rules — you will hand each
   verifier the rule(s) for its mitigation by pointer. If `file_exists: false`, no rules were
   retrieved at planning; verifiers verify from Descriptions alone. This is supporting context
   only — never a blocker and never a finding. (No CLI is involved.)
4. **Dispatch verifiers.** Dispatch one `ingrain-mitigation-verifier` per adopted mitigation
   (see **How to dispatch a verifier**), each pointed at its `M<n>` row, the threat(s) it
   covers, **and — when the sidecar exists — its rule(s) in `rules_abs`**. Collect each verdict
   (`verified` | `insufficient` | `missing`) plus its one-line evidence/gap.
5. **Finalize the assessment (you write).** Write each verdict into the new **`Verified`**
   column of the `## Mitigations` table (per
   `../ingrain-security/references/assessment-file.md`), leaving excluded/undecided rows as
   `—`, and set `## Task` → `Latest stage: review`. Write to the minted `assessment_abs`. The
   `rules-<…>.md` sidecar is a persistent planning artifact — **do not modify or delete it**.
   This is the "mark checked" step — the file now records what was verified.
6. **Report to the coding agent.** Present the findings (see **Reporting format**) and close
   with a one-line verdict. If any mitigation is `insufficient` or `missing`, ask the coding
   agent to revisit exactly those.

## Reporting format

Report the verdicts to the coding agent as **visible Markdown output in the conversation** —
one row per adopted mitigation, in tag order (`M1` first), with these columns:

| Column | Contents |
|--------|----------|
| **Mitigation** | tag + short title (e.g. `M1 — authenticate token refresh`) |
| **Addresses** | the threat tag(s) it covers (`T1`, `T3`, …), or `general` for an implementation instruction not tied to a threat |
| **Status** | `verified` \| `insufficient` \| `missing` |
| **Evidence** | where in the diff it is (or isn't) implemented — `file:line`, or `—` when missing |
| **Gap** | for `insufficient`/`missing`, what is not covered; `—` when verified |
| **Fix recommendation** | for `insufficient`/`missing`, the concrete change to make; `—` when verified |

Then close with a one-line verdict:

- **All verified** — "All N adopted mitigations verified in the implementation."
- **Gaps found** — "N of M mitigations need work: <M-tags> — please revisit them before
  presenting the change," naming exactly the `insufficient`/`missing` ones.

This report goes to the **coding agent**, not through user selection windows — there are no
gates in this skill.

## Red flags — stop if you catch yourself thinking…

| Thought | Reality |
|---------|---------|
| "No assessment file, I'll threat-model it now" | This skill verifies an existing assessment. No assessment for the task → stop; run `ingrain-security` at planning time instead. |
| "I'll just eyeball the diff myself" | Dispatch a read-only `ingrain-mitigation-verifier` per mitigation — don't inline the verification. |
| "I'm 60% sure it's implemented — call it verified" | Only mark `verified` (or `missing`) at ≥80% confidence; otherwise `insufficient` with the specific gap. Never silently pass. |
| "The verifier can just edit the Verified column itself" | Verifiers are read-only and return verdicts; **you** write the file, to avoid concurrent writes to one table. |
| "I'll write the results into a fresh file" | Write to the minted `assessment_abs` — the same file the planning review wrote. Never hand-build a path or create an `.ingrain-security/` folder. |
| "Only threat mitigations matter" | Verify **every** `selected` row — general implementation instructions too. |
| "I'll query the `ingrain` CLI for the rule bodies" | No CLI here — the rule bodies are in the planning-written `rules-<…>.md` sidecar; mint `rules_abs` and read it. Verifiers never call the CLI either. |
| "The org rule body overrides the mitigation Description" | The Description is the verification contract; the rule body only sharpens `verified` vs `insufficient`. Never fail a mitigation solely for diverging from a rule the Description did not require. |
| "No rules sidecar exists, so I can't verify" | The sidecar is absent whenever planning retrieved no org rules — expected, never a finding. Dispatch verifiers with no rule pointer; they verify from Descriptions. |
| "I'll update the sidecar with what I found" | The `rules-<…>.md` sidecar is a persistent planning artifact — this skill only reads it. Record results in the assessment's `Verified` column instead. |
| "I found a gap, I'll fix the code" | This skill writes no code. Report the gap and ask the coding agent to revisit it. |

## Rules

- **Verification, not planning.** Runs *after* code is written, on a task that already has an
  `.ingrain-security` assessment with adopted mitigations. It writes no code; its only
  assessment writes are the `Verified` column + `Latest stage: review`.
- **Read-only workers.** Verifiers make no code or repo edits — Read/Grep/Glob plus read-only
  git only, and **no CLI** — and write nothing; they return a verdict. Restate that in every
  dispatch.
- **Org rules are supporting context, read from the sidecar.** The adopted mitigations' rule
  bodies live in the planning-written `rules-<…>.md` sidecar, located by minting `rules_abs`;
  the orchestrator hands each verifier the rule(s) for its mitigation by pointer. No CLI is
  involved on either side. The sidecar may be absent (no rules retrieved) — that never blocks
  verification, and the mitigation Description, not the rule body, is the verification contract.
  Never modify or delete the sidecar — it is a persistent planning artifact.
- **Hand off by pointer; keep your context lean.** Point each verifier at its `## Mitigations`
  row **and, when the sidecar exists, its rule(s) in `rules_abs`**; don't paste the assessment,
  the sidecar, or the full diff into every dispatch. Read only the bounded slices you need.
- **The absolute path only.** Every read and the finalize write use the minted **absolute**
  `assessment_abs`; the relative `assessment_path` is display-only.
- **Confidence bar.** `verified`/`missing` require ≥80% confidence; otherwise `insufficient`
  with the concrete gap. Never mark a mitigation verified on a hunch.
- **Handle the empty cases.** No assessment → stop. Clean working tree → stop. Zero adopted
  mitigations → mark `Latest stage: review` and stop. Report, never fail silently.

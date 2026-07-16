# Phase B — the mitigation verification loop

This is the procedure for **Phase B** of the `ingrain-security` skill: the verification
counterpart to the planning review in `SKILL.md`. You are here because **Phase select** routed
you here — the task has an assessment carrying adopted mitigations and the working tree is
dirty. Nothing in `SKILL.md`'s Steps 0–7 applies: you do not threat-model, you run no user
gates, you make no `ingrain` CLI call, and you edit no code. You check that the mitigations
Gate 2 adopted were actually implemented, and you record the result.

**Announce:** open with "Using ingrain-security to verify the implemented mitigations."

You orchestrate one **read-only** worker role, `ingrain-mitigation-verifier`, defined by a
reference file at `references/ingrain-mitigation-verifier.md`. You dispatch it **once per
adopted mitigation** as a fresh subagent (see **How to dispatch a verifier**), hold the
verdicts yourself, then record them into the assessment file and report to the coding agent.
Workers do not write the file and cannot call each other or you.

## The assessment file

Phase B reads and finalizes the **same** per-task assessment file the Phase A planning review
wrote — a single file in `.ingrain-security/` at the project root. **Do not hand-build its
path.** Mint it once, at the start of the run, with the bundled **`scripts/assessment-path`**
script. Your SessionStart context carries the ready-to-run command (plugin root and host
already substituted); it takes the form:

    bash <plugin>/skills/ingrain-security/scripts/assessment-path <host> mint --title "<task title>"

**The `--title` must be the task's title as Phase A recorded it — reuse the assessment's
`## Task` → **Title** verbatim.** Never re-derive a title from the conversation or paraphrase
it: the mint is keyed on branch **+ task slug**, so a drifted title mints a *different* path,
returns `file_exists: false`, and sends Phase select back to Phase A — re-running the whole
planning review on code that is already written. If you reached Phase B via the Stop-hook
reminder or an explicit request and the mint returns `file_exists: false`, you almost
certainly minted the wrong title: recover it from the file itself (Glob
`<project_root>/.ingrain-security/assessment-*.md`, read the `## Task` Title of the one for
this task) and re-mint. Do **not** fall through to Phase A.

The script returns a JSON object. Use its **`assessment_abs`** — the **absolute** path —
verbatim as the file path for every read and for the finalize write, and obey the
`instruction` field it carries. The relative `assessment_path` is a **display form** only:
put it in prose and reports, never in a write target. The path is deterministic in the branch
+ task title:

    <project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md

so it resolves to the **same file** the planning review wrote for this task
(`file_exists: true` confirms it). The file's schema/template lives in
`references/assessment-file.md`; follow it exactly, including the enumerated values for the
`Verified` column (`verified` | `insufficient` | `missing`) and the `Latest stage` field
(`planning` | `development` | `review`).

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
by the same branch + task slug (schema: `references/rules-file.md`). To let each verifier judge
`verified` vs `insufficient` against *how the org implements* the control — not just the
mitigation's generic Description — locate that sidecar and hand each verifier the rule
descriptions for its mitigation. **This reads a file the planning review already wrote; there
is no CLI call here** — neither you nor the verifiers query `ingrain`.

**Do not hand-build the sidecar path.** Mint it with the bundled **`scripts/rules-path`**
script, the twin of `assessment-path`; your SessionStart context carries the ready-to-run
command:

    bash <plugin>/skills/ingrain-security/scripts/rules-path <host> mint --title "<task title>"

Use its **`rules_abs`** (absolute) as the read path, and the **same verbatim title** you minted
the assessment with. Because it is keyed by the same branch + task slug, it resolves to the
**same sidecar** the planning review wrote for this task.

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
not. See `references/platform-dispatch.md` for the per-platform mapping (host with a
subagent/task primitive → that primitive, one verifier per call; no-subagent fallback →
sequential in-context execution).

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

0. **Locate the assessment.** Mint the path with the task's `## Task` Title **verbatim** (see
   **The assessment file**). If `file_exists: false`, you minted the wrong title — recover it
   from the file and re-mint. If no assessment for this task genuinely exists, state so and
   **stop**; do not fall through to the Phase A planning review.
1. **Capture the diff.** Capture the working-tree diff once (see **The diff under review**).
   If the tree is clean, state "no changes to verify" and **stop**.
2. **Collect adopted mitigations.** Read the bounded `## Mitigations` slice of the assessment
   file and take every row whose **Selection** is `selected` — both threat mitigations and
   general implementation instructions. If **none** are selected, state "no adopted
   mitigations to verify", set `Latest stage: review`, and **stop** (nothing to check). If
   threats were selected but every mitigation was declined, note that the selected threats
   were accepted with no adopted mitigation — there is nothing to verify.
3. **Locate the rules file.** Mint `rules_abs` with the `rules-path` command and the same
   verbatim title (see **The rules file**). If `file_exists: true`, it carries this task's org
   rules — you will hand each verifier the rule(s) for its mitigation by pointer. If
   `file_exists: false`, no rules were retrieved at planning; verifiers verify from
   Descriptions alone. This is supporting context only — never a blocker and never a finding.
   (No CLI is involved.)
4. **Dispatch verifiers.** Dispatch one `ingrain-mitigation-verifier` per adopted mitigation
   (see **How to dispatch a verifier**), each pointed at its `M<n>` row, the threat(s) it
   covers, **and — when the sidecar exists — its rule(s) in `rules_abs`**. Collect each verdict
   (`verified` | `insufficient` | `missing`) plus its one-line evidence/gap.
5. **Finalize the assessment (you write).** Write each verdict into the **`Verified`**
   column of the `## Mitigations` table (per `references/assessment-file.md`), leaving
   excluded/undecided rows as `—`, and set `## Task` → `Latest stage: review`. Write to the
   minted `assessment_abs`. On a re-verification (the file was already at `Latest stage:
   review` and the code changed again), **overwrite** the previous verdicts — the column
   records the current implementation, not a history. The `rules-<…>.md` sidecar is a
   persistent planning artifact — **do not modify or delete it**. This is the "mark checked"
   step — the file now records what was verified.
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
gates in Phase B.

## Red flags — stop if you catch yourself thinking…

| Thought | Reality |
|---------|---------|
| "`file_exists: false`, but I'm clearly verifying code I just wrote" | You minted the wrong title. The mint is keyed on branch + task slug, so a paraphrased title resolves to a different path. Recover the `## Task` Title from the assessment file and re-mint **verbatim** — never fall through to the Phase A planning review on code that is already written. |
| "No assessment file, I'll threat-model it now" | Phase B verifies an existing assessment. No assessment for the task → stop; Phase A runs at planning time, not after the code is written. |
| "I'll just eyeball the diff myself" | Dispatch a read-only `ingrain-mitigation-verifier` per mitigation — don't inline the verification. |
| "I'm 60% sure it's implemented — call it verified" | Only mark `verified` (or `missing`) at ≥80% confidence; otherwise `insufficient` with the specific gap. Never silently pass. |
| "The verifier can just edit the Verified column itself" | Verifiers are read-only and return verdicts; **you** write the file, to avoid concurrent writes to one table. |
| "I'll write the results into a fresh file" | Write to the minted `assessment_abs` — the same file the planning review wrote. Never hand-build a path or create an `.ingrain-security/` folder. |
| "Only threat mitigations matter" | Verify **every** `selected` row — general implementation instructions too. |
| "I'll query the `ingrain` CLI for the rule bodies" | No CLI in Phase B — the rule bodies are in the planning-written `rules-<…>.md` sidecar; mint `rules_abs` and read it. Verifiers never call the CLI either. |
| "The org rule body overrides the mitigation Description" | The Description is the verification contract; the rule body only sharpens `verified` vs `insufficient`. Never fail a mitigation solely for diverging from a rule the Description did not require. |
| "No rules sidecar exists, so I can't verify" | The sidecar is absent whenever planning retrieved no org rules — expected, never a finding. Dispatch verifiers with no rule pointer; they verify from Descriptions. |
| "I'll update the sidecar with what I found" | The `rules-<…>.md` sidecar is a persistent planning artifact — Phase B only reads it. Record results in the assessment's `Verified` column instead. |
| "The file is already at `Latest stage: review`, so it's done" | That only means a previous verification ran. If the code changed again, re-verify and overwrite the verdicts — the column records the current implementation. |
| "I found a gap, I'll fix the code" | Phase B writes no code. Report the gap and ask the coding agent to revisit it. |

## Rules

- **Verification, not planning.** Phase B runs *after* code is written, on a task that already
  has an `.ingrain-security` assessment with adopted mitigations. It writes no code; its only
  assessment writes are the `Verified` column + `Latest stage: review`. It never falls back to
  the Phase A planning review.
- **The title is the key — reuse it verbatim.** Every mint (`assessment-path` and
  `rules-path`) uses the assessment's `## Task` Title exactly as written. A paraphrase mints a
  different file and silently loses the task.
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

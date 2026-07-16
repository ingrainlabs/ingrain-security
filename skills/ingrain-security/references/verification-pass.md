# Phase B — the mitigation verification loop

This is the procedure for **Phase B** of the `ingrain-security` skill: the verification
counterpart to the planning review in `SKILL.md`. You are here because **Phase select** routed
you here — the task has an assessment carrying adopted mitigations and the working tree is
dirty. Nothing in `SKILL.md`'s Steps 0–7 applies: you do not threat-model, you run no user
gates, you make no `ingrain` CLI call, and you edit no code. You check that the mitigations
Gate 2 adopted were actually implemented, and you record the result.

**Announce:** open with "Using ingrain-security to verify the implemented mitigations."

You orchestrate **two read-only** worker roles and reconcile them yourself:

- **`ingrain-mitigation-verifier`** (`references/ingrain-mitigation-verifier.md`) — the
  **informed** read. One per adopted mitigation, each holding that mitigation, the threats it
  covers, and its org rules (see **How to dispatch a verifier**).
- **`ingrain-blind-maturity-reviewer`** (`references/ingrain-blind-maturity-reviewer.md`) — **one**
  deliberately uninformed read of the same diff, given the task title and nothing else (see
  **How to dispatch the blind reviewer**).

**Two reads exist because agreement is only worth something if the second one could have
disagreed.** A verifier handed a mitigation and asked whether it is implemented is under quiet
pressure to find it; a reader who does not know what was planned is the one who can notice that
the control does not actually hold, or that the change implements something nobody listed.

Neither worker writes the file, and neither can call the other or you: they return
**justifications**, you weigh them, you conclude, you record (see **Reconciling the two reads**).

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
planning review on code that is already written. If you reached Phase B via an explicit request
and the mint returns `file_exists: false`, you almost
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
**Verification level** column (`fail` | `accepted` | `high`), the ≤256-char **Justification**
beside it, and the `Latest stage` field (`planning` | `development` | `review`).

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

## Maturity levels

Every adopted mitigation lands on one of three levels. They are a **ladder**, not a verdict
pair — this is the one definition both dispatches and `references/assessment-file.md` point at:

- **`fail`** — the intended mitigation is **not sufficiently implemented**. Absent from the
  change, or present and not holding: bypassable, one path covered and another not, a stub. The
  old split between "missing" and "insufficient" is gone from the file on purpose — to the coding
  agent both mean *go back to this one* — but it is not gone from the **report**: the Evidence
  and Gap columns say which it is.
- **`accepted`** — the mitigation is implemented **as its Description describes**. The contract
  is met. This is a pass.
- **`high`** — the threat is covered by a **broad, comprehensive** mitigation **and** supporting
  artefacts back it: tests that adversarially exercise the control and would fail if it
  regressed. Take the mitigation "escape all custom CSS": no escaping is `fail`; a CSS escape on
  the custom-CSS path is `accepted`; that escape plus tests proving injected CSS comes out
  escaped is `high`.

**`high` is `accepted` plus artefacts — never a synonym for "well implemented".** And the
absence of artefacts never makes a mitigation `fail`: an implemented-as-described control with
no tests is `accepted`. The missing artefact is what separates `high` from `accepted`, not
`accepted` from `fail`. `fail` is also where **uncertainty** lands — a level is only `accepted`
or `high` at the ≥80% confidence bar.

## The rules file

Each adopted mitigation carries **Rule ref ids** (the `Rule refs` column of `## Mitigations`)
but not the rule bodies. The planning review persisted the rule bodies to a **linked sidecar**,
`.ingrain-security/rules-<branch-slug>-<task-slug>.md` — the twin of the assessment file, keyed
by the same branch + task slug (schema: `references/rules-file.md`). To let each verifier judge
`fail` vs `accepted` against *how the org implements* the control — not just the
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

The rules are **supporting context only**: their presence sharpens `fail` vs `accepted`,
their absence never blocks verification. A mitigation whose `Rule refs` is `—` has no backing
rule — the verifier works from its Description. The blind reviewer is given **no** rules and no
path to them — that is deliberate; see **How to dispatch the blind reviewer**.

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
rule(s) for its Rule refs** rather than pasting the files; the verifier **returns a justification
and a level, and does not write the assessment file** (you reconcile and record, to avoid
concurrent writes to one table):

```
Read references/ingrain-mitigation-verifier.md and follow it as your system prompt.
You do no code or repo edits — use only Read/Grep/Glob on the codebase, plus read-only git
(git diff HEAD, git status, git show) to obtain the working-tree diff. You run NO ingrain/CLI
commands — any org rule you need is in the rules sidecar named below. You write NOTHING —
not the assessment file, not any file; you only return your justification and level.
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
Return ONLY, in this order: JUSTIFICATION (≤256 chars — your reasoning against the Description),
then LEVEL (fail | accepted | high) for <M-tag>, then EVIDENCE (file:line in the diff), and —
when the level is `fail` — the GAP (whether the mitigation is ABSENT or PRESENT-BUT-INSUFFICIENT,
what the Description requires that the code does not do, and the change that would close it).
The justification comes FIRST: it is what I weigh, and writing it first is what stops the level
from being a guess. Do not return the full diff or a long analysis.
```

Dispatch verifiers for **all** adopted mitigations (fan them out where the host runs subagents in
parallel; run them in tag order where it does not).

**Do not branch on the level word a verifier leads with.** Hold its justification and its level
together and take both to **Reconciling the two reads** — the level is a conclusion you are going
to re-derive, not an answer you route on.

## How to dispatch the blind reviewer

Exactly **one**, however many mitigations there are. Dispatch it **alongside** the verifiers
where the host runs subagents in parallel — it depends on nothing they produce, and it must
never be told anything they returned.

**This dispatch is the one exception to hand-off-by-pointer, and it is an exception by
subtraction, not addition.** Every other dispatch withholds the content and passes a pointer;
this one withholds the pointer too. It gets no `assessment_abs`, no `rules_abs`, no M-tags, no
threats, no mitigation Descriptions, no Selection state — nothing that would tell it what to
find. Do not "help" it with a hint about what the change was supposed to do beyond the task
title. The moment it knows what you expect, it stops being a second read and becomes a second
opinion on your first one.

```
Read references/ingrain-blind-maturity-reviewer.md and follow it as your system prompt.
You do no code or repo edits — use only Read/Grep/Glob on the codebase, plus read-only git
(git diff HEAD, git status, git show) to obtain the working-tree diff. You run NO ingrain/CLI
commands. You write NOTHING — not any file; you only return your report.
INPUT:
- The task is titled: "<the task's `## Task` Title, verbatim>".
- Review the working-tree diff. Report which security controls this change implements and at
  what maturity level (fail | accepted | high), each with a JUSTIFICATION first, then the
  LEVEL, then file:line EVIDENCE — per your reference file's Output section.
- You are given no threat list, no mitigation list, no org rules, and no analysis file: that is
  deliberate, and it is the whole point of your read. Do not go looking for one.
```

## Reconciling the two reads

You now hold, per adopted mitigation, the informed verifier's justification and level; and, for
whichever controls the blind reviewer happened to land on, a blind justification and level.

**Do not compare the two level words.** A word match is not agreement and a word mismatch is not
a conflict — both words are the *output* of a reasoning, and the reasoning is what you are here
to judge. Per mitigation, in this order:

1. **Read both justifications before you look at either level.** If you have already seen the
   levels, set them aside deliberately: you are re-deriving that conclusion, not refereeing it.
2. **Weigh each justification on its evidence.** Strong: it cites a concrete `file:line` in the
   diff and says what the code *at that line* does or fails to do. Weak: it asserts a conclusion
   ("the control is in place", "looks comprehensive"), reasons from the mitigation's wording
   rather than from the code, cites a file with no line, or cites nothing. Length, confidence,
   and fluency are not evidence.
3. **The informed verifier is the prior.** It read the Description, the threats the mitigation
   covers, and the org rule bodies; the blind reviewer read none of them, so on *what this
   mitigation was supposed to be* the informed read is simply better positioned. **Start from the
   informed level and keep it** unless the blind justification is better-evidenced **on the same
   point**: a concrete `file:line` the informed read did not reckon with, or a specific
   contradiction of the line it cited. A blind justification that merely disagrees, or is more
   thorough-sounding, or is more confident, does not move a level. **Never split the difference
   and never average — there is no midpoint between two reasons.**
4. **Direction matters:**
   - **Blind lower than informed** — lower only when the blind justification names concrete code
     the informed one did not account for: a second unescaped path, a bypass, a stub behind the
     check. It is the most valuable thing the blind read produces, and also the easiest to
     over-credit.
   - **Blind higher than informed** — a blind `high` raises an informed `accepted` only by
     supplying `high`'s missing half: an artefact at a cited `file:line` that adversarially
     exercises the control. Enthusiasm does not raise.
   - **Blind finds it where the informed read said `fail`** — check the blind `file:line` against
     the Description **yourself**; you have the Description and the blind reviewer did not. If
     that code does what the Description requires, the informed verifier looked in the wrong
     place: raise to `accepted`.
   - **`high` needs both halves, from either source.** Broad coverage evidenced by one read and
     artefacts evidenced by the other, neither contradicted, is `high`. Artefacts asserted but
     not cited is `accepted`.
5. **Silence is not evidence.** The blind reviewer not mentioning a mitigation says nothing about
   it — it had no mitigation list and was not looking. **Silence never lowers a level.** Only a
   positive blind finding, with evidence, is input at all.
6. **Conclude, then write.** The level you record is **yours**, and so is the Justification: ≤256
   characters, in your own words, naming the evidence it rests on — not either worker's text
   pasted across. Where the blind read moved the level, the justification says what moved it.

**Blind findings that map to no adopted mitigation row** — a control the change implements that
nothing in `## Mitigations` asked for, or a control the blind reviewer flagged as conspicuously
absent — **need a home, and it is not that table.** Phase B adds no mitigation rows:
`## Mitigations` is the set the user adopted at Gate 2, and inventing a row there would launder
an unreviewed finding into a decided one. Record them in the assessment's
`## Coverage / open items`, as a Phase B blind-review block (rewritten wholesale on
re-verification, leaving Phase A's coverage bullets alone), and name them in your report.

## Phase B — the flow

Each step is one action; the tracker for them is **Phase B — checklist** at the end of this
file.

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
4. **Dispatch the informed verifiers.** Dispatch one `ingrain-mitigation-verifier` per adopted
   mitigation (see **How to dispatch a verifier**), each pointed at its `M<n>` row, the threat(s)
   it covers, **and — when the sidecar exists — its rule(s) in `rules_abs`**. Collect each one's
   justification, then its level (`fail` | `accepted` | `high`), plus its evidence and — on
   `fail` — the gap. Do not act on a level yet.
5. **Dispatch the blind reviewer.** Dispatch **exactly one** `ingrain-blind-maturity-reviewer`
   (see **How to dispatch the blind reviewer**) with the task title and nothing else — no
   assessment path, no rules path, no mitigations, no threats. Fan it out alongside Step 4 where
   the host runs subagents in parallel; it waits on nothing and is told nothing the verifiers
   returned. Collect its per-control justification/level/evidence.
6. **Reconcile the two reads (you decide).** For each adopted mitigation, read both
   justifications, weigh them on their evidence, and conclude the level yourself — the informed
   read is the prior (see **Reconciling the two reads**). Write your own ≤256-char justification
   for each. Set aside any blind finding that maps to no mitigation row for Step 7.
7. **Finalize the assessment (you write).** Write each reconciled justification into the
   **`Justification`** column and each concluded level into the **`Verification level`** column of
   the `## Mitigations` table (per `references/assessment-file.md`), leaving excluded/undecided
   rows as `—` in both; append the unmapped blind findings as the blind-review block of
   `## Coverage / open items`; and set `## Task` → `Latest stage: review`. One write, to the
   minted `assessment_abs`. On a re-verification (the file was already at `Latest stage: review`
   and the code changed again), **overwrite** the previous justifications, levels, and
   blind-review block — they record the current implementation, not a history. The
   `rules-<…>.md` sidecar is a persistent planning artifact — **do not modify or delete it**.
   This is the "mark checked" step — the file now records what was verified.
8. **Report to the coding agent.** Present the findings (see **Reporting format**) and close
   with a one-line verdict. If any mitigation is `fail`, ask the coding agent to revisit exactly
   those.

## Reporting format

Report the reconciled results to the coding agent as **visible Markdown output in the
conversation** — one row per adopted mitigation, in tag order (`M1` first), with these columns:

| Column | Contents |
|--------|----------|
| **Mitigation** | tag + short title (e.g. `M1 — authenticate token refresh`) |
| **Addresses** | the threat tag(s) it covers (`T1`, `T3`, …), or `general` for an implementation instruction not tied to a threat |
| **Justification** | the reasoning you concluded — the same one you wrote to the table |
| **Level** | `fail` \| `accepted` \| `high` |
| **Evidence** | where in the diff it is (or isn't) implemented — `file:line`, or `—` when nothing implements it |
| **Gap** | for `fail`: **whether the mitigation is absent or present-but-insufficient**, and what is not covered. **This column is the only place that distinction survives** — the file stores one `fail`, and the two mean different work: "write this" vs "fix this". `—` otherwise |
| **Fix recommendation** | for `fail`, the concrete change to make; `—` otherwise |
| **Second read** | what the blind reviewer contributed: `agrees` \| `raised to <level>` \| `lowered to <level>` \| `not seen` (which is not a finding) |

Then, when the blind reviewer surfaced anything that maps to no adopted mitigation, a short
**Blind review — controls with no adopted mitigation** list mirroring what you wrote to
`## Coverage / open items` — one line each: the control, its level, and `file:line`.

Then close with a one-line verdict:

- **All at `accepted` or above** — "All N adopted mitigations are implemented (M2, M4 at
  `high`)."
- **Gaps found** — "N of M mitigations are at `fail`: <M-tags> — please revisit them before
  presenting the change," naming exactly the `fail` ones.

Add one line if the blind read surfaced anything unmapped, so it is not lost in the table.

This report goes to the **coding agent**, not through user selection windows — there are no
gates in Phase B.

## Red flags — stop if you catch yourself thinking…

| Thought | Reality |
|---------|---------|
| "`file_exists: false`, but I'm clearly verifying code I just wrote" | You minted the wrong title. The mint is keyed on branch + task slug, so a paraphrased title resolves to a different path. Recover the `## Task` Title from the assessment file and re-mint **verbatim** — never fall through to the Phase A planning review on code that is already written. |
| "No assessment file, I'll threat-model it now" | Phase B verifies an existing assessment. No assessment for the task → stop; Phase A runs at planning time, not after the code is written. |
| "I'll just eyeball the diff myself" | Dispatch a read-only `ingrain-mitigation-verifier` per mitigation, plus the one blind reviewer — don't inline the verification. |
| "I'm 60% sure it's implemented — call it `accepted`" | `accepted` and `high` need the **≥80%** bar. Below it the level is `fail` with the specific gap — uncertainty lands on `fail` by design. Never round up on a hunch, never silently pass. |
| "It's implemented, so `high`" | `high` is `accepted` **plus** supporting artefacts — tests that adversarially prove the control holds, at a cited `file:line`. Implemented-as-described with no artefacts is `accepted`, and never `fail`: the missing artefact separates `high` from `accepted`, not `accepted` from `fail`. |
| "Informed says `accepted`, blind says `fail` — that's a conflict, take the worse one" | Neither word is evidence. Read both justifications, weigh their `file:line`, and conclude. A mismatch of *words* is not a conflict; a contradiction of *evidence* is. |
| "They disagree — I'll split the difference" | There is no midpoint between two reasons. The informed read is the prior; it holds unless the blind justification cites concrete code it did not reckon with. |
| "The blind reviewer didn't mention M3, so M3 isn't implemented" | It had no mitigation list — it was never looking for M3. Silence is not evidence of absence and never lowers a level. |
| "I'll give the blind reviewer the assessment path so it can be useful" | Then it is not blind, and its read is worth nothing as a check — it will find exactly what you told it to expect. It gets the diff and the task title. That is the whole design. |
| "I'll pick the level, then write a justification for it" | Justification leads the level for the same reason it leads the scores in `## Threats`: reasoning first, so it drives the conclusion instead of dressing it. |
| "I'll paste the verifier's justification into the table" | The **Justification** column is *your* conclusion from both reads, in your own words, ≤256 chars. Workers return justifications; they never write the table. |
| "The blind agent found a control with no mitigation row — I'll add a row" | Phase B adds no mitigations: `## Mitigations` is the Gate 2 adopted set. Record it under `## Coverage / open items` and name it in the report. |
| "The verifier can just edit the `Verification level` column itself" | Both Phase B workers are read-only and return reasoning; **you** reconcile and write, to avoid concurrent writes to one table. |
| "I'll write the results into a fresh file" | Write to the minted `assessment_abs` — the same file the planning review wrote. Never hand-build a path or create an `.ingrain-security/` folder. |
| "Only threat mitigations matter" | Verify **every** `selected` row — general implementation instructions too. |
| "I'll query the `ingrain` CLI for the rule bodies" | No CLI in Phase B — the rule bodies are in the planning-written `rules-<…>.md` sidecar; mint `rules_abs` and read it. Verifiers never call the CLI either. |
| "The org rule body overrides the mitigation Description" | The Description is the verification contract; the rule body only sharpens `fail` vs `accepted`. Never fail a mitigation solely for diverging from a rule the Description did not require. |
| "No rules sidecar exists, so I can't verify" | The sidecar is absent whenever planning retrieved no org rules — expected, never a finding. Dispatch verifiers with no rule pointer; they verify from Descriptions. |
| "I'll update the sidecar with what I found" | The `rules-<…>.md` sidecar is a persistent planning artifact — Phase B only reads it. Record results in the assessment's `Justification` + `Verification level` columns instead. |
| "The file is already at `Latest stage: review`, so it's done" | That only means a previous verification ran. If the code changed again, re-verify and overwrite the justifications and levels — they record the current implementation. |
| "I found a gap, I'll fix the code" | Phase B writes no code. Report the gap and ask the coding agent to revisit it. |

## Phase B — checklist

The procedure is **Phase B — the flow**; this is the tracker. Tick only what is actually
done. Work top to bottom, and never fall back to the Phase A planning review. Every mint
(`assessment-path` and `rules-path`) uses the assessment's `## Task` Title **verbatim** — a
paraphrase mints a different file and silently loses the task. Every read and the finalize
write use the absolute `assessment_abs`; the relative `assessment_path` is display-only. Hand
off by pointer: never paste the assessment, the sidecar, or the full diff into a dispatch — and
**the blind reviewer gets no pointer to anything**, the one deliberate exception to that rule.
Report the empty cases, never fail silently.

- [ ] 0. Assessment located — title minted verbatim; no assessment for this task → stop
- [ ] 1. Diff captured once — clean tree → stop
- [ ] 2. Adopted mitigations collected (`Selection: selected`) — none → set `Latest stage: review` and stop
- [ ] 3. Rules sidecar located (`rules_abs`) — absent is expected, never a blocker, never a finding
- [ ] 4. One informed verifier dispatched per adopted mitigation — justification FIRST, then `fail`/`accepted`/`high` at the ≥80% bar
- [ ] 5. Exactly one blind reviewer dispatched — task title + diff only; no assessment, no mitigations, no rules, no pointer to them
- [ ] 6. Both reads reconciled — justifications weighed BEFORE the levels; informed is the prior; blind silence lowers nothing; the conclusion is YOURS
- [ ] 7. `Justification` + `Verification level` + `Latest stage: review` written, unmapped blind findings → `## Coverage / open items` — YOU write, workers don't; sidecar untouched
- [ ] 8. Reported to the coding agent — `fail` rows named, absent vs insufficient distinguished in the Gap; Phase B writes no code

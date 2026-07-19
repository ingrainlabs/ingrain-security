# Testing — the mitigation verification loop

This is the procedure for the **Testing** phase of the `ingrain-security` skill: the verification
counterpart to the plan review in `SKILL.md`. You are here because **Phase select** routed
you here — the task has an assessment carrying adopted mitigations and the working tree is
dirty. Nothing in `SKILL.md`'s Steps 0–7 applies: you do not threat-model, you run no user
gates, you make no `ingrain` CLI call, and you edit no code. You check that the mitigations
Gate 2 adopted were actually implemented, and you record the result.

**Announce:** open with "Using ingrain-security to verify the implemented mitigations."

You orchestrate **one read-only** worker role and conclude from it yourself:

- **`ingrain-mitigation-verifier`** (`references/ingrain-mitigation-verifier.md`) — the
  **informed** read. One per adopted mitigation, each holding that mitigation, the threats it
  covers, and its org rules (see **How to dispatch a verifier**).

A verifier handed a mitigation and asked whether it is implemented is under quiet pressure to
find it. That is why it returns a **justification**, not a verdict: the level it leads with is a
conclusion you re-derive from the evidence it cites, not an answer you route on.

The verifier does not write the file, and it cannot call you: it returns a **justification**, you
weigh it, you conclude, you record (see **Concluding the level**).

## The assessment file

Testing reads and finalizes the **same** per-task assessment file the plan review
wrote — a single file in `.ingrain-security/` at the project root. **Do not hand-build its
path.** Mint it once, at the start of the run, with the bundled **`scripts/assessment-path`**
script. Your SessionStart context carries the ready-to-run command (plugin root and host
already substituted); it takes the form:

    bash <plugin>/skills/ingrain-security/scripts/assessment-path <host> mint --title "<task title>"

**The `--title` must be the task's title as Development recorded it — reuse the assessment's
`## Task` → **Title** verbatim.** Never re-derive a title from the conversation or paraphrase
it: the mint is keyed on branch **+ task slug**, so a drifted title mints a *different* path,
returns `file_exists: false`, and sends Phase select back to Development — re-running the whole
plan review on code that is already written. If you reached Testing via an explicit request
and the mint returns `file_exists: false`, you almost
certainly minted the wrong title: recover it from the file itself (Glob
`<project_root>/.ingrain-security/assessment-*.md`, read the `## Task` Title of the one for
this task) and re-mint. Do **not** fall through to Development.

The script returns a JSON object. Use its **`assessment_abs`** — the **absolute** path —
verbatim as the file path for every read and for the finalize write, and obey the
`instruction` field it carries. The relative `assessment_path` is a **display form** only:
put it in prose and reports, never in a write target. The path is deterministic in the branch
+ task title:

    <project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md

so it resolves to the **same file** the plan review wrote for this task
(`file_exists: true` confirms it). The file's schema/template lives in
`references/formatting/assessment-file.md`; follow it exactly, including the enumerated values for the
**Verification level** column (`fail` | `accepted` | `high`), the ≤256-char **Justification**
beside it, and the `Latest stage` field (`development` | `testing`).

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
pair — this is the one definition both dispatches and `references/formatting/assessment-file.md` point at:

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
but not the rule bodies. The plan review persisted the rule bodies to a **linked sidecar**,
`.ingrain-security/rules-<branch-slug>-<task-slug>.md` — the twin of the assessment file, keyed
by the same branch + task slug (schema: `references/formatting/rules-file.md`). To let each verifier judge
`fail` vs `accepted` against *how the org implements* the control — not just the
mitigation's generic Description — locate that sidecar and hand each verifier the rule
descriptions for its mitigation. **This reads a file the plan review already wrote; there
is no CLI call here** — neither you nor the verifiers query `ingrain`.

**Do not hand-build the sidecar path.** Mint it with the bundled **`scripts/rules-path`**
script, the twin of `assessment-path`; your SessionStart context carries the ready-to-run
command:

    bash <plugin>/skills/ingrain-security/scripts/rules-path <host> mint --title "<task title>"

Use its **`rules_abs`** (absolute) as the read path, and the **same verbatim title** you minted
the assessment with. Because it is keyed by the same branch + task slug, it resolves to the
**same sidecar** the plan review wrote for this task.

- **`file_exists: true`** — the sidecar carries this task's org rules. Read the bounded
  `## Retrieved rules` / `## Per-mitigation mapping` slices you need to give each verifier the
  rule(s) behind its mitigation's Rule refs (by pointer — see **How to dispatch a verifier**).
- **`file_exists: false`** — no org rules were retrieved for this task at planning time (the
  CLI was absent, unconfigured, or returned nothing). There is nothing to hand the verifiers;
  they verify from the mitigation Descriptions alone. This is **never** a finding.

The rules are **supporting context only**: their presence sharpens `fail` vs `accepted`,
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
rule(s) for its Rule refs** rather than pasting the files; the verifier **returns a justification
and a level, and does not write the assessment file** (you conclude and record, to avoid
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
together and take both to **Concluding the level** — the level is a conclusion you are going
to re-derive, not an answer you route on.

## Concluding the level

You now hold, per adopted mitigation, the verifier's justification and the level it led with.
**The level you record is your own conclusion, not the verifier's answer forwarded.** Per
mitigation, in this order:

1. **Read the justification before you look at the level.** If you have already seen the level,
   set it aside deliberately: you are re-deriving that conclusion, not rubber-stamping it.
2. **Weigh the justification on its evidence.** Strong: it cites a concrete `file:line` in the
   diff and says what the code *at that line* does or fails to do. Weak: it asserts a conclusion
   ("the control is in place", "looks comprehensive"), reasons from the mitigation's wording
   rather than from the code, cites a file with no line, or cites nothing. Length, confidence,
   and fluency are not evidence.
3. **A justification that does not carry its level does not get it.** `accepted` and `high` need
   the ≥80% bar, and the evidence is what clears it: an `accepted` resting on an assertion rather
   than a cited line is `fail` with the gap named, and a `high` whose artefact is asserted but
   never cited at a `file:line` is `accepted`. Read the cited line yourself where the level turns
   on it — you hold the Description and the verifier's reading of it is not the last word.
4. **Conclude, then write.** The level you record is **yours**, and so is the Justification: ≤256
   characters, in your own words, naming the evidence it rests on — not the verifier's text
   pasted across. Where you departed from the level the verifier led with, say what moved it.

## Testing — the flow

Each step is one action; the tracker for them is **Testing — checklist** at the end of this
file.

0. **Locate the assessment.** Mint the path with the task's `## Task` Title **verbatim** (see
   **The assessment file**). If `file_exists: false`, you minted the wrong title — recover it
   from the file and re-mint. If no assessment for this task genuinely exists, state so and
   **stop**; do not fall through to the plan review.
1. **Capture the diff.** Capture the working-tree diff once (see **The diff under review**).
   If the tree is clean, state "no changes to verify" and **stop**.
2. **Collect adopted mitigations.** Read the bounded `## Mitigations` slice of the assessment
   file and take every row whose **Selection** is `selected` — both threat mitigations and
   general implementation instructions. If **none** are selected, state "no adopted
   mitigations to verify", set `Latest stage: testing`, and **stop** (nothing to check). If
   threats were selected but every mitigation was declined, note that the selected threats
   were accepted with no adopted mitigation — there is nothing to verify.
3. **Locate the rules file.** Mint `rules_abs` with the `rules-path` command and the same
   verbatim title (see **The rules file**). If `file_exists: true`, it carries this task's org
   rules — you will hand each verifier the rule(s) for its mitigation by pointer. If
   `file_exists: false`, no rules were retrieved at planning; verifiers verify from
   Descriptions alone. This is supporting context only — never a blocker and never a finding.
   (No CLI is involved.)
4. **Dispatch the verifiers.** Dispatch one `ingrain-mitigation-verifier` per adopted
   mitigation (see **How to dispatch a verifier**), each pointed at its `M<n>` row, the threat(s)
   it covers, **and — when the sidecar exists — its rule(s) in `rules_abs`**. Collect each one's
   justification, then its level (`fail` | `accepted` | `high`), plus its evidence and — on
   `fail` — the gap. Do not act on a level yet.
5. **Conclude each level (you decide).** For each adopted mitigation, read the verifier's
   justification, weigh it on its evidence, and conclude the level yourself (see **Concluding
   the level**). Write your own ≤256-char justification for each.
6. **Finalize the assessment (you write).** Write each concluded justification into the
   **`Justification`** column and each concluded level into the **`Verification level`** column of
   the `## Mitigations` table (per `references/formatting/assessment-file.md`), leaving excluded/undecided
   rows as `—` in both; and set `## Task` → `Latest stage: testing`. One write, to the
   minted `assessment_abs`. On a re-verification (the file was already at `Latest stage: testing`
   and the code changed again), **overwrite** the previous justifications and levels — they
   record the current implementation, not a history. The
   `rules-<…>.md` sidecar is a persistent planning artifact — **do not modify or delete it**.
   This is the "mark checked" step — the file now records what was verified.
7. **Report to the coding agent.** Present the findings (see **Reporting format**) and close
   with a one-line verdict. If any mitigation is `fail`, ask the coding agent to revisit exactly
   those.

## Reporting format

Report the concluded results to the coding agent as **visible Markdown output in the
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

Then close with a one-line verdict:

- **All at `accepted` or above** — "All N adopted mitigations are implemented (M2, M4 at
  `high`)."
- **Gaps found** — "N of M mitigations are at `fail`: <M-tags> — please revisit them before
  presenting the change," naming exactly the `fail` ones.

This report goes to the **coding agent**, not through user selection windows — there are no
gates in Testing.

## Red flags — stop if you catch yourself thinking…

| Thought | Reality |
|---------|---------|
| "`file_exists: false`, but I'm clearly verifying code I just wrote" | You minted the wrong title. The mint is keyed on branch + task slug, so a paraphrased title resolves to a different path. Recover the `## Task` Title from the assessment file and re-mint **verbatim** — never fall through to the plan review on code that is already written. |
| "No assessment file, I'll threat-model it now" | Testing verifies an existing assessment. No assessment for the task → stop; Development runs at planning time, not after the code is written. |
| "I'll just eyeball the diff myself" | Dispatch a read-only `ingrain-mitigation-verifier` per mitigation — don't inline the verification. |
| "I'm 60% sure it's implemented — call it `accepted`" | `accepted` and `high` need the **≥80%** bar. Below it the level is `fail` with the specific gap — uncertainty lands on `fail` by design. Never round up on a hunch, never silently pass. |
| "It's implemented, so `high`" | `high` is `accepted` **plus** supporting artefacts — tests that adversarially prove the control holds, at a cited `file:line`. Implemented-as-described with no artefacts is `accepted`, and never `fail`: the missing artefact separates `high` from `accepted`, not `accepted` from `fail`. |
| "The verifier said `accepted`, so it's `accepted`" | The level it leads with is a conclusion you re-derive, not an answer you forward. Read its justification, weigh the `file:line` it cites, and conclude yourself — an `accepted` resting on an assertion rather than a cited line is `fail` with the gap named. |
| "I'll pick the level, then write a justification for it" | Justification leads the level for the same reason it leads the scores in `## Threats`: reasoning first, so it drives the conclusion instead of dressing it. |
| "I'll paste the verifier's justification into the table" | The **Justification** column is *your* conclusion, in your own words, ≤256 chars. Workers return justifications; they never write the table. |
| "The verifier can just edit the `Verification level` column itself" | The verifier is read-only and returns reasoning; **you** conclude and write, to avoid concurrent writes to one table. |
| "I'll write the results into a fresh file" | Write to the minted `assessment_abs` — the same file the plan review wrote. Never hand-build a path or create an `.ingrain-security/` folder. |
| "Only threat mitigations matter" | Verify **every** `selected` row — general implementation instructions too. |
| "I'll query the `ingrain` CLI for the rule bodies" | No CLI in Testing — the rule bodies are in the planning-written `rules-<…>.md` sidecar; mint `rules_abs` and read it. Verifiers never call the CLI either. |
| "The org rule body overrides the mitigation Description" | The Description is the verification contract; the rule body only sharpens `fail` vs `accepted`. Never fail a mitigation solely for diverging from a rule the Description did not require. |
| "No rules sidecar exists, so I can't verify" | The sidecar is absent whenever planning retrieved no org rules — expected, never a finding. Dispatch verifiers with no rule pointer; they verify from Descriptions. |
| "I'll update the sidecar with what I found" | The `rules-<…>.md` sidecar is a persistent planning artifact — Testing only reads it. Record results in the assessment's `Justification` + `Verification level` columns instead. |
| "The file is already at `Latest stage: testing`, so it's done" | That only means a previous verification ran. If the code changed again, re-verify and overwrite the justifications and levels — they record the current implementation. |
| "I found a gap, I'll fix the code" | Testing writes no code. Report the gap and ask the coding agent to revisit it. |

## Testing — checklist

The procedure is **Testing — the flow**; this is the tracker. Tick only what is actually
done. Work top to bottom, and never fall back to the plan review. Every mint
(`assessment-path` and `rules-path`) uses the assessment's `## Task` Title **verbatim** — a
paraphrase mints a different file and silently loses the task. Every read and the finalize
write use the absolute `assessment_abs`; the relative `assessment_path` is display-only. Hand
off by pointer: never paste the assessment, the sidecar, or the full diff into a dispatch.
Report the empty cases, never fail silently.

- [ ] 0. Assessment located — title minted verbatim; no assessment for this task → stop
- [ ] 1. Diff captured once — clean tree → stop
- [ ] 2. Adopted mitigations collected (`Selection: selected`) — none → set `Latest stage: testing` and stop
- [ ] 3. Rules sidecar located (`rules_abs`) — absent is expected, never a blocker, never a finding
- [ ] 4. One verifier dispatched per adopted mitigation — justification FIRST, then `fail`/`accepted`/`high` at the ≥80% bar
- [ ] 5. Each level concluded — justification weighed BEFORE the level; a level its evidence does not carry does not stand; the conclusion is YOURS
- [ ] 6. `Justification` + `Verification level` + `Latest stage: testing` written — YOU write, the verifier doesn't; sidecar untouched
- [ ] 7. Reported to the coding agent — `fail` rows named, absent vs insufficient distinguished in the Gap; Testing writes no code

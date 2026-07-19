# Testing — the threat robustness loop

This is the procedure for the **Testing** phase of the `ingrain-security` skill: the verification
counterpart to the plan review in `SKILL.md`. You are here because **Phase select** routed
you here — the task has an assessment carrying adopted mitigations and a non-empty branch
delta. Nothing in `SKILL.md`'s Steps 0–9 applies: you do not threat-model, you run no user
gates, you make no `ingrain` CLI call, and you edit no code.

**What this phase measures.** Not whether each mitigation matches the words of its
Description — whether the **threats the plan selected can still be realized** against the code
as built. This is **negative testing**: for each selected threat you ask how well the adopted
mitigations actually close it, and the answer is that threat's **robustness**. A mitigation
implemented exactly as written that still leaves a path to its threat is **not** robust
coverage. The **threats define the scope** — every selected threat is examined, including one
whose mitigations were all declined.

**Announce:** open with "Using ingrain-security to verify the implemented mitigations."

You orchestrate **one read-only worker per selected threat** — as many verifiers as there are
`selected` rows in `## Threats` — and conclude from what they return yourself:

- **`ingrain-threat-verifier`** (`references/testing/ingrain-threat-verifier.md`) — one per selected
  threat, each holding that threat, every `selected` mitigation tagged with it, and those
  mitigations' org rules (see **How to dispatch a verifier**).

A verifier handed a threat and its mitigations is under quiet pressure to conclude the threat
is handled. That is why it returns a **justification**, not a verdict, and writes nothing: the
level it leads with is a conclusion you re-derive from the evidence it cites, not an answer you
route on (see **Concluding the level**).

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
verbatim for every read and for the finalize write, and obey the `instruction` field it
carries; the relative `assessment_path` is display-only. The path is deterministic in the
branch + task title:

    <project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md

so it resolves to the **same file** the plan review wrote for this task
(`file_exists: true` confirms it).

→ `references/formatting/assessment-file.md` owns the name's derivation, the write
pre-approval, and the file's schema — follow that schema exactly. The columns Testing fills are
`## Threats` → **Robustness** and `## Mitigations` → **Justification** + **Verification
level**, plus `## Task` → `Latest stage`.

## The diff under review

Verify against the **branch delta** — everything this branch added since it diverged from the
branch it was cut from, committed **and** uncommitted alike. Resolve it with the bundled
**`scripts/branch-diff`** script and take **`base_ref`** (the parent branch, for the report),
**`diff_ref`** (what you actually diff against), `fallback` and `delta_empty` from its JSON.
→ `references/lib/branch-diff.md` owns the script, the refs it returns, and the discipline
around them — notably that `diff_ref` is the run's **fixed basis**: pass it verbatim to every
verifier, never re-derive it per dispatch, never substitute `HEAD` for it.

Then capture, as your remaining shell steps — the script hands you both commands fully
substituted, in `diff_command` and `status_command`:

- `git diff <diff_ref>` — the full branch delta for tracked files, committed + uncommitted.
- `git status --porcelain` — the set of changed + untracked paths.
- New (untracked) files listed by `git status` — read their contents directly.

**Fallback — `HEAD`, and only as the fallback.** When no fork point resolves, the script returns
`fallback: true` with `diff_ref: HEAD` — the uncommitted delta only — and names the case in
`reason`. **Report it**, and report it accurately, because the two kinds are not equivalent:

- `no-divergence` — this branch has no commits since it was cut, so `HEAD` captures **all** of its
  work. The review is **complete**; say so rather than caveating a result that needs no caveat.
- `not-a-git-repository`, `no-commits`, `no-fork-point` (a detached HEAD, a repo with no other
  branch, `merge-base` failing on a shallow clone — check the `shallow` field) — any *committed*
  implementation is invisible to `git diff HEAD`. The review is then narrower than intended, and
  that is a caveat on the result, not a silent detail.

If `delta_empty: true` — nothing committed since the fork point and nothing dirty (on the `HEAD`
fallback this means only that the working tree is clean) — there is nothing to verify; say so and
stop. Each verifier re-derives the slice of this diff relevant to its own mitigation; you do not
paste the whole diff into every dispatch.

## Maturity levels

Every selected threat lands on one of three robustness levels, and every adopted mitigation
inherits one from the threats it covers. They are a **ladder** — this is the one definition
both dispatches and `references/formatting/assessment-file.md` point at:

- **`weak`** — the threat **can still be realized**. A path to it survives the change:
  nothing mitigates it, or what does is bypassable, or it is closed on one route and open on
  another, or the analysis cannot establish that it is closed at all.
- **`adequate`** — the routes by which this threat would be realized are **closed** by the
  adopted mitigations, on the surface the threat named.
- **`strong`** — closed **broadly** rather than only on the one route the threat named, **and**
  supporting **artefacts** back it: tests that adversarially exercise the control and would
  fail if it regressed.

Take a threat "injected CSS escapes the sandbox" with a mitigation "escape all custom CSS": no
escaping is `weak`; escaping on the custom-CSS path so the injection no longer lands is
`adequate`; escaping applied across every path that renders user CSS, plus tests proving
injected CSS comes out escaped, is `strong`.

**Judging robustness is your analysis to make.** These definitions say what each level
*means*; they are not a rubric you execute. Weigh the actual code against the actual threat and
decide. Two principles bound that judgement:

- **A threat you cannot establish is closed is not closed.** Uncertainty lands on `weak`, with
  the residual path named. Never round up on a hunch.
- **Missing artefacts never make a threat `weak`.** A threat genuinely closed, with no tests
  proving it stays closed, is `adequate` — the artefact is what separates `strong` from
  `adequate`, not `adequate` from `weak`.

## The rules file

Each adopted mitigation carries **Rule ref ids** (the `Rule refs` column of `## Mitigations`)
but not the rule bodies. The plan review persisted the rule bodies to a **linked sidecar**,
`.ingrain-security/rules-<branch-slug>-<task-slug>.md` — the twin of the assessment file, keyed
by the same branch + task slug (schema: `references/formatting/rules-file.md`). To let each verifier judge
robustness against *how the org implements* the control — not just the mitigation's generic
Description — locate that sidecar and hand each verifier the rule descriptions for the
mitigations covering its threat.

Mint its path with the bundled **`scripts/rules-path`** script, the twin of `assessment-path`;
your SessionStart context carries the ready-to-run command:

    bash <plugin>/skills/ingrain-security/scripts/rules-path <host> mint --title "<task title>"

Use its **`rules_abs`** (absolute) as the read path, and the **same verbatim title** you minted
the assessment with. Because it is keyed by the same branch + task slug, it resolves to the
**same sidecar** the plan review wrote for this task.

- **`file_exists: true`** — the sidecar carries this task's org rules. Read the bounded
  `## Retrieved rules` / `## Per-mitigation mapping` slices you need to give each verifier the
  rule(s) behind its threat's covering mitigations (by pointer — see **How to dispatch a
  verifier**).
- **`file_exists: false`** — no org rules were retrieved for this task at planning time (the
  CLI was absent, unconfigured, or returned nothing). There is nothing to hand the verifiers;
  they judge from the threat and the mitigation Descriptions alone. This is **never** a finding.

The rules are **supporting context only**: they sharpen what "closed" looks like for this org,
and their absence never blocks verification. A mitigation whose `Rule refs` is `—` has no
backing rule — the verifier works from its Description and the threat.

## How to dispatch a verifier

Dispatch a **fresh worker subagent** per verifier and tell it to become the verifier by reading
its reference file.
→ `references/lib/platform-dispatch.md` maps this onto your host, including the fan-out rule for
the per-threat verifiers and why the standing worker constraint does not fit this one.

Dispatch every verifier with the same shape, restating its constraints inline. **Hand off by
pointer:** point the verifier at its threat row and its covering mitigation rows **and, when
the sidecar exists, the rule(s) for those mitigations' Rule refs** rather than pasting the
files; the verifier **returns a justification and a level, and does not write the assessment
file** (you conclude and record, to avoid concurrent writes to one table):

```
Read references/testing/ingrain-threat-verifier.md and follow it as your system prompt.
You do no code or repo edits — use only Read/Grep/Glob on the codebase, plus read-only git
(git diff <diff_ref>, git status, git show) to obtain the branch diff. You run NO ingrain/CLI
commands — any org rule you need is in the rules sidecar named below. You write NOTHING —
not the assessment file, not any file; you only return your justification and level.
INPUT:
- The run's assessment file is at <the minted assessment_abs — the ABSOLUTE path, pasted in full>.
  Read ONLY its `## Threats` row <T-tag> — the threat you are testing against — and the
  `## Mitigations` rows <the selected M-tags carrying <T-tag>, or "none — no adopted mitigation
  covers this threat"> that are meant to close it. Read no other threat and no other mitigation.
- The org-rules sidecar is at <the minted rules_abs — the ABSOLUTE path — or "none (no rules file for this task)">.
  If it exists, read ONLY the `## Retrieved rules` entries for those mitigations' Rule ref ids
  (found via the `## Per-mitigation mapping`) — the org rule bodies behind them. Treat them as
  SUPPORTING CONTEXT on how the org implements this kind of control. If the sidecar is absent,
  or those rows' Rule refs are `—`, judge from the threat and the Descriptions alone.
- The diff under review is `git diff <the resolved diff_ref — the merge-base commit, pasted in full>`,
  the delta since this branch diverged from <base_ref> — committed AND uncommitted. Use that ref
  as given: do NOT re-derive it and do NOT substitute HEAD for it.
  <When the HEAD fallback is in effect, say so here instead: "no fork point resolved — diff_ref
  is HEAD, so only uncommitted changes are under review.">
- Evaluate how well those mitigations cover <T-tag> in the code as built: can this threat still
  be realized? Look for a surviving route — an unprotected path, a bypass, a partial
  application. Judge the threat, not the wording of the mitigations: a mitigation implemented
  exactly as described that still leaves the threat reachable is weak coverage.
Return ONLY, in this order: JUSTIFICATION (≤256 chars — your reasoning about whether the threat
is still reachable), then LEVEL (weak | adequate | strong) for <T-tag>, then EVIDENCE (file:line
in the diff), and — when the level is `weak` — the RESIDUAL PATH (the concrete route by which
the threat can still be realized, and the change that would close it).
The justification comes FIRST: it is what I weigh, and writing it first is what stops the level
from being a guess. Do not return the full diff or a long analysis.
```

Dispatch verifiers for **all** selected threats. **A selected threat with no covering
mitigation is still dispatched** — the code may close it incidentally, and if it does not, that
is exactly the `weak` finding the report exists to surface.

**The general-instruction pass.** Adopted mitigations whose `Threat tags` is `—` are general
implementation instructions: no threat defines their scope, so no threat verifier covers them.
Check them separately against their Descriptions — followed, or not — and report them in their
own table. They take a `Verification level` like any other row: `weak` when the instruction was
not followed, `adequate` when it was, `strong` when it was followed comprehensively and
artefacts back it.

**Do not branch on the level word a verifier leads with.** Hold its justification and its level
together and take both to **Concluding the level** — the level is a conclusion you are going
to re-derive, not an answer you route on.

## Concluding the level

You now hold, per selected threat, the verifier's justification and the level it led with.
**The level you record is your own conclusion, not the verifier's answer forwarded.** Per
threat, in this order:

1. **Read the justification before you look at the level.** If you have already seen the level,
   set it aside deliberately: you are re-deriving that conclusion, not rubber-stamping it.
2. **Weigh the justification on its evidence.** Strong: it cites a concrete `file:line` in the
   diff and says what the code *at that line* does, and why that closes the threat's route or
   leaves it open. Weak: it asserts a conclusion ("the control is in place", "looks
   comprehensive"), reasons from the mitigation's wording rather than from the code, cites a
   file with no line, or cites nothing. Length, confidence, and fluency are not evidence.
3. **A justification that does not carry its level does not get it.** An `adequate` resting on
   an assertion rather than a cited line is `weak` with the residual path named, and a `strong`
   whose artefact is asserted but never cited at a `file:line` is `adequate`. Read the cited
   line yourself where the level turns on it — the verifier's reading is not the last word.
   Ask the question the verifier was asked: given this code, can the threat still be realized?
4. **Conclude, then write.** The level you record is **yours**, and so is the Justification: ≤256
   characters, in your own words, naming the evidence it rests on — not the verifier's text
   pasted across. Where you departed from the level the verifier led with, say what moved it.

**Then derive each mitigation's level.** `## Threats` → **Robustness** carries the threat
result; `## Mitigations` → **Verification level** carries each mitigation's contribution to
closing the threats it covers. Read it off the threat analyses the mitigation appears in:

- Covers one threat → it takes that threat's level.
- Covers several whose levels differ → **the weakest governs.** A mitigation is only as robust
  as its worst-covered threat; a control that closes `T1` while leaving `T3` reachable has not
  earned `adequate` on the strength of `T1`.
- Carries no threat tag → it took its level from the general-instruction pass.

## Testing — the flow

Each step is one action; the tracker for them is **Testing — checklist** at the end of this
file.

0. **Locate the assessment.** Mint the path with the task's `## Task` Title **verbatim** (see
   **The assessment file**). If `file_exists: false`, you minted the wrong title — recover it
   from the file and re-mint. If no assessment for this task genuinely exists, state so and
   **stop**; do not fall through to the plan review.
1. **Capture the diff.** Run `scripts/branch-diff` to resolve `base_ref` + `diff_ref`, then
   capture the branch diff **once** (see **The diff under review**). If **Phase select** already
   ran it this turn, reuse the JSON you are holding rather than paying for it twice — the script
   is deterministic, so either way you get the same refs. If you reached Testing by an explicit
   request ("verify the mitigations"), Phase select's table was skipped and **you must run it
   here**. However you got them, `diff_ref` is now fixed for the run: pass it verbatim to every
   verifier and never re-derive it mid-run. If `fallback: true`, report that and its `reason`. If
   `delta_empty: true`, state "no changes to verify" and **stop**.
2. **Collect the scope.** Read the bounded `## Threats` and `## Mitigations` slices of the
   assessment file. The scope is every threat whose **Selection** is `selected`, each paired
   with the `selected` mitigations carrying its tag — including one no adopted mitigation
   covers. Set aside the `selected` mitigations whose `Threat tags` is `—` for the
   general-instruction pass. If **no threat is selected and no mitigation is adopted**, state
   "nothing to verify", set `Latest stage: testing`, and **stop**.
3. **Locate the rules file.** Mint `rules_abs` with the `rules-path` command and the same
   verbatim title (see **The rules file**). If `file_exists: true`, it carries this task's org
   rules — you will hand each verifier the rule(s) behind its threat's covering mitigations by
   pointer. If `file_exists: false`, no rules were retrieved at planning; verifiers judge from
   the threat and the Descriptions alone. This is supporting context only — never a blocker and
   never a finding.
4. **Dispatch the verifiers.** Dispatch one `ingrain-threat-verifier` per selected threat (see
   **How to dispatch a verifier**), each pointed at its `T<n>` row, the `selected` mitigations
   covering it, **and — when the sidecar exists — those mitigations' rule(s) in `rules_abs`**.
   Then run the general-instruction pass over the untagged rows. Collect each one's
   justification, then its level (`weak` | `adequate` | `strong`), plus its evidence and — on
   `weak` — the residual path. Do not act on a level yet.
5. **Conclude each level (you decide).** For each selected threat, read the verifier's
   justification, weigh it on its evidence, and conclude the threat's robustness yourself (see
   **Concluding the level**). Then derive each mitigation's level from the threats it covers —
   weakest governs. Write your own ≤256-char justification for each.
6. **Finalize the assessment (you write).** Write each threat's concluded level into the
   **`Robustness`** column of `## Threats`, and each mitigation's concluded justification and
   level into the **`Justification`** and **`Verification level`** columns of `## Mitigations`
   (per `references/formatting/assessment-file.md`), leaving excluded/undecided
   rows as `—`; and set `## Task` → `Latest stage: testing`. One write, to the
   minted `assessment_abs`. On a re-verification (the file was already at `Latest stage: testing`
   and the code changed again), **overwrite** the previous justifications and levels — they
   record the current implementation, not a history. The
   `rules-<…>.md` sidecar is a persistent planning artifact — **do not modify or delete it**.
   This is the "mark checked" step — the file now records what was verified.
7. **Report to the coding agent.** Present the findings (see **Reporting format**) and close
   with a one-line verdict. If any threat is `weak`, ask the coding agent to revisit exactly
   those — naming the residual path, not just the mitigation.

## Reporting format

Report the concluded results to the coding agent as **visible Markdown output in the
conversation**. Lead with the threats — they are what the phase measured — then the
mitigations.

**Threat robustness**, one row per selected threat, in tag order (`T1` first):

| Column | Contents |
|--------|----------|
| **Threat** | tag + short title (e.g. `T1 — injected CSS escapes the sandbox`) |
| **Robustness** | `weak` \| `adequate` \| `strong` |
| **Covering mitigations** | the adopted `M` tags meant to close it, or `none adopted` |
| **Justification** | the reasoning you concluded — the same one behind the table |
| **Evidence** | where in the diff the threat is closed (or left open) — `file:line`, or `—` |
| **Residual path** | for `weak`: **the concrete route by which the threat can still be realized**, and the change that would close it. This is the actionable half of the report — "the mitigation is missing" is not a residual path; "an unauthenticated caller still reaches `/refresh` via X" is. `—` otherwise |

**Mitigation contribution**, one row per adopted mitigation, in tag order (`M1` first): tag +
title, **Verification level**, the threat tags it covers (or `general`), and one line on what
it does or fails to do. General implementation instructions appear here with `general` in place
of threat tags.

Then close with a one-line verdict:

- **All at `adequate` or above** — "All N selected threats are closed (T2, T4 at `strong`)."
- **Gaps found** — "N of M selected threats remain realizable: <T-tags> — please revisit them
  before presenting the change," naming exactly the `weak` ones.

This report goes to the **coding agent**, not through user selection windows — there are no
gates in Testing.

## Red flags — stop if you catch yourself thinking…

| Thought | Reality |
|---------|---------|
| "`file_exists: false`, but I'm clearly verifying code I just wrote" | You minted the wrong title. The mint is keyed on branch + task slug, so a paraphrased title resolves to a different path. Recover the `## Task` Title from the assessment file and re-mint **verbatim** — never fall through to the plan review on code that is already written. |
| "No assessment file, I'll threat-model it now" | Testing verifies an existing assessment. No assessment for the task → stop; Development runs at planning time, not after the code is written. |
| "The tree is clean / `git diff HEAD` is empty, so there's nothing to verify" | You are diffing the wrong basis. The implementation is almost certainly **committed** — diff against the fork point `scripts/branch-diff` resolved, never a hardcoded trunk name and never `HEAD` except as the reported fallback. See `references/lib/branch-diff.md`. |
| "I'll just eyeball the diff myself" | Dispatch a read-only `ingrain-threat-verifier` per selected threat — don't inline the analysis. |
| "The mitigation is implemented exactly as its Description says, so it passes" | The Description is not the bar — the **threat** is. A control built to spec that still leaves a route to its threat is `weak` coverage. Ask what an attacker does next, not whether the words match. |
| "I'll paste the verifier's justification into the table" | The **Justification** column is *your* conclusion, in your own words, ≤256 chars. Workers return justifications; they never write the table. |
| "I'll write the results into a fresh file" | Write to the minted `assessment_abs` — the same file the plan review wrote. Never hand-build a path or create an `.ingrain-security/` folder. |
| "Only threat mitigations matter" | The threat verifiers cover the tagged ones; the general-instruction pass covers the rest. Every `selected` row ends up with a level. |
| "The org rule body overrides the mitigation Description" | Neither one is the bar — the threat is. Rule bodies and Descriptions are both context on what "closed" should look like here; what you judge is whether the threat is still reachable. |
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
- [ ] 1. Fork point resolved with `scripts/branch-diff` (`base_ref` + `diff_ref` + `fallback`) and branch diff captured once — `HEAD` only as a reported fallback; `delta_empty: true` → stop
- [ ] 2. Scope collected — `selected` threats paired with their covering `selected` mitigations (an uncovered threat is still in scope), untagged rows set aside; nothing selected → set `Latest stage: testing` and stop
- [ ] 3. Rules sidecar located (`rules_abs`) — absent is expected, never a blocker, never a finding
- [ ] 4. One verifier dispatched per selected threat, plus the general-instruction pass — justification FIRST, then `weak`/`adequate`/`strong`
- [ ] 5. Each threat's robustness concluded — justification weighed BEFORE the level; a level its evidence does not carry does not stand; the conclusion is YOURS; mitigation levels derived, weakest governs
- [ ] 6. `Robustness` + `Justification` + `Verification level` + `Latest stage: testing` written — YOU write, the verifier doesn't; sidecar untouched
- [ ] 7. Reported to the coding agent — `weak` threats named with their residual path; Testing writes no code

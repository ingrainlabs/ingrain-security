# Testing — the threat robustness loop

This is the procedure for the **Testing** phase of the `ingrain-security` skill: the verification
counterpart to the plan review in `SKILL.md`. You are here because **Phase select** routed
you here — the task has an assessment carrying adopted mitigations and a non-empty branch
delta. Your whole job is: read the assessment, diff the branch, dispatch one verifier per
selected threat, and record the **Robustness** you conclude — on each threat, and on each
mitigation that covers it. `SKILL.md`'s Steps 0–9 stay behind in Development.

**What this phase measures.** Whether the **threats the plan selected can still be realized**
against the code as built. This is **negative testing**: for each selected threat you ask how
well the adopted mitigations actually close it, and the answer is that threat's
**robustness**. Robust coverage means every route to the threat is closed — a mitigation's
fidelity to the words of its Description is beside the point. The **threats define the
scope** — every selected threat is examined, including one whose mitigations were all
declined.

**Announce:** open with "Using ingrain-security to verify the implemented mitigations."

You orchestrate **one read-only worker per selected threat** — as many verifiers as there are
`selected` entries in `## Threats` — and conclude from what they return yourself:

- **`ingrain-threat-verifier`** (`references/testing/ingrain-threat-verifier.md`) — one per selected
  threat, each holding that threat, every `selected` mitigation naming it, and those
  mitigations' org rules (see **How to dispatch a verifier**).

A verifier handed a threat and its mitigations is under quiet pressure to conclude the threat
is handled. That is why it returns a **justification** and leaves the recording to you: the
Robustness it leads with is a conclusion you re-derive from the evidence it cites (see
**Concluding the Robustness**).

## The assessment file

Testing reads and finalizes the **same** per-task assessment file the plan review
wrote — a single file in `.ingrain-security/` at the project root. **Mint its path** once,
at the start of the run, with the bundled **`scripts/run/mint-assessment-path`**
script. Your SessionStart context carries the ready-to-run command (plugin root and host
already substituted); it takes the form:

    bash <plugin>/skills/ingrain-security/scripts/run/mint-assessment-path <host> mint --title "<task title>"

**The `--title` must be the task's title as Development recorded it — reuse the assessment's
`## Task` → **Title** verbatim.** Copy it from the file rather than from the conversation:
the mint is keyed on branch **+ task slug**, so a drifted title mints a *different* path,
returns `file_exists: false`, and sends Phase select back to Development — re-running the whole
plan review on code that is already written. If you reached Testing via an explicit request
and the mint returns `file_exists: false`, you almost
certainly minted the wrong title: recover it from the file itself (Glob
`<project_root>/.ingrain-security/assessment-*.md`, read the `## Task` Title of the one for
this task) and re-mint. Testing is the phase you stay in.

The script returns a JSON object. Use its **`assessment_abs`** — the **absolute** path —
verbatim for every read and for the finalize write, and obey the `instruction` field it
carries; the relative `assessment_path` is display-only. The path is deterministic in the
branch + task title:

    <project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md

so it resolves to the **same file** the plan review wrote for this task
(`file_exists: true` confirms it).

→ `references/formatting/assessment-file.md` owns the name's derivation, the write
pre-approval, and the file's schema — follow that schema exactly. The fields Testing fills are
`## Threats` → **Robustness** and `## Mitigations` → **Justification** + **Robustness**, plus
`## Task` → `Latest stage`.

**Write it with the Edit or Write tool, on `assessment_abs`** — `allow-assessment-write`
pre-approves those for this file, so the write lands with no permission prompt.

**Check the write.** Testing writes this file exactly once, at step 6, and that write is a
finished file — so run the bundled **`scripts/run/validate-assessment`** script on `assessment_abs`
straight after it, **strictly (no `--lenient`)**:

    bash <plugin>/skills/ingrain-security/scripts/run/validate-assessment <assessment_abs>

Run it exactly as printed — nothing appended — and read the verdict off the `"valid"` field of
the JSON it prints on stdout. Fix exactly what it reports and re-run, at most twice; if
violations survive, name them in one line of your report so they reach the user with the
result.
→ `references/formatting/assessment-file.md` § **Validation — run it after every write** owns
the modes, how to read the result and that bound. The `rules-<…>.md` sidecar is read-only here, so it
keeps the validation the plan review already gave it.

## The diff under review

Verify against the **branch delta** — everything this branch added since it diverged from the
branch it was cut from, committed **and** uncommitted alike. Resolve it with the plugin's
**`scripts/run/resolve-branch-delta`** script and take **`base_ref`** (the parent branch, for the report),
**`diff_ref`** (what you actually diff against), `fallback` and `delta_empty` from its JSON.
→ `references/lib/resolve-branch-delta.md` owns the script, the refs it returns, and the discipline
around them — notably that `diff_ref` is the run's **fixed basis**: resolve it once and pass
that exact string to every verifier.

Then capture, as your remaining shell steps — the script hands you both commands fully
substituted, in `diff_command` and `status_command`:

- `git diff <diff_ref>` — the full branch delta for tracked files, committed + uncommitted.
- `git status --porcelain` — the set of changed + untracked paths.
- New (untracked) files listed by `git status` — read their contents directly.

**Fallback — `HEAD`, and only as the fallback.** When no fork point resolves, the script returns
`fallback: true` with `diff_ref: HEAD` — the uncommitted delta only — and names the case in
`reason`. **Report it**, and report it accurately, because the two kinds differ in what they
leave visible:

- `no-divergence` — this branch has no commits since it was cut, so `HEAD` captures **all** of its
  work. The review is **complete**; report it as such.
- `not-a-git-repository`, `no-commits`, `no-fork-point` (a detached HEAD, a repo with no other
  branch, `merge-base` failing on a shallow clone — check the `shallow` field) — any *committed*
  implementation is invisible to `git diff HEAD`. The review is then narrower than intended;
  state that as a caveat on the result.

If `delta_empty: true` — nothing committed since the fork point and nothing dirty (on the `HEAD`
fallback this means only that the working tree is clean) — there is nothing to verify; say so and
stop. Each verifier re-derives the slice of this diff relevant to its own mitigation, so a
dispatch carries the `diff_ref` and leaves the diff itself on disk.

## Robustness levels

Every selected threat lands on one of three **Robustness** levels, and every adopted mitigation
inherits its Robustness from the threats it covers. One measure, recorded in two places — this
is the one definition both dispatches and `references/formatting/assessment-file.md` point at:

- **`weak`** — the threat **can still be realized**. A path to it survives the change:
  nothing mitigates it, or what does is bypassable, or it is closed on one route and open on
  another, or the analysis leaves its closure unestablished.
- **`adequate`** — the routes by which this threat would be realized are **closed** by the
  adopted mitigations, on the surface the threat named.
- **`strong`** — closed **broadly**, across every route to the asset, **and**
  supporting **artefacts** back it: tests that adversarially exercise the control and would
  fail if it regressed.

Take a threat "injected CSS escapes the sandbox" with a mitigation "escape all custom CSS": no
escaping is `weak`; escaping on the custom-CSS path so the injection no longer lands is
`adequate`; escaping applied across every path that renders user CSS, plus tests proving
injected CSS comes out escaped, is `strong`.

**Judging Robustness is your analysis to make.** Apply these definitions as judgement: weigh
the actual code against the actual threat and decide. Two principles bound that judgement:

- **A threat counts as closed only when you can establish that it is.** Uncertainty lands on
  `weak`, with the residual path named — the cited evidence is what sets the level.
- **Artefacts are the boundary between `strong` and `adequate`.** A threat genuinely closed,
  with no tests proving it stays closed, is `adequate`.

## The rules file

Each adopted mitigation carries **Rule ref ids** (the `Rule refs` field of its `## Mitigations` entry),
which resolve to rule bodies in the sidecar. The plan review persisted those bodies to a **linked sidecar**,
`.ingrain-security/rules-<branch-slug>-<task-slug>.md` — the twin of the assessment file, keyed
by the same branch + task slug (schema: `references/formatting/rules-file.md`). To let each verifier judge
robustness against *how the org implements* the control, locate that sidecar and hand each
verifier the rule descriptions for the mitigations covering its threat.

Mint its path with the plugin's **`scripts/run/mint-rules-path`** script, the twin of `mint-assessment-path`;
your SessionStart context carries the ready-to-run command:

    bash <plugin>/skills/ingrain-security/scripts/run/mint-rules-path <host> mint --title "<task title>"

Use its **`rules_abs`** (absolute) as the read path, and the **same verbatim title** you minted
the assessment with. Because it is keyed by the same branch + task slug, it resolves to the
**same sidecar** the plan review wrote for this task.

- **`file_exists: true`** — the sidecar carries this task's org rules. Read the bounded
  `## Retrieved rules` / `## Per-mitigation mapping` slices you need to give each verifier the
  rule(s) behind its threat's covering mitigations (by pointer — see **How to dispatch a
  verifier**).
- **`file_exists: false`** — no org rules were retrieved for this task at planning time (the
  CLI was absent, unconfigured, or returned nothing). The verifiers judge from the threat and
  the mitigation Descriptions alone — treat this as an expected input state. A sidecar **file**
  may still be sitting on disk: the mint seeds an empty skeleton, and `file_exists` reports
  content, not presence. Take `file_exists` at its word and leave that skeleton as it is.

The rules are **supporting context only**: they sharpen what "closed" looks like for this org,
and verification proceeds with or without them. A mitigation whose `Rule refs` is `—` is
judged from its Description and the threat.

## How to dispatch a verifier

Dispatch a **fresh worker subagent** per verifier and tell it to become the verifier by reading
its reference file.
→ `references/development/dispatch.md` maps the subagent primitive — and the sequential
in-context fallback where a host has none — onto your host.

The verifier's contract differs from a Development worker's, so state it inline:

- **Its whole output is what it returns.** Development workers each own a section of the
  assessment file; this one owns the justification and Robustness level it hands back, and you
  conclude and record from it, so one writer owns the file.
- **Its one shell allowance is read-only git** — `git diff <diff_ref>`, `git status`, `git show` —
  to obtain the branch diff at the `diff_ref` you resolved. Read/Grep/Glob covers the rest; the
  org rules it needs are already on disk in the sidecar.
- **Fan out.** Each per-threat verifier is independent, so on a host with a subagent primitive
  dispatch them **together**. On the sequential fallback, run them in the same
  session one at a time, in descending risk order.

Dispatch every verifier with the same shape. **Hand off by pointer:** point the verifier at its
threat entry and its covering mitigation entries **and, when the sidecar exists, the rule(s) for those
mitigations' Rule refs**, leaving the files themselves on disk for it to open:

```
Read references/testing/ingrain-threat-verifier.md and follow it as your system prompt.
Read/Grep/Glob on the codebase is your toolset, plus read-only git (git diff <diff_ref>,
git status, git show) to obtain the branch diff. Any org rule you need is already on disk in
the rules sidecar named below. Your whole output is what you return to me: your
justification and level.
INPUT:
- The run's assessment file is at <the minted assessment_abs — the ABSOLUTE path, pasted in full>.
  Read ONLY its `## Threats` entry <t-id> — the threat you are testing against — and the
  `## Mitigations` entries <the selected m-ids naming <t-id>, or "none — no adopted mitigation
  covers this threat"> that are meant to close it. Those entries are the whole of the file that
  concerns you; sibling verifiers own the other threats and mitigations.
- The org-rules sidecar is at <the minted rules_abs — the ABSOLUTE path — or "none (no rules file for this task)">.
  If it exists, read ONLY the `## Retrieved rules` entries for those mitigations' Rule ref ids
  (found via the `## Per-mitigation mapping`) — the org rule bodies behind them. Treat them as
  SUPPORTING CONTEXT on how the org implements this kind of control. If the sidecar is absent,
  or those mitigations' Rule refs are `—`, judge from the threat and the Descriptions alone.
- The diff under review is `git diff <the resolved diff_ref — the merge-base commit, pasted in full>`,
  the delta since this branch diverged from <base_ref> — committed AND uncommitted. Use that
  ref exactly as given; it is the merge-base, which is what exposes the committed work.
  <When the HEAD fallback is in effect, say so here instead: "no fork point resolved — diff_ref
  is HEAD, so only uncommitted changes are under review.">
- Evaluate how well those mitigations cover <t-id> in the code as built: can this threat still
  be realized? Look for a surviving route — an unprotected path, a bypass, a partial
  application. Judge the threat: coverage is only as strong as the routes it actually closes,
  so a mitigation implemented exactly as described that still leaves the threat reachable is
  weak coverage.
Return ONLY, in this order: JUSTIFICATION (≤256 chars — your reasoning about whether the threat
is still reachable), then LEVEL (weak | adequate | strong) for <t-id>, then EVIDENCE (file:line
in the diff), and — when the level is `weak` — the RESIDUAL PATH (the concrete route by which
the threat can still be realized, and the change that would close it).
The justification comes FIRST: it is what I weigh, and writing it first is what grounds the level
in evidence. Keep the return to those four lines.
```

Dispatch verifiers for **all** selected threats. **A selected threat with no covering
mitigation is still dispatched** — the code may close it incidentally, and if it does not, that
is exactly the `weak` finding the report exists to surface.

**The general-instruction pass.** Adopted mitigations whose `Threats` is `—` are general
implementation instructions: their scope is the instruction itself, so this pass covers them.
Check them separately against their Descriptions — followed, or not — and report them in their
own table. They take a `Robustness` like any other entry: `adequate` when the instruction was
followed, `strong` when it was followed comprehensively and artefacts back it, and `weak`
otherwise.

**Hold the level a verifier leads with together with its justification** and take both to
**Concluding the Robustness** — that level is a conclusion you are going to re-derive, so it
waits there until you have.

## Concluding the Robustness

You now hold, per selected threat, the verifier's justification and the level it led with.
**The Robustness you record is your own conclusion, derived from the verifier's evidence.** Per
threat, in this order:

1. **Read the justification before you look at the level.** If you have already seen the level,
   set it aside deliberately and re-derive the conclusion from the justification alone.
2. **Weigh the justification on its evidence.** Strong: it cites a concrete `file:line` in the
   diff and says what the code *at that line* does, and why that closes the threat's route or
   leaves it open. Weak: it asserts a conclusion ("the control is in place", "looks
   comprehensive"), reasons from the mitigation's wording rather than from the code, cites a
   file with no line, or cites nothing. Evidence is a cited `file:line` plus a statement of
   what the code there does; length, confidence, and fluency are style.
3. **A Robustness stands only when the justification's cited evidence carries it.** An `adequate`
   resting on an assertion rather than a cited line is `weak` with the residual path named, and
   a `strong` whose artefact is asserted without a `file:line` behind it is `adequate`. Read
   the cited line yourself where the level turns on it — yours is the last word.
   Ask the question the verifier was asked: given this code, can the threat still be realized?
4. **Conclude, then write.** The Robustness you record is **yours**, and so is the Justification:
   ≤256 characters, in your own words, naming the evidence it rests on. Where you departed from
   the level the verifier led with, say what moved it.

**Then carry each mitigation's Robustness across.** `## Threats` → **Robustness** is the result
you concluded; `## Mitigations` → **Robustness** is that same measure on the entries that produced
it — the mitigation's contribution to closing the threats it covers, not a second axis. Read it
off the threats the mitigation names:

- Covers one threat → it takes that threat's Robustness.
- Covers several whose Robustness differs → **the weakest governs.** A mitigation takes the
  Robustness of its weakest-covered threat; a control that closes `T01` while leaving `T03`
  reachable is `weak` on the strength of `T03`.
- Names no threat → its Robustness came from the general-instruction pass.

## Testing — the flow

Each step is one action; the tracker for them is **Testing — checklist** at the end of this
file.

0. **Locate the assessment.** Mint the path with the task's `## Task` Title **verbatim** (see
   **The assessment file**). If `file_exists: false`, you minted the wrong title — recover it
   from the file and re-mint. If no assessment for this task genuinely exists, state so and
   **stop** — Development is reached through Phase select, on a later invocation.
1. **Capture the diff.** Run `scripts/run/resolve-branch-delta` to resolve `base_ref` + `diff_ref`, then
   capture the branch diff **once** (see **The diff under review**). If **Phase select** already
   ran it this turn, reuse the JSON you are holding rather than paying for it twice — the script
   is deterministic, so either way you get the same refs. If you reached Testing by an explicit
   request ("verify the mitigations"), Phase select's table was skipped and **you must run it
   here**. However you got them, `diff_ref` is now fixed for the run: resolve it this once and
   pass that exact string to every verifier. If `fallback: true`, report that and its `reason`. If
   `delta_empty: true`, state "no changes to verify" and **stop**.
2. **Collect the scope.** Read the bounded `## Threats` and `## Mitigations` slices of the
   assessment file. The scope is every threat whose **Selection** is `selected`, each paired
   with the `selected` mitigations naming its id — including one no adopted mitigation
   covers. Set aside the `selected` mitigations whose `Threats` is `—` for the
   general-instruction pass. If **no threat is selected and no mitigation is adopted**, state
   "nothing to verify", set `Latest stage: testing`, and **stop**.
3. **Locate the rules file.** Mint `rules_abs` with the `mint-rules-path` command and the same
   verbatim title (see **The rules file**). If `file_exists: true`, it carries this task's org
   rules — you will hand each verifier the rule(s) behind its threat's covering mitigations by
   pointer. If `file_exists: false`, no rules were retrieved at planning; verifiers judge from
   the threat and the Descriptions alone. This is supporting context only: verification runs to
   completion either way, and an absent sidecar stays out of the findings.
4. **Dispatch the verifiers.** Dispatch one `ingrain-threat-verifier` per selected threat (see
   **How to dispatch a verifier**), each pointed at its `T<n>` entry, the `selected` mitigations
   covering it, **and — when the sidecar carries rules (`file_exists: true`) — those
   mitigations' rule(s) in `rules_abs`**.
   Then run the general-instruction pass over the mitigations naming no threat. Collect each one's
   justification, then its level (`weak` | `adequate` | `strong`), plus its evidence and — on
   `weak` — the residual path. Hold each level for step 5, which is where it is settled.
5. **Conclude each Robustness (you decide).** For each selected threat, read the verifier's
   justification, weigh it on its evidence, and conclude the threat's Robustness yourself (see
   **Concluding the Robustness**). Then carry each mitigation's Robustness across from the
   threats it covers — weakest governs. Write your own ≤256-char justification for each.
6. **Finalize the assessment (you write).** Write each threat's concluded Robustness into the
   **`Robustness`** field of its `## Threats` entry, and each mitigation's concluded justification and
   Robustness into the **`Justification`** and **`Robustness`** fields of its `## Mitigations` entry
   (per `references/formatting/assessment-file.md`), leaving excluded/undecided
   entries as `—`; and set `## Task` → `Latest stage: testing`. One write, to the
   minted `assessment_abs`. On a re-verification (the file was already at `Latest stage: testing`
   and the code changed again), **overwrite** the previous justifications and levels — they
   record the current implementation. The
   `rules-<…>.md` sidecar is a persistent planning artifact — **leave it exactly as you found
   it**.
   Then **validate the file strictly** — `scripts/run/validate-assessment <assessment_abs>` with no
   `--lenient` — and fix what it reports before you report to the coding agent (see **The
   assessment file** → Check the write). This is the "mark checked" step — the file now records
   what was verified, so it is also the last moment a malformed entry can be caught before the
   next session inherits it.
7. **Report to the coding agent.** Present the findings (see **Reporting format**) and close
   with a one-line verdict. If any threat is `weak`, ask the coding agent to revisit exactly
   those — naming the residual path for each.

## Reporting format

Report the concluded results to the coding agent as **visible Markdown output in the
conversation**. Lead with the threats — they are what the phase measured — then the
mitigations.

**Threat robustness**, one row per selected threat, **sorted by risk score descending** (the ids
will not be in order, and that is correct):

| Column | Contents |
|--------|----------|
| **Threat** | id + short title (e.g. `T01 — injected CSS escapes the sandbox`) |
| **Robustness** | `weak` \| `adequate` \| `strong` |
| **Covering mitigations** | the adopted `M<n>` ids meant to close it, or `none adopted` |
| **Justification** | the reasoning you concluded — the same one behind the table |
| **Evidence** | where in the diff the threat is closed (or left open) — `file:line`, or `—` |
| **Residual path** | for `weak`: **the concrete route by which the threat can still be realized**, and the change that would close it. This is the actionable half of the report — name the concrete route an attacker still takes, e.g. "an unauthenticated caller still reaches `/refresh` via X". `—` otherwise |

**Mitigation contribution**, one row per adopted mitigation, ordered by the highest risk score
among the threats each covers: id + title, **Robustness**, the threat ids it covers (or
`general`), and one line on what it does or fails to do. General implementation instructions
appear here with `general` in place of threat ids.

Then close with a one-line verdict:

- **All at `adequate` or above** — "All N selected threats are closed (T02, T04 at `strong`)."
- **Gaps found** — "N of M selected threats remain realizable: <ids> — please revisit them
  before presenting the change," naming exactly the `weak` ones.

This report goes to the **coding agent** as visible Markdown; the selection gates belong to
Development.


## Testing — checklist

The procedure is **Testing — the flow**; this is the tracker. Tick only what is actually
done. Work top to bottom; this phase runs to its own end. Every mint
(`mint-assessment-path` and `mint-rules-path`) uses the assessment's `## Task` Title **verbatim** — a
paraphrase mints a different file and silently loses the task. Every read and the finalize
write use the absolute `assessment_abs`; the relative `assessment_path` is display-only. Hand
off by pointer: a dispatch carries paths into the assessment, the sidecar and the diff, and
each verifier opens them itself. Report the empty cases out loud.

- [ ] 0. Assessment located — title minted verbatim; no assessment for this task → stop
- [ ] 1. Fork point resolved with `scripts/run/resolve-branch-delta` (`base_ref` + `diff_ref` + `fallback`) and branch diff captured once — `HEAD` only as a reported fallback; `delta_empty: true` → stop
- [ ] 2. Scope collected — `selected` threats paired with their covering `selected` mitigations (an uncovered threat is still in scope), untagged rows set aside; nothing selected → set `Latest stage: testing` and stop
- [ ] 3. Rules sidecar located (`rules_abs`) — an absent sidecar is an expected state; verification proceeds either way
- [ ] 4. One verifier dispatched per selected threat, plus the general-instruction pass — justification FIRST, then `weak`/`adequate`/`strong`
- [ ] 5. Each threat's Robustness concluded — justification weighed BEFORE the level; a level stands only when its evidence carries it; the conclusion is YOURS; each mitigation's Robustness carried across, weakest governs
- [ ] 6. `## Threats` → `Robustness` + `## Mitigations` → `Justification` + `Robustness` + `Latest stage: testing` written — YOU write, the verifier only returns; sidecar untouched; then validated clean by `scripts/run/validate-assessment` with NO `--lenient`
- [ ] 7. Reported to the coding agent — `weak` threats named with their residual path; the coding agent owns the code changes

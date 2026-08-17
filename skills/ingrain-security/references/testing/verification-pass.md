# Testing — the verification pass: threat robustness and rule adherence

Testing's procedure. Your whole job: read the assessment, scope the verifiers, dispatch them,
and record the two verdicts you conclude — the **Robustness** of each selected threat, and the
**Adherence** of each org rule the rule gate **selected**.

**What this phase measures — two independent dimensions.** They answer different questions for
different readers, and **neither is derived from the other**:

- **Robustness — the threat dimension.** Whether the **threats the threat gate selected can still
  be realized** against the code as built. This is **negative testing**: for each selected threat
  you ask whether every route to it is closed in the code — a guidance entry's fidelity to the
  words of its Description is beside the point. The **selected threats define the scope** —
  every one is examined, including a threat whose guidance was dropped during plan refinement.
  *"Did we close the problem we found?"* — the developer's and reviewer's question.
- **Adherence — the rule dimension.** Whether the **org rules the rule gate selected were actually
  followed** in the code as built (see **Rule adherence**). *"Were the rules we accepted
  followed?"* — the security owner's question, which nothing else in the review answers.

**Two subjects, and only two.** A verification judges the **threat** and the **rule**.
Implementation guidance is the vessel through which a threat gets closed and a rule gets applied:
it carries **no verdict of any kind**, and you write nothing into `## Implementation guidance`.

They may legitimately disagree. A rule can be **followed while a threat stays reachable** (the
rule governed input validation; the surviving route is an authorisation gap) and **violated
while every threat is closed** (they were closed by other means). Never read one off the other:
that produces confident, wrong compliance answers.

**Announce:** open with "Using ingrain-security to verify the implementation."

**Resolve every path in ONE block, first thing.** This pass needs two script results —
`assessment-mint` and `branch-delta` — and neither reads the other's output, so they are issued
**together** rather than one per step. Steps 0, 1 and 3 below then read from that single batch
instead of paying a round-trip each. The mint takes a `--title`; `branch-delta` takes none.
→ `references/lib/dispatch.md` § Independent calls go out in one block.

You orchestrate **one read-only worker per subject** — one per selected threat, one per selected
rule — and conclude from what they return yourself:

- **`ingrain-threat-verifier`** (`references/testing/ingrain-threat-verifier.md`) — one per selected
  threat, each holding that threat, every guidance entry naming it, and those entries' org rules
  (see **How to dispatch a verifier**).
- **`ingrain-rule-verifier`** (`references/testing/ingrain-rule-verifier.md`) — one per **selected**
  org rule, each holding that rule's body from `## Org rules` and the guidance that drives it
  (see **How to dispatch a rule verifier**).

**The two fan-outs are independent, so they go out together** — one block, not one pass after
the other.
→ `references/lib/dispatch.md` § Independent calls go out in one block.

A verifier handed a subject and the guidance meant to address it is under quiet pressure to
conclude it was handled. That is why each returns a **justification** and leaves the recording
to you: the verdict it leads with is a conclusion you re-derive from the evidence it cites (see
**Concluding the Robustness** and **Concluding the Adherence**).

## The assessment file

Testing reads and finalizes the **same** per-task assessment file the plan review
wrote — a single file in `.ingrain-security/` at the project root. **Mint its path** once, in the
opening batch, with the bundled **`scripts/assessment-mint`**
script. Your SessionStart context carries the ready-to-run command (plugin root and host
already substituted); it takes the form:

```ingrain-script
bash <plugin>/skills/ingrain-security/scripts/assessment-mint <host> --title "<task title>"
```

**The `--title` must be the task's title as Development recorded it — reuse the assessment's
`## Task` → **Title** verbatim.** Copy it from the file rather than from the conversation:
the mint is keyed on branch **+ task slug**, so a drifted title mints a *different* path,
returns `has_content: false`, and sends Phase select back to Development — re-running the whole
plan review on code that is already written. If you reached Testing via an explicit request
and the mint returns `has_content: false`, you almost certainly minted the wrong title — and
the mint already says so: it reports `phase: requires_judgement` with
`phase_reason: siblings_present`, and lists the candidates in **`siblings`**. Open each,
read its `## Task` Title, and **re-issue the mint** with the one that is this task, verbatim.
Use that list rather than globbing the folder yourself: a glob surfaces every task's file on
the branch and offers no way to tell them apart, which is why the minter reports candidates
and refuses to choose.
Testing is the phase you stay in.

The script returns a JSON object. Use its **`assessment_abs`** — the **absolute** path —
verbatim for every read and for the finalize write, and obey the `instruction` field it
carries; the relative `assessment_path` is display-only. The path is deterministic in the
branch + task title:

    <project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md

so it resolves to the **same file** the plan review wrote for this task
(`has_content: true` confirms it).

What Testing fills is each selected threat's **`#### test` block** — **Robustness
justification**, then **Robustness**, **Residual path** and **Evidence**, in that order; every
`## Rule adherence` entry; plus `## Task` → `Latest stage`. **Write them from the field card**
seeded under each of those headings — that card is the write contract, and it arrives with the
file you are already opening.

**That block is the whole of your write into a threat entry.** A threat carries four phase
markers — `#### gen`, `#### score`, `#### usergate`, `#### test` — and the first three belong
to the plan review. Write between `#### test` and the end of the entry; leave everything above
it exactly as you found it. A threat outside the `selected` set keeps its `#### test` block
**empty**, exactly as Development left it — that emptiness is how "this threat was never in
verification scope" is stated, and it is already correct.

**`## Implementation guidance` is not among them.** Guidance is the vessel, never a subject: it
carries no verdict, so this pass reads it and writes nothing into it. **`## Org rules` is
read-only here too** — its Selections were recorded at the rule gate, and they are the scope you
work to, not something to revise.

**`## Rule adherence` has no entries until you write them.** Unlike the sections Development
filled, this one arrives as a bare heading and its card: you create one entry per **selected**
rule. Nothing else in the run writes it.
→ `references/lib/assessment-file.md` owns the name's derivation, the write
pre-approval, and the schema the cards render — open it for what a field *means*, not to learn
its shape. What the **Robustness levels** themselves mean is **this** file's, in the section of
that name below.

**Write it with the Edit or Write tool, on `assessment_abs`** — `allow-assessment-write`
pre-approves those for this file, so the write lands with no permission prompt.

**Check the write.** Testing writes this file exactly once — at **Finalize the assessment**,
the step named below — and that write is a finished file, so run the **three-check** on the
single read you make straight after, against the cards,
never against a fresh read of the schema.
Three things and nothing else: every field label present, in the order its card lists;
every enumerated value one of the words the card names, verbatim; and no selected subject left
unfilled — a `#### test` block still empty on a threat you verified, or a selected rule with no
adherence entry. Fix what does not match.
`## Org rules` and `## Implementation guidance` are read-only here and are not touched — their
cards included.

## The change under review

Verify against the **branch delta** — everything this branch added since it diverged from the
branch it was cut from, committed **and** uncommitted alike. The bundled **`scripts/branch-delta`**
script resolves it, and it ran in the opening batch: take **`base_ref`** (the parent branch, for
the report), **`diff_ref`** (what you actually diff against), `fallback` and `delta_empty` from
that JSON.
→ `references/lib/branch-delta.md` owns the script, the refs it returns, and the discipline
around them — notably that `diff_ref` is the run's **fixed basis**: resolve it once and pass
that exact string to every verifier.

**`changed_files` arrives resolved — there is no capture step.** The JSON already carries the
complete set as `[{path, status}]`: committed, staged, unstaged and untracked, with `.gitignore`
honoured. Read it and move on; **you do not run a diff of your own.** The full delta is what each
verifier fetches for its own subject, and a copy of it in your context has no reader — the
context-window discipline is the same one Development follows.

**That file set is where a review STARTS, and never where it stops.** It answers "what did this
change touch", and the questions this pass asks are different ones: *can the threat still be
realized*, and *does the control exist*. Both are settled by the whole path an attacker walks
or the whole surface a rule governs, and most of that is code this change never opened — the
guard that was already there, the sibling route nobody edited, the middleware the new call
inherits. A control that was supposed to be added and was not has **no presence in the delta at
all**: `not-followed` is a statement about code that is not there. Treat the list as the entry
point, then follow the route with Read and Grep wherever it goes.

**Every git command this review runs comes from the script.** Where you or a verifier needs the
change as text, it is `branch-delta <host> diff --ref <diff_ref>` — whole delta — or the same with
paths appended. Nobody hand-writes a `git diff`: a brewed command drifts between the orchestrator
and each verifier, and the run then reads several different changes while reporting one.
→ `references/lib/branch-delta.md` § Reading the change itself.

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
stop. Each verifier re-derives the slice of this diff relevant to its own subject, so a
dispatch carries the `diff_ref` and leaves the diff itself on disk.

## Robustness levels

Every selected threat lands on one of three **Robustness** levels. One measure, recorded in one
place — on the threat — because the threat is the subject. This is the one definition both
dispatches and `references/lib/assessment-file.md` point at:

- **`weak`** — the threat **can still be realized**. A path to it survives the change:
  nothing closes it, or what does is bypassable, or it is closed on one route and open on
  another, or the analysis leaves its closure unestablished.
- **`adequate`** — the routes by which this threat would be realized are **closed** in the code,
  on the surface the threat named.
- **`strong`** — closed **broadly**, across every route to the asset, **and**
  supporting **artefacts** back it: tests that adversarially exercise the control and would
  fail if it regressed.

Take a threat "injected CSS escapes the sandbox" with guidance "escape all custom CSS": no
escaping is `weak`; escaping on the custom-CSS path so the injection no longer lands is
`adequate`; escaping applied across every path that renders user CSS, plus tests proving
injected CSS comes out escaped, is `strong`.

**Judging Robustness is your analysis to make.** Apply these definitions as judgement: weigh
the actual code against the actual threat and decide. Two principles bound that judgement:

- **A threat counts as closed only when you can establish that it is.** Uncertainty lands on
  `weak`, with the residual path named — the cited evidence is what sets the level.
- **Artefacts are the boundary between `strong` and `adequate`.** A threat genuinely closed,
  with no tests proving it stays closed, is `adequate`.

## The org rules

Each guidance entry carries **Rule ref ids** (the `Rule refs` field of its
`## Implementation guidance` entry), and each resolves to a `### <id> — <title>` entry in the
assessment's own **`## Org rules`** section — same file, three headings up. That section is where
the plan review persisted each retrieved rule's body verbatim, and it is what lets a verifier judge
against *how the org implements* the control rather than against a bare title.

**One artifact, so there is nothing to locate.** The rules used to live in a separate
`rules-<…>.md` sidecar that had to be minted and read alongside the assessment; they now ride in
the assessment itself, which is already open in front of you.

- **`## Org rules` has entries** — read the bounded slice you need. A `selected` entry keeps its
  **full body**, which is the specification a rule verifier judges against; an `excluded` entry
  keeps only its heading and `Selection: excluded` line, which is all a recorded non-decision needs.
- **`## Org rules` is empty** — no org rules were retrieved for this task at planning time (the CLI
  was absent, unconfigured, or returned nothing). The threat verifiers judge from the threat and
  the guidance Descriptions alone, and there are no rule verifiers to dispatch. An expected input
  state, not a gap.

For the **threat** dimension the rules are **supporting context only**: they sharpen what "closed"
looks like for this org, and negative testing proceeds with or without them. A guidance entry whose
`Rule refs` is `—` contributes its Description alone, and you proceed from that and the threat —
the entry is never itself judged, because it is the vessel and carries no verdict. For the **rule** dimension a
selected rule's body is the specification itself.

## Rule adherence

The rule dimension. For each org rule the rule gate **selected**, decide whether the control that
rule prescribes exists in the code as built, and record `followed` | `not-followed` with your
reasoning in the assessment's `## Rule adherence` section. This is the security owner's answer,
and nothing else in the review produces it.

**Scope is the selected set — read it off `## Org rules`, not off `Rule refs`.** Every entry whose
`Selection` is `selected` gets exactly one adherence entry: **one per selected rule, no more and
no fewer**. Selecting a rule at the gate is the developer declaring it governs this change, and
that declaration is what makes a verdict on it meaningful.

**A pass still under way leaves fewer — on either axis, and that is a state, not a defect.** A
completed pass leaves one verdict per selected subject; an interrupted one leaves a selected
threat's `#### test` block **empty**, or a selected rule with no
`## Rule adherence` entry. Both sync
truthfully: the wire accepts a partial verdict set, the CLI reports the gap as *information* rather
than an error, and what you concluded lands. Completeness is this pass's **procedure**, asserted in
the checklist below — never a reason to withhold the verdicts you did reach.

**A selected rule that no guidance implements is still judged** — and it is the case a security
owner most needs. "not-followed — nothing implements it" is precisely the answer they are looking
for, and scoping to what guidance happened to drive would make it unreachable. Never derive the
scope from `Rule refs`.

**An excluded rule gets no entry.** The gate recorded it as deemed inapplicable here — a decision,
never a verdict. Judging it anyway would convert an applicability decision into a compliance claim
about code nobody assessed against it. Retrieval alone is likewise never adherence: a rule the
search surfaced and the critic pruned was never even presented.

**Two values, and they are exhaustive.** Because scope is the selected set, every rule in it
applies by **deliberate decision** — the strongest form of "by construction" — so there is no
"not applicable" state to record as a verdict. If a rule genuinely does not bear on the change,
that is a gate-time decision the user did not make; say so in the justification and judge the
control anyway.

**One verdict per rule, judged against the code.** Not one per driving entry: a rule driven by
three guidance entries still gets exactly one. The question is always *does the control this rule
prescribes exist?* — not *what became of the guidance that drives it?*.

**Dropped guidance does not decide it.** Guidance dropped during plan refinement is the usual
reason a rule ends up `not-followed`, and the justification names the absent control — but a rule
satisfied by other means still reads `followed`. The verdict tracks the code, never the paperwork.

**If the gate selected no rule**, the scope is empty: write no entries and say so in the report.
That is a legitimate outcome, not a gap.

## How to dispatch a verifier

Dispatch a **fresh worker subagent** per verifier and tell it to become the verifier by reading
its reference file.
→ `references/lib/dispatch.md` maps the subagent primitive — and the sequential
in-context fallback where a host has none — onto your host.

The verifier's contract differs from a Development worker's, so state it inline:

- **Its whole output is what it returns.** Development workers each own a section of the
  assessment file; this one owns the justification and Robustness level it hands back, and you
  conclude and record from it, so one writer owns the file.
- **Its one shell allowance is the bundled script** — `branch-delta <host> diff --ref <diff_ref>`,
  with paths appended to narrow it — and nothing else. It never writes a git command of its own:
  a brewed one drifts between verifiers, and `git diff` shows nothing at all for an untracked
  file. Read/Grep/Glob covers the rest; the org rules it needs are already on disk, in the
  assessment's own `## Org rules` section.
- **Fan out.** Each per-threat verifier is independent, so on a host with a subagent primitive
  dispatch them **together**. On the sequential fallback, run them in the same
  session one at a time, in id order — `T01` first, which is descending risk order.

Dispatch every verifier with the same shape. **Hand off by pointer:** point the verifier at its
threat entry, the guidance entries naming that threat, and the `## Org rules` entries those
entries' `Rule refs` name — leaving the file itself on disk for it to open:

```
Read <plugin_root>/skills/ingrain-security/references/testing/ingrain-threat-verifier.md — the
ABSOLUTE path, with plugin_root from the mint JSON pasted in full — as your system prompt.
Read/Grep/Glob on the codebase is your toolset. For the change itself run
`bash <plugin_root>/skills/ingrain-security/scripts/branch-delta <host> diff --ref <diff_ref>`
— whole delta — or the same with paths appended for single files. Do NOT write a git command
of your own. Any org rule you need is already on disk, in the assessment's own `## Org rules`
section. Your whole output is what you return to me: your justification and level.
INPUT:
- The run's assessment file is at <the minted assessment_abs — the ABSOLUTE path, pasted in full>.
  Read ONLY its `## Threats` entry <t-id> — the threat you are testing against — and the
  `## Implementation guidance` entries <the m-ids naming <t-id>, or "none — no guidance names
  this threat"> that are meant to close it. Those entries are the whole of the file that
  concerns you; sibling verifiers own the other threats.
- In the SAME file, read ONLY the `## Org rules` entries whose ids appear in those guidance
  entries' Rule refs <the ids, or "none — those entries name no rule">. Treat their bodies as
  SUPPORTING CONTEXT on how the org implements this kind of control. Where there are none,
  judge from the threat and the Descriptions alone.
- The change under review is the delta since this branch diverged from <base_ref> — committed
  AND uncommitted. Read it with the command above, passing --ref <the resolved diff_ref — the
  merge-base commit, pasted in full> exactly as given; it is the merge-base, which is what
  exposes the committed work, and passing it verbatim is what holds every verifier in this
  run to the same change.
  <When the HEAD fallback is in effect, say so here instead: "no fork point resolved — diff_ref
  is HEAD, so only uncommitted changes are under review.">
- Evaluate whether <t-id> can still be realized in the code as built. Look for a surviving
  route — an unprotected path, a bypass, a partial application. Judge THE THREAT, not the
  guidance: closure is only as strong as the routes actually closed, so guidance implemented
  exactly as described that still leaves the threat reachable is weak.
Return ONLY, in this order: JUSTIFICATION (≤256 chars — your reasoning about whether the threat
is still reachable), then LEVEL (weak | adequate | strong) for <t-id>, then EVIDENCE (file:line
ANYWHERE in the tree — the delta is where you start, not where you stop; an untouched guard or a
surviving path counts), and — when the level is `weak` — the RESIDUAL PATH (the concrete route by which
the threat can still be realized, and the change that would close it).
The justification comes FIRST: it is what I weigh, and writing it first is what grounds the level
in evidence. Keep the return to those four lines.
```

Dispatch verifiers for **all** selected threats. **A selected threat no guidance names is still
dispatched** — the code may close it incidentally, and if it does not, that is exactly the `weak`
finding the report exists to surface.

**Guidance naming no threat is not verified here, or anywhere.** A rule-driven entry
(`Threats: —`) reaches its goal through the rule it implements, and that rule carries the verdict
— in the adherence pass below. Guidance is the vessel: it has no verdict of its own to conclude,
no table of its own to report, and nothing this pass writes into its section.

**Hold the level a verifier leads with together with its justification** and take both to
**Concluding the Robustness** — that level is a conclusion you are going to re-derive, so it
waits there until you have.

## How to dispatch a rule verifier

One `ingrain-rule-verifier` per **selected** rule (see **Rule adherence** for how the scope is
read off `## Org rules`), dispatched in the **same block** as the threat verifiers — the two
fan-outs share nothing and neither reads the other's output. Same shape, same
hand-off-by-pointer discipline:

```
Read <plugin_root>/skills/ingrain-security/references/testing/ingrain-rule-verifier.md — the
ABSOLUTE path, with plugin_root from the mint JSON pasted in full — as your system prompt.
Read/Grep/Glob on the codebase is your toolset. For the change itself run
`bash <plugin_root>/skills/ingrain-security/scripts/branch-delta <host> diff --ref <diff_ref>`
— whole delta — or the same with paths appended for single files. Do NOT write a git command
of your own. Your whole output is what you return to me: your justification and verdict.
INPUT:
- Your rule is <rule-id> — <rule title>. The run's assessment file is at <the minted
  assessment_abs — the ABSOLUTE path, pasted in full>. Read ONLY its `## Org rules` entry for
  <rule-id> — the org's authoritative statement of the control it requires. That body is your
  specification.
- In the SAME file, read ONLY the `## Implementation guidance` entries <the m-ids whose Rule refs
  name <rule-id>, or "none — no guidance implements this rule"> for their Descriptions. They are
  how the plan INTENDED to apply the rule; they are not the answer, and their absence is not one
  either.
- The change under review is the delta since this branch diverged from <base_ref> — committed
  AND uncommitted. Read it with the command above, passing --ref <the resolved diff_ref — the
  merge-base commit, pasted in full> exactly as given.
  <When the HEAD fallback is in effect, say so here instead: "no fork point resolved — diff_ref
  is HEAD, so only uncommitted changes are under review.">
- Decide whether the control this rule prescribes is present in the code as built. It counts
  however it got there — through the guidance that drives it, by another mechanism, or because
  it already existed and the change preserved it. Guidance dropped during plan refinement is the
  usual reason a rule is not followed, and a rule NOTHING implements is judged all the same —
  but neither settles the verdict: judge the code. Say nothing about whether any threat survived
  — that is a sibling verifier's question on a different axis.
Return ONLY, in this order: JUSTIFICATION (≤256 chars — whether the prescribed control is
present, and why that is the verdict), then ADHERENCE (followed | not-followed), then EVIDENCE
(file:line ANYWHERE in the tree where the control is present — shared middleware this change
never touched still counts; when it is ABSENT there is no line to cite, so name where you looked
and found nothing; or — when you found neither).
The justification comes FIRST: it is what I weigh, and writing it first is what grounds the
verdict in evidence. Keep the return to those three lines.
```

## Concluding the Robustness

You now hold, per selected threat, the verifier's justification and the level it led with.
**The Robustness you record is your own conclusion, derived from the verifier's evidence.** Per
threat, in this order:

1. **Read the justification before you look at the level.** If you have already seen the level,
   set it aside deliberately and re-derive the conclusion from the justification alone.
2. **Weigh the justification on its evidence.** Strong: it cites a concrete `file:line` and says
   what the code *at that line* does, and why that closes the threat's route or leaves it open.
   Weak: it asserts a conclusion ("the control is in place", "looks comprehensive"), reasons
   from a guidance entry's wording rather than from the code, cites a file with no line, or
   cites nothing. Evidence is a cited `file:line` plus a statement of what the code there does;
   length, confidence, and fluency are style.

   **A line outside the delta is not weaker evidence — it is often the only evidence there
   is.** A threat is closed or left open by the whole route an attacker walks, and most of that
   route is code this change never touched: the guard that already existed, the sibling handler
   nobody edited. Never discount a citation for sitting outside the diff, and never ask for a
   diff line instead — that pressure is exactly what would push a verifier into asserting a
   closure it could not cite.
3. **A Robustness stands only when the justification's cited evidence carries it.** An `adequate`
   resting on an assertion rather than a cited line is `weak` with the residual path named, and
   a `strong` whose artefact is asserted without a `file:line` behind it is `adequate`. Read
   the cited line yourself where the level turns on it — yours is the last word.
   Ask the question the verifier was asked: given this code, can the threat still be realized?
4. **Conclude, then write.** The Robustness you record is **yours**, and so is the Justification:
   ≤256 characters, in your own words, naming the evidence it rests on. Where you departed from
   the level the verifier led with, say what moved it.

**It is recorded on the threat, and nowhere else.** There is no second copy to carry it across
to: guidance is the vessel a threat is closed through, not a subject of verification, so it takes
no Robustness of its own. A reader wanting to know whether a piece of guidance worked reads the
drivers beside it.

## Concluding the Adherence

You now hold, per selected rule, the rule verifier's justification and the verdict it led with.
**The Adherence you record is your own conclusion, derived from that verifier's evidence** —
the same discipline as the Robustness, on the other axis. Per rule, in this order:

1. **Read the justification before you look at the verdict.** If you have already seen it, set
   it aside deliberately and re-derive from the justification alone.
2. **Weigh the justification on its evidence.** Strong: it cites a concrete `file:line` and
   says what the code *at that line* does, and why that does or does not satisfy the control
   the rule prescribes. Weak: it asserts compliance ("the rule is followed", "looks
   consistent"), reasons from a guidance entry's wording rather than from the code, or cites
   nothing.

   **Where the citation sits is not what makes it strong.** A control routinely lives outside
   the delta — shared middleware, a base class, a config the new path inherits — and a line
   there is as good as a line in the change. **`not-followed` has no line to cite at all**: an
   absent control is absent everywhere, so its evidence is a statement of *where the verifier
   looked and found nothing* ("checked `routes/*.ts` — no auth guard"). Weigh that as evidence.
   Demanding a `file:line` for an absence is demanding proof that cannot exist, and it pushes
   the one verdict a security owner most needs into looking unsupported.
3. **`followed` stands only when the cited evidence carries it.** A `followed` resting on an
   assertion rather than a cited line is `not-followed` — an unproven control is not a
   satisfied one, exactly as an unproven closure is `weak` on the threat axis. Read the cited
   line yourself where the verdict turns on it; yours is the last word.
4. **Check what you are NOT allowed to use.** The verdict must not be read off the threat
   Robustness you just concluded, nor off whether any guidance drives the rule. If your
   reasoning rests on either, it is the wrong reasoning — go back to the code.
5. **Conclude, then write.** The Adherence you record is **yours**, and so is the
   Justification: ≤256 characters, in your own words, naming the evidence it rests on. Where no
   guidance implements the rule, say so — whichever way the verdict went.

## Testing — the flow

Each step is one action; the tracker for them is **Testing — checklist** at the end of this
file.

0. **Resolve every path in one block, and locate the assessment.** Issue `assessment-mint`
   and `branch-delta` **together** — the mint with the task's `## Task` Title **verbatim** (see
   **The assessment file**), `branch-delta` with no title. If **Phase select** already ran this
   batch this turn, reuse the JSON you are holding rather than paying for it twice; the scripts
   are deterministic, so either way you get the same values. If you reached Testing by an
   explicit request ("verify the implementation"), Phase select was skipped and **you must issue
   the batch here**. If `has_content: false`, you minted the wrong title — recover it from the
   file and re-issue the mint. If no assessment for this task genuinely exists, state so and
   **stop** — Development is reached through Phase select, on a later invocation.
1. **Read the change's shape.** From the batch's `branch-delta` JSON take `base_ref`,
   `diff_ref` and `changed_files` — the file set arrives resolved, so there is nothing to
   capture (see **The change under review**). **Do not run a diff of your own**: each verifier
   reads the change for its own subject, and a copy in your context has no reader. `diff_ref`
   is now fixed for the run: pass that exact string to every verifier. If `fallback: true`,
   report that and its `reason`. If `delta_empty: true`, state "no changes to verify" and
   **stop**.
2. **Collect both scopes — one per driver axis.** Read the bounded `## Threats`, `## Org rules`
   and `## Implementation guidance` slices of the assessment file, and derive **two** independent
   scopes from them.
   - **Threats:** every threat whose **Selection** is `selected`, each paired with the guidance
     entries naming its id — including a threat no guidance names.
   - **Rules:** every `## Org rules` entry whose **Selection** is `selected` (see **Rule
     adherence**) — including one no guidance drives. Excluded entries are out of scope. An
     empty selected set is a legitimate outcome.

   Guidance is read only to give each verifier its context; it is a scope for neither axis, and
   an entry naming no threat needs no pass of its own — the rule it implements carries the verdict.

   If **no threat and no rule is selected**, state "nothing to verify", set
   `Latest stage: testing`, and **stop**.
3. **Dispatch both fan-outs, in one block.** One `ingrain-threat-verifier` per selected threat
   (see **How to dispatch a verifier**), each pointed at its `T<n>` entry, the guidance entries
   naming it, **and the `## Org rules` entries those entries' `Rule refs` name**; and one
   `ingrain-rule-verifier` per **selected** rule (see **How to dispatch a rule verifier**), each
   pointed at its `## Org rules` entry and the guidance that drives it. The two sets are
   independent, so they go out **together**. Collect each verifier's justification, then its
   verdict, plus its evidence and — on `weak` — the residual path. Hold every verdict for steps
   4 and 5, which are where they are settled.
4. **Conclude each Robustness (you decide).** For each selected threat, read the verifier's
   justification, weigh it on its evidence, and conclude the threat's Robustness yourself (see
   **Concluding the Robustness**). Write your own ≤256-char justification for each. It is
   recorded on the threat and nowhere else.
5. **Conclude each Adherence (you decide).** For each selected rule, read the rule verifier's
   justification, weigh it on its evidence, and conclude `followed` | `not-followed` yourself
   (see **Concluding the Adherence**). Write your own ≤256-char justification for each. **Do
   not read this off step 4** — a rule's verdict is about the control it prescribes, not about
   whether a threat survived or whether any guidance drove it.
6. **Finalize the assessment (you write).** Fill each selected threat's **`#### test` block** —
   its ≤256-char **Robustness justification**, then its concluded **Robustness**, its
   **Residual path** (for `weak`; `—` otherwise) and its **Evidence**, in that order; **one
   `## Rule adherence` entry per selected rule** — a `### <rule-id> — <title>` heading with
   `Adherence` and `Justification`; and set `## Task` → `Latest stage: testing`. Follow the
   field card under each heading. Write only between `#### test` and the end of each entry —
   the three blocks above it are the plan review's — and leave an excluded or undecided
   threat's `#### test` block **empty**, exactly as you found it.
   **Write nothing into `## Implementation guidance` or `## Org rules`** — the vessel has no
   verdict, and the rule Selections are the gate's.
   One write, to the minted `assessment_abs`. On a re-verification (the file was already at
   `Latest stage: testing` and the code changed again), **overwrite** the previous
   justifications, levels and adherence entries — they record the current implementation.
   Then **run the three-check against the field cards** and fix what does not match before you
   report to the coding agent (see **The assessment file** → Check the write). This is the "mark
   checked" step — the file now records what was verified, so it is also the last moment a
   malformed entry can be caught before the next session inherits it.
   Finally, **sync the verdicts — best-effort**: run
   `ingrain record verification --assessment "<assessment_abs>"`, **after** the write, never
   before (the CLI reads the file off disk). One file, one flag.
   → `references/lib/ingrain-cli.md` § Recording the assessment. **A failed sync never fails the
   verification** — report it in one line and carry on to step 7.
7. **Report to the coding agent.** Present the findings (see **Reporting format**) and close
   with a one-line verdict. If any threat is `weak`, ask the coding agent to revisit exactly
   those — naming the residual path for each; if any rule is `not-followed`, name those too.

## Reporting format

Report the concluded results to the coding agent as **visible Markdown output in the
conversation** — **one table per driver axis**, and no table for guidance: it carries no verdict,
so it has nothing to report. Lead with the threats.

**Threat robustness**, one row per selected threat, **in id order — `T01` first**, which the
risk-scorer already re-tagged into descending risk (the selection may leave gaps; keep the order).
If **the gate selected no threat**, say so in one line instead of showing an empty table — "no
threat was selected for this change, so there is nothing to judge on the threat axis." A rules-only
review reaches Testing through the OR-route and lands here legitimately, so an empty selected set
is an outcome, not a gap — the same rule the rule axis states below:

| Column | Contents |
|--------|----------|
| **Threat** | id + short title (e.g. `T01 — injected CSS escapes the sandbox`) |
| **Robustness** | `weak` \| `adequate` \| `strong` |
| **Guidance** | the `M<n>` ids naming it, or `none` |
| **Justification** | the reasoning you concluded — the same one behind the table |
| **Evidence** | where the threat is closed (or left open) — `file:line` anywhere in the tree, not only in the delta; or `—` |
| **Residual path** | for `weak`: **the concrete route by which the threat can still be realized**, and the change that would close it. This is the actionable half of the report — name the concrete route an attacker still takes, e.g. "an unauthenticated caller still reaches `/refresh` via X". `—` otherwise |

**Rule adherence**, one row per **selected** rule, **`not-followed` first** — that is the
actionable set. This table is the security owner's answer, so keep it clearly separate from the
threat table rather than folding it in:

| Column | Contents |
|--------|----------|
| **Rule** | title (the id stays in the file; the reader wants the name) |
| **Adherence** | `followed` \| `not-followed` |
| **Driven by** | the `M<n>` ids implementing it, or `none` — design intent, shown beside the verdict, never as the verdict |
| **Justification** | the reasoning you concluded |

If **the gate selected no rule**, say so in one line instead of showing an empty table — "no org
rule was accepted for this change, so there is nothing to judge on the rule axis." An empty
selected set is an outcome, not a gap.

Then close with a one-line verdict per dimension:

- **All at `adequate` or above** — "All N selected threats are closed (T02, T04 at `strong`)."
- **Gaps found** — "N of M selected threats remain realizable: <ids> — please revisit them
  before presenting the change," naming exactly the `weak` ones.
- **Rules** — "All N accepted rules were followed", or "N of M accepted rules were not followed:
  <titles>", naming exactly the `not-followed` ones.

This report goes to the **coding agent** as visible Markdown; the selection gates belong to
Development.


## Testing — checklist

The procedure is **Testing — the flow**; this is the tracker. Tick only what is actually
done. Work top to bottom; this phase runs to its own end. The `assessment-mint` uses the
assessment's `## Task` Title **verbatim** — a paraphrase mints a different file and silently
loses the task. Every read and the finalize write use the absolute `assessment_abs`; the relative
`assessment_path` is display-only. Hand off by pointer: a dispatch carries paths into the
assessment and the diff, and each verifier opens them itself. Report the empty cases out loud.

- [ ] 0. `assessment-mint` + `branch-delta` issued in ONE block, title verbatim; assessment located — no assessment for this task → stop
- [ ] 1. Fork point + `changed_files` read off that batch — no diff of YOUR own; `HEAD` only as a reported fallback; `delta_empty: true` → stop
- [ ] 2. Both scopes collected — ONE PER DRIVER AXIS: `selected` threats (an unnamed threat is still in scope) paired with the guidance naming each, and `selected` `## Org rules` entries (one nothing drives is still in scope); excluded on either axis is out; guidance is context, never a scope; nothing selected on either → set `Latest stage: testing` and stop
- [ ] 3. Both fan-outs dispatched in ONE block — one verifier per selected threat, one per selected rule; each pointed at `## Org rules` in the SAME file; justification FIRST in every return
- [ ] 4. Each threat's Robustness concluded — justification weighed BEFORE the level; a level stands only when its evidence carries it; the conclusion is YOURS; recorded on the threat and nowhere else
- [ ] 5. Each selected rule's Adherence concluded — justification weighed BEFORE the verdict; `followed` stands only when its evidence carries it; NOT read off a threat's Robustness or off whether any guidance drives it
- [ ] 6. Each SELECTED threat's `#### test` block filled — justification FIRST, then `Robustness`, `Residual path`, `Evidence`; the three blocks above it untouched; an excluded threat's left EMPTY as found; one `## Rule adherence` entry per SELECTED rule; `Latest stage: testing` — YOU write, the verifiers only return; NOTHING written into `## Implementation guidance` or `## Org rules`; then three-checked against the field cards; then `ingrain record verification --assessment` (best-effort, AFTER the write)
- [ ] 7. Reported to the coding agent — one table per driver axis and none for guidance; `weak` threats named with their residual path, `not-followed` rules named with their reason; the coding agent owns the code changes

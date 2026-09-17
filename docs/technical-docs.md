# Technical documentation

Internals of the `ingrain-security` plugin: the artifact schema, the phase-block model, the
worker roster, and the verification mechanics.

**This is for maintainers.** Using the plugin needs none of it — [`README.md`](../README.md)
covers that. The normative source for each area is a reference file under
`skills/ingrain-security/references/`; this page is the map, not the spec.

---

## The assessment artifact

One git-ignored markdown file per unit of work, at
`.ingrain-security/assessment-<branch-slug>-<task-slug>.md`, minted by
`ingrain assessment mint`. It is both the workers' hand-off medium and its own persisted
record — finalizing it in place *is* persisting it.

Normative spec: [`references/lib/assessment-file.md`](../skills/ingrain-security/references/lib/assessment-file.md).

### Field cards

Every section carries a **field card** — an HTML comment naming that section's fields, their
order and their exact enumerated values — seeded by the CLI's `renderSkeleton.ts`. A writer
takes the shape from the card, which arrives with the file it must open anyway; the reference is
read only for what a field *means*.

The two must not drift: **a field or an allowed value changed in one is changed in the other in
the same edit.** `tests/static/skill.test.ts` enforces the parity.

### Schema versioning

The artifact declares its own format under `## Task` as `Schema version`, so a consumer branches
on a stated version instead of sniffing structure.

| Version | First plugin release | What it introduced |
| --- | --- | --- |
| 1 | ≤ 0.2.5 | the heading-per-entry layout that replaced the original tables; predates the `Schema version` line, so a consumer reads its absence as version 1 |
| 2 | *(set by the release that merges this change)* | Both driver axes and the vessel between them: `Description` + `Schema version` under `## Task`; `## Affected paths`; `## Org rules` carrying each rule's gate decision and verbatim body (the sidecar is gone); `## Implementation guidance` — renamed from `## Mitigations`, no verdict, no Selection, every entry naming **at least one driver**; the three threat verification fields; `## Rule adherence`; full verbatim rule ids; and **phase blocks** |

Bump the version whenever a field is added, removed, or given new allowed values, and fill the
release that introduced it — see [`.github/RELEASING.md`](../.github/RELEASING.md); the release
flow sets the number from the PR's `release:*` label.

**Version 2 was redefined rather than superseded.** No released plugin has ever emitted a
`Schema version` line — version 1 is the *absence* of one — so no version-2 artifact exists
anywhere for the current shape to break. Bumping to 3 would have implied an earlier v2 that
consumers must still handle. **The CLI refuses a file declaring none or an older number**
(uncommitted artifacts, one regeneration away) while tolerating a *higher* one with a
warning — the ceiling exists so a newer skill cannot break an older CLI, the one direction
the field still guarantees.

---

## Phase blocks
A `## Threats` entry groups its fields under four markers, one per stage that writes into it:

| Block | Written by | Fields, in order |
|---|---|---|
| `#### gen` | `ingrain-threat-generator` | Asset, Vector, Description, Assumptions |
| `#### score` | the orchestrator, at its scoring step | Justification, Impact, Likelihood, Risk score, Criticality |
| `#### usergate` | the orchestrator, at the threat gate | Selection |
| `#### test` | the Testing verification pass | Robustness justification, Robustness, Residual path, Evidence |

**Only `## Threats` carries blocks, and that is a rule rather than a list:** a block records which
of *several* writers owns a field, and `## Threats` is the one entry written by more than one.
Every other entry has a single writer and so has nothing to record. (`## Task` has three writers
but holds no entries, so a per-entry mechanism does not reach it.)

They replaced five drifting prose enumerations of who-writes-what, which had produced ten audit
findings between them.

### The writing rules

- A stage writes **only** between its own marker and the next, and carries every other block
  across byte for byte.
- The generator seeds all four markers when it creates the entry, and fills `#### gen` alone.
- An unrun stage leaves its marker with **no field lines under it**. That emptiness is the signal
  its stage has not run. Inside a block whose stage *has* run, `—` keeps its ordinary meaning: a
  field that does not apply.
- **There is no exception, and there used to be one.** Re-tagging reorders entries, so the risk
  scorer rewrote them whole and had to carry every block it did not own across verbatim — a prior
  pass's `#### usergate` Selection and `#### test` verdicts included. A live run came back having
  flattened a populated `#### test` block, which reads downstream as "never verified". The re-tag
  is `ingrain assessment retag` now: it moves
  entries by line span and never re-types a block, so the carve-out is gone rather than merely
  discouraged. See **The re-tag** below.

### What decides "has this stage run?"

**The fields, not the block.** The CLI reads a stage as having run when that stage's fields are
present in the entry, wherever they sit.

Block presence was the original signal and it silently dropped verdicts: block lookup takes the
*first* match while the entry's merged fields keep the *last*, so the two disagreed whenever a
verdict landed anywhere but inside the first `#### test` block. Keying on the fields makes the
signal identical to the payload's own condition, so they cannot disagree. Placement is enforced
separately and loudly — a verification field outside `#### test` is a validation error, not a
silent drop.

Blocks remain the ownership record; they are no longer the stage signal.

### Tolerance

Both layouts parse identically. A marker-bearing entry and the same content without markers
produce the same fields, so the plugin and the `ingrain` CLI can move independently. Depth-4
headings were already invisible to the CLI's field reader before blocks existed, which is what
made the change zero-cost to parse.

---

## Worker roster

The orchestrator dispatches each worker as a fresh subagent that adopts its role by reading its
reference file. Every worker's sole write is its own section of the assessment file; it returns a
branch keyword plus a one-line pointer, never the content.

**Development** — [`references/development/`](../skills/ingrain-security/references/development/):

| Worker | Writes |
|---|---|
| `ingrain-threat-generator` | `## Threats` entries, `#### gen` |
| `ingrain-threat-critic` | `## Threat critique` *(transient)* |
| `ingrain-rule-critic` | `## Rule critique` *(transient)* |

**Testing** — [`references/testing/`](../skills/ingrain-security/references/testing/):
`ingrain-threat-verifier` and `ingrain-rule-verifier`, one per selected subject. Both are
**read-only**: they return a justification and a verdict, and the orchestrator records.

Both critique sections are iteration scratch and are deleted at finalize.

**A step is a worker when it needs fresh eyes; it is the orchestrator's when it already holds the
input.** A dispatch buys clean context and a cheaper model tier, and costs a wave — the subagent
re-reads from disk what the orchestrator is holding, and the orchestrator cannot take a turn while
suspended on it. So four steps have no worker: the opening review question, the org-rule
retrieval, the **risk scoring** (over the `## Threats` slice the threat gate needs read anyway)
and the **implementation guidance** (from two driver sets already in context).

Three workers were retired on that reasoning — `ingrain-risk-scorer`,
`ingrain-guidance-generator` and `ingrain-guidance-critic` — which removed three sequential waves
from every Development run. The scoring worker also did one job that is not judgement at all:
**the re-tag**, now `ingrain assessment retag`. See
**The re-tag** below.

---

## The sort (`ingrain assessment retag`)

Sorting the scored threats into descending-risk order is a total order over four keys, so it is a
script rather than a prompt:

    ingrain assessment retag --assessment "<assessment_abs>"

Risk score descending → impact → likelihood → the incoming id, which is unique, so the order is
total and re-running it on an already-sorted section is a fixed point.

**It sorts; it does not renumber.** A threat's `T<nn>` is assigned once, by the generator, and
belongs to that threat for the life of the task. The name is a misnomer left from when the tag
was a rank; it is a subcommand now, so nothing invokes it by path and renaming it costs only a
prose sweep.

**Why the tag stopped being a rank.** It used to be one: sort by risk, renumber from `T01`. That
made the id move whenever a score moved — and a re-review re-scores every entry, so across two
runs of the same task `T01` could name two different threats. Anything anchored to the tag then
described the wrong threat silently, which is fatal to a CI review that posts findings as
pull-request comments keyed on it: the thread would follow a rank rather than the threat it was
opened about. Risk order survives as **document** order; priority is read from the `Risk score`
column every threat table already carries.

**It is also what retired the block rule's one exception.** Moving an entry means moving it, and
the worker that used to do this was told to rewrite `## Threats` wholesale and carry every block
it did not own across verbatim — a live run came back having flattened a populated `#### test`
block, erasing a prior pass's verdicts. The script moves entries by **line span** and now re-types
no line at all, so every block and every heading survives byte for byte.

**It refuses a half-scored section** (`retagged: false`, `reason: unscored-entries`) and leaves
the file untouched: an entry the scoring step never reached has no risk to sort on, so it would
land wherever the comparison dropped it and read as a priority nobody set.

**Context discipline.** The orchestrator holds only compact statuses and pointers, and reads
bounded slices of the assessment at the gates and at finalize. Retrieval is the single exception:
the CLI's rule bodies pass through its context because it is the one writing them into
`## Org rules`.

---

## Verification mechanics

### Two dimensions, neither derived from the other

**Robustness** answers *"can this threat still be realized?"* — the developer's question.
**Adherence** answers *"was this rule followed?"* — the security owner's. They may legitimately
disagree: a rule can be followed while a threat stays reachable, and violated while every threat
is closed.

There is nothing to derive through. Implementation guidance — the only thing standing between
the two axes — carries **no verdict at all**, so no chain exists between them. Deriving one from
the other would produce confident, wrong compliance answers.

### The vessel rule

Guidance is *how* a driver's goal is reached, never a subject of verification. It carries no
verdict, no Selection and no adoption state; its efficacy is read off the drivers beside it.
That is what lets one entry serve several threats **and** several rules at once and still mean
one thing — it is one object with a stable id and a set of drivers, never one object per pair.

### Justification before verdict

A verifier handed a subject and the guidance meant to address it is under quiet pressure to
conclude it was handled. So each returns its **justification first**, and the orchestrator
re-derives the conclusion from the cited evidence rather than taking the level at face value:

- a level stands only when a cited `file:line` carries it;
- an `adequate` resting on an assertion is `weak`, with the residual path named;
- a `strong` whose artefact is asserted without a citation is `adequate`;
- `not-followed` has no line to cite — an absent control is absent everywhere — so its evidence
  is a statement of where the verifier looked.

Evidence outside the branch diff counts. Most of the route an attacker walks is code the change
never touched.

### Partial passes

A completed pass leaves one verdict per selected subject; an interrupted one leaves fewer. That
is a **state, not a defect**: the wire accepts a partial verdict set, the CLI reports the gap as
information, and what was concluded syncs. Completeness is the pass's procedure, asserted in its
checklist rather than enforced as a validation rule.

---

## Phase select's routing

`resolvePhase`, in the CLI's `commands/assessment/lib/phase.ts`, reads six measured facts and emits `phase` +
`phase_reason`. The **order the states are tested in is the whole of its meaning**, which is why
it is a rule in one place rather than prose each caller re-derives.

| `phase_reason` | Fires when | Route |
|---|---|---|
| `siblings_present` | no file for this title, but written assessments sit beside it | `requires_judgement` |
| `fresh_task` | nothing written for this task | `development` |
| `resume_analysis` | written, but no driver gated on either axis | `development` |
| `scope_moved` | **the change reached code outside the recorded footprint** | `development` |
| `verify_now` | drivers gated and a delta exists | `testing` |
| `delta_unreliable` | drivers gated, tree clean, and no fork point resolved | `requires_judgement` |
| `implementation_ahead` | drivers gated, tree clean, fork point fine | `development` |

**`scope_moved` is tested before `verify_now`, and that ordering is the point.** They read the
same delta against different questions — "is there code to verify" versus "is it still the code
this analysis was built for". Unattended, every run after the first has a delta, so without the
earlier test a branch that acquires work elsewhere routes to `verify_now` forever: it keeps being
checked against the first push's threats while coverage falls behind, and the review keeps
passing. That is the failure worth routing on precisely because it looks like success.

The footprint reaches the mint as `--scope-paths FILE`, one repository-relative folder per line.
It lives on the platform, so **a local run has no source for it and omits the flag** — and with
no footprint the verdict is false, leaving the route exactly as it was. `changed_outside_footprint`
in the CLI's `lib/footprint/changedOutsideFootprint.ts` matches on a **folder boundary**, so `backend/` does not cover
`backend-legacy/`; a bare string prefix would report a change as covered by an analysis that never
looked at it.

That lib exists because two scripts now need the same answer to "what did this branch touch", and
they run in the same Phase-select block. A second implementation could disagree, and the
disagreement would surface as a route.

## Unattended runs

`INGRAIN_SECURITY_UNATTENDED` carries two facts in one variable: **presence** says no window
mechanism can reach a person, and its **value** (`connected` | `standalone`) says whether there is
a platform. The second is not inferable — the skill otherwise reads connectedness off the CLI
being present, which unattended it always is, baked into the image.

The mint reports both as `unattended` and `run_mode`, because the first gate is Step 0's review
question — reached before the run has taken a turn of its own, so a signal the orchestrator had to
go and read for itself would arrive a turn late.

`INGRAIN_SECURITY_BAND` is the second variable, reported as `caller_band` and read **only in
standalone**: with no
platform to ask, the caller supplies the gating band (`low` | `medium` | `high`, anything else
resolving to `high`). A connected run's band is the org's own and arrives on the rule-retrieval
response, so the mint refuses to report a caller-supplied one there — on a pull request the
workflow file comes from the branch under review, and precedence stated only in prose would be
the author's to argue with.

The band → threshold numbers live in the CLI's `phase.ts`, and the mint emits them as
`threshold_high` / `threshold_medium` / `threshold_low`. One lookup rule serves both modes —
`threshold_<band>`, the band coming from `caller_band` in standalone and from the retrieval's
`maturityBand` when connected — so the gate reads a number rather than applying a table from
prose. It is the one constant that decides what a customer's CI enforces, and Phase 5 quotes it
into a pull-request comment.

**An unrecognised value resolves to `connected`**, which is the safe direction rather than the
lenient one: guessing connected when the truth is standalone fails a `record` visibly against a
platform with no token, while guessing standalone records nothing and says nothing — the silent
degradation `ingrain assert-synced` exists to catch. The offending value is named in
`instruction` so a typo is visible rather than merely survivable.

Each gate's unattended resolution, and the band → threshold table it turns on, live in
`SKILL.md` § Unattended runs — one copy, because Part 1 defers server-side enforcement
specifically to avoid a second.

## The trigger layer

**There isn't one, and that is a deliberate change.** Up to `v1.2.0` the plugin shipped six
hooks: a `SessionStart` directive, an `ExitPlanMode` nudge, and a `PreToolUse` gate that
**denied** a code write on a branch with no recorded `## Triage` verdict. The gate was the only
mechanism that made the review happen to a session that would otherwise skip it.

All six are gone, and nothing in the plugin replaces the gate. The review is invoked by a user
prompt or a CI entrypoint; the backstop is an **opt-in** `CLAUDE.md`/`AGENTS.md` block the user
installs from the docs — the same text `session-start` used to inject, moved from code the
plugin owns to instructions the user owns.

**Why.** Four reasons, and only the first is tidiness.

- **The gate only ever worked where we had written an adapter.** Two `hook.json` shapes, two
  `allow-assessment-write` variants, a Claude-only `exit-plan-mode`, and `run-hook.cmd` — a
  cmd/bash polyglot whose whole purpose was finding Git Bash on Windows. "Enforced" already
  meant "enforced on some hosts".
- **Hooks were the plugin's only always-executing code path.** They ran on every
  `Write`/`Edit`/`MultiEdit`/`NotebookEdit` and at every session start, parsing
  attacker-influenceable tool payloads with the developer's full privileges. So a supply-chain
  compromise of this repository was arbitrary code on every file write, in every session, on
  every machine that installed it, delivered by a version bump. What ships now is markdown: it
  can mislead an agent, and it cannot execute.
- **`jq` left the dependency set.** No skill script ever used it; it was a *soft* dependency of
  one hook lib, where its absence turned every write decision into "defer" and both write gates
  quietly stopped deciding.
- **The review is invoked, not triggered.** With the mechanical half in the `ingrain` binary,
  the skill is reached from exactly one place — its own opening batch — so a missing
  prerequisite is one failed command with a stated remedy rather than a run that limps past a
  skipped step.

**What it costs, stated rather than discovered.** A team that installs the plugin and reads none
of the docs gets a skill nobody invokes. The loss is real; what makes it acceptable is that it
is **visible** — no review ran, and you can see that — where a hook failing open is not. And the
gate's own escape hatch always was in-band: declining the review recorded `Verdict: minor`, so
the record showed *assessed, found not security-relevant* rather than nothing at all. That
property survives, because it belongs to the review question and never to the hook.

**The write grant moved to `allowed-tools`.** `SKILL.md`'s frontmatter scopes `Write` and `Edit`
to `.ingrain-security/`, which replaces the two `allow-assessment-write` hooks. Where a host
does not apply a path-scoped rule, the write prompts — a UX regression, not a correctness one,
and the documented fallback rather than a reason to bring a hook back.

---

## Testing tiers

| Task | Tier | Runs in CI |
|---|---|---|
| `deno task test:static` | prose and wiring assertions, no model calls | yes |
| `deno task test:parity` | task-table wiring | yes |
| `deno task test:shell` | shellcheck over the three `.github/` release scripts, and the assertion that the plugin ships no executable at all | yes |
| `deno task test:agent` | **live model calls** on a selected host — one dispatch per worker, plus the directed trigger pair | no |
| `deno task test:integration` | full orchestration on the selected host | no |

`deno task ci` is the offline tier — lint, fmt and the three suites above it. The live tier's host
is a harness setting, not a skill property: `INGRAIN_TESTS_AGENT_HOST=claude` (the default) drives
Claude Code, `INGRAIN_TESTS_AGENT_HOST=opencode` drives OpenCode as configured on the machine, and
`test:matrix:claude` / `test:matrix:opencode` run the whole live tier on one host. The suite's host
seam is asserted by tests — shared modules (`matchers`, `reporter`, fixtures) import no backend and
only `lib/runners/index.ts` may.

`deno task ci` is the offline tier — lint, fmt and the three suites above it.

**`ci` no longer evidences that the review executes**, and that is worth stating rather than
inferring from a green run. The mint, the delta and the re-tag are the `ingrain` CLI's now, so
their behavioural tests live in that repo, and three cross-repo agreements live in the
monorepo's `tests/contract/` — the only tier that can see both:

| Check | Where |
|---|---|
| mint · delta · re-tag behaviour | `ingrain/cli/commands/{assessment,delta}/tests/` |
| field card ↔ `assessment-file.md`, and the band → threshold numbers | `tests/contract/skill-cli/assessmentCards.test.ts` |
| every documented `ingrain-script` command actually runs | `tests/contract/skill-cli/documentedInvocations.test.ts` |

What `ci` covers here is prose, wiring and the release scripts. **`test:agent` is what evidences
the review runs at all** — the directed trigger pair especially, since with no hook to inject
context those are the tests that answer whether a prompt alone starts and runs a review, on the
harness host the run is pointed at.

**The offline tier cannot see producer behaviour.** It asserts what the prose *says*; only the
agent tier observes what a worker *does* with it. Both matter, and each catches what the other
cannot: the statics caught a card that named a field in two blocks, the agent tier caught a
scorer that dropped a threat.

Details: [`tests/README.md`](../tests/README.md).

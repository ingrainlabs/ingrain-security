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
`scripts/assessment-mint`. It is both the workers' hand-off medium and its own persisted
record — finalizing it in place *is* persisting it.

Normative spec: [`references/lib/assessment-file.md`](../skills/ingrain-security/references/lib/assessment-file.md).

### Field cards

Every section carries a **field card** — an HTML comment naming that section's fields, their
order and their exact enumerated values — seeded by `scripts/lib/artifact-template.sh`. A writer
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
consumers must still handle.

---

## Phase blocks

A `## Threats` entry groups its fields under four markers, one per stage that writes into it:

| Block | Written by | Fields, in order |
|---|---|---|
| `#### gen` | `ingrain-threat-generator` | Asset, Vector, Description, Assumptions |
| `#### score` | `ingrain-risk-scorer` | Justification, Impact, Likelihood, Risk score, Criticality |
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
- **The risk scorer is the one exception.** Re-tagging reorders entries, so it rewrites them
  whole — and must therefore carry every block it does not own across verbatim, including a prior
  pass's `#### usergate` Selection and `#### test` verdicts on a re-assessment.

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
| `ingrain-risk-scorer` | `#### score` + `## Risk score` |
| `ingrain-rule-critic` | `## Rule critique` *(transient)* |
| `ingrain-guidance-generator` | `## Implementation guidance` |
| `ingrain-guidance-critic` | `## Guidance critique` *(transient)* |

**Testing** — [`references/testing/`](../skills/ingrain-security/references/testing/):
`ingrain-threat-verifier` and `ingrain-rule-verifier`, one per selected subject. Both are
**read-only**: they return a justification and a verdict, and the orchestrator records.

The three critique sections are iteration scratch and are deleted at finalize. Two steps are the
orchestrator's alone and have no worker: the opening review question, and the org-rule retrieval.

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

## Testing tiers

| Task | Tier | Runs in CI |
|---|---|---|
| `deno task test:static` | prose and wiring assertions, no model calls | yes |
| `deno task test:parity` | script output contracts, both directions | yes |
| `deno task test:hooks` | the mint, the write grant, the folder hook | yes |
| `deno task test:shell` | `branch-delta` behaviour + shellcheck | yes |
| `deno task test:agent` | **live model calls** — one dispatch per worker | no |
| `deno task test:integration` | full orchestration | no |

`deno task ci` is the offline tier — lint, fmt and the four suites above it.

**The offline tier cannot see producer behaviour.** It asserts what the prose *says*; only the
agent tier observes what a worker *does* with it. Both matter, and each catches what the other
cannot: the statics caught a card that named a field in two blocks, the agent tier caught a
scorer that dropped a threat.

Details: [`tests/README.md`](../tests/README.md).

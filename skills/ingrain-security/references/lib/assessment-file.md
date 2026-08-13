# Assessment file reference

Defines the local analysis artifact the `ingrain-security` review persists and hands
off through. The orchestrator creates and finalizes it; each worker writes its own
named section. Follow this structure exactly so every stage reads and writes the same
shape.

## Nature

- **Path.** A single file written directly into `.ingrain-security/` at the project
  root — it is **both** the living working copy the workers write during the run **and**
  its persisted record, so finalizing it in place is the whole of persisting it. The
  orchestrator mints it: it runs the `scripts/assessment-mint` script
  once at review start and reuses its **`assessment_abs`** — the
  absolute path — as the write target throughout; the relative `assessment_path` is a
  display form for prose and links only. **Every write goes to the absolute path** — a
  relative path is resolved by whoever receives it, and a worker subagent resolves
  `.ingrain-security/…` against whatever file it happens to be reading, creating a stray
  folder there. The name is deterministic in the branch + task:
  `<project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md`. The script
  resolves `<project_root>` from the git repo root — so it may be run from any
  subdirectory — resolves
  `<branch-slug>` from the current git branch (`git branch --show-current`, which stays
  correct in a worktree or submodule), lowercased and reduced to `[a-z0-9-]`,
  and derives `<task-slug>` from the `## Task` Title by the same rule. Because the name
  *is* the task identity, re-reviewing the **same task on the same branch** resolves to the
  **same file** (the run resumes/updates it in place; `has_content: true` signals this),
  while a different task or branch gets its own file. This is also **how two concurrent
  tasks on one branch stay isolated** — distinct titles mint distinct files, so parallel
  reviews each keep to their own file; the separation is structural — the filename enforces
  it. Any unresolvable segment is dropped
  (branch unknown → `assessment-<task-slug>.md`; no usable title →
  `assessment-<branch-slug>.md`; both absent → `assessment.md`), and the `assessment-`
  prefix always leads. The folder is **self-ignoring** (an inner `.gitignore` of a bare `*`,
  seeded by the `ensure-assessment-dir` hook and re-ensured by the script), so the whole
  folder — the ignore file included — stays out of `git status`; sharing a file is an
  explicit `git add -f <file>` opt-in.
- **Seeded with a skeleton.** The same mint **writes this file's empty skeleton** when it does
  not exist yet — every heading in schema order, a **field card** under each, and the field
  labels of the fixed sections, as **structure only** — every value left empty except the four
  the mint itself knows (`Title`, `Latest stage`, `Schema version`, and `—` under
  `## Affected paths`), every entry left
  to the writer. `## Threats`, `## Org rules` and `## Implementation guidance` are seeded as
  heading + card, and the writer that fills each puts its `### <id> — <title>` entries beneath.
  So every writer starts from a ready-made page:
  **fill the sections in place** rather than re-creating the page — an existing file is always
  filled as it stands. An unfilled skeleton is recognisable on sight: the headings are all
  there, every value beneath them is still empty.
- **The field cards carry the shape; this file carries the meaning.** A card is an HTML comment
  under a section heading naming that section's fields, their order and their exact enumerated
  values — rendered from the spec below by `scripts/lib/artifact-template.sh`. It is where
  writers get the shape, because it arrives with the file they must open to write at all, where
  recovering the same shape from this reference costs a full read of it. **This file stays
  normative**: it owns what each field *means*, the reasoning schemas, id permanence and the
  lifecycle, and a writer opens it when meaning is what it is missing. The two must not drift —
  **a field or an allowed value changed here is changed in the card in the same edit.** The
  cards are **permanent**: finalize deletes the scratch sections and keeps them, because the
  implementing agent and the Testing pass run in later sessions with no reference in context.
  Because of the seeding, **an untouched skeleton reads as `has_content: false`** — exactly
  like no file at all, which is what lets Phase select and the resume check read it. Two
  further fields say which
  empty case you are in — `template_seeded` (this mint wrote the skeleton) and
  `template_only` (the file is still an untouched skeleton).
- **Pre-approved.** An `allow-assessment-write` hook auto-approves writes to this file on
  both hosts — `PreToolUse` on Claude Code, `PermissionRequest` on Codex — so expect **no
  permission prompt** when writing it. The grant covers only `assessment*.md` directly
  inside `.ingrain-security/` — which is exactly `assessment_abs`, and one more reason to
  write there and nowhere else. Any other path you write still prompts the user and stalls
  the run. On Codex the approval is granted per **patch**: a patch that touches the
  assessment *and* any other file prompts as a whole, so keep assessment edits in their own
  patch. In **plan mode** the write is held for the user's approval all the same: ask them
  to allow writes to `.ingrain-security/`, naming this file and what the run needs it for,
  then retry the same write to `assessment_abs`.
- **Hand-off medium.** Workers write their sections and return to the orchestrator
  only a branch keyword plus a one-line pointer. The orchestrator owns the
  title/banner and the finalize; it moves data between workers by pointer and does
  not read the full running analysis into its own context. Section ownership:

  | Section | Written by |
  |---------|-----------|
  | `## Task` | the mint seeds `Title`, `Latest stage` and `Schema version`; the orchestrator writes `Description` at Development, and the Testing pass advances `Latest stage` |
  | `## Affected paths` | orchestrator, at Development beside `Description` |
  | `## Triage` | `ingrain-relevance-triage` (`Verdict`, `Security relevant`, `Prior analysis`); the orchestrator writes `Surfaces`, and writes `Verdict` + `Security relevant` itself when triage returned `unclear` |
  | `## Threats` | `ingrain-threat-generator` (the entries and their descriptive fields) → `ingrain-risk-scorer` (the scoring fields) → orchestrator (Selection at the **threat gate**) → the Testing verification pass (Robustness + its justification, Residual path and Evidence at the Testing phase) — **filled in stages**, each stage editing the field lines it owns |
  | `## Threat critique` | `ingrain-threat-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Risk score` | `ingrain-risk-scorer` (plan-level residual) |
  | `## Org rules` | orchestrator (the broad retrieval pass writes each entry and its body; the machine prune removes rejected ones; the **rule gate** records each surviving Selection) |
  | `## Rule critique` | `ingrain-rule-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Implementation guidance` | `ingrain-guidance-generator` — a single writer, since the vessel carries neither a gate decision nor a verdict |
  | `## Guidance critique` | `ingrain-guidance-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Rule adherence` | the Testing verification pass (one entry per **selected** org rule, at the Testing phase) |
  | `## Maintenance (for the implementing agent)` | the mint — seeded static text, never rewritten by any stage |

  **One artifact.** The org rules used to live in a separate `rules-<…>.md` sidecar; they now
  ride in this file's own `## Org rules` section. That removed a second file every stage had to
  keep in step, and with it the failure class where a consumer simply did not have it — a sync
  that recorded no rule at all, and a later verification rejecting its verdicts with nothing on
  screen to explain why. `Rule refs` in `## Implementation guidance` now names an id three
  headings up.
- **Living document.** Rewrite the relevant section at each commit point so the file
  always mirrors the current frozen state — critic-loop revisions and re-selection
  overwrite the prior contents of that section. The three critique sections
  (`## Threat critique`, `## Rule critique`, `## Guidance critique`) are iteration scratch, and
  the orchestrator **deletes all three at finalize** — so the finalized file holds end results
  alone, which is why the template below omits them. `## Org rules` is **pruned rather than
  deleted**: a selected entry keeps its body (it is Testing's specification), an excluded one
  keeps its heading and `Selection` line with the body dropped — the decision is the record,
  the payload was provenance.

## Sections and fields

Every field below is **required** unless marked optional, and every enumerated field
must use **exactly one** of the listed values (lower-case, verbatim).

### `## Task` 
- **Title** — string.
- **Latest stage** — `development` | `testing`. The lifecycle stage the file has reached,
  and the same two names the skill's phases carry: `development` while the plan review and
  the implementation are in progress; `testing` once the Testing verification pass has
  judged the selected drivers against the implementation.
- **Description** — string, one line: what this change does. Written by the orchestrator when
  it opens the file at Development. It is the only place the file states one, and it is stated
  rather than synthesised from `## Triage` Surfaces on purpose — synthesis yields prose the
  user never reviewed and cannot correct.
- **Schema version** — integer, currently `2`. Declares which revision of *this* schema the
  file follows, so a consumer branches on a stated version instead of sniffing structure
  (heading-vs-table today, present-vs-absent fields tomorrow). Bump it here **and in the field
  card** whenever a field is added, removed, or given new allowed values.

### `## Affected paths` — the folders this change is expected to touch

A bullet list of **repository-relative folder paths**, one per bullet, written by the
orchestrator at Development alongside `Description`.

This is a **prediction, not a measurement**. At Development the code does not exist yet,
so there is no diff to read: state your best understanding of where the change will land,
from the plan you just reviewed. Being approximately right is useful; being silent is not.

- **Folders, not files** — `backend/services/sync/`, not `backend/services/sync/design.ts`.
  A folder stays correct as the file set shifts during implementation.
- **Repository-relative** — no leading `/`, no `../`, no absolute paths. Relative to the
  repository root, not to this file.
- **Only this repository.** A path names a folder in the repo the review is running in.
- **A few, at the right depth.** Prefer the shallowest folder that still describes the
  change. Listing the repository root (`.` or `/`) says the change is everywhere, which
  is almost never what you mean and switches off the narrowing this section exists for.
- `—` while unwritten, exactly like every other field.

**What it is for:** the `ingrain` CLI reads this section to scope org-rule retrieval to the
code you are about to touch, and sends it with the assessment so the platform can attribute
the analysis to the right part of the codebase. A wrong path narrows retrieval to the wrong
place, so it is worth a moment's thought — but the skill never depends on it, and an
unwritten section simply means an unscoped search.

### `## Triage` — the relevance-triage verdict
- **Verdict** — `minor` | `major`. Two values, and they stay two: where the plan does not say enough
  for the triage worker to classify it, the worker returns `unclear` **without writing this field**
  and the orchestrator asks the user, recording their answer here. An inconclusive triage is a
  question, never a third verdict — so nothing downstream has to interpret one.
- **Security relevant** — `true` | `false`. Written with `Verdict`, by whoever wrote it.
- **Surfaces** — bullet list (present when `major`).
- **Prior analysis** — optional; a pointer to a prior analysis file found for this
  task (its `.ingrain-security/…` path and threat count, e.g.
  `.ingrain-security/assessment-<…>.md — 4 threats`), or `none`. Set by
  `ingrain-relevance-triage` when it finds a threats-bearing prior analysis of the same
  task (branch + title); the generator seeds from it.

### `## Threats` — one `###` entry per threat; most tasks warrant **3–6** — treat it as a target; keep it short and scoped

Each threat is a `### <id> — <title>` heading followed by one `Name: value` field per line:

```markdown
### T01 — Refresh token replay
Asset: the refresh endpoint
Vector: a captured token is replayed
Description: …
Assumptions: …
Justification: —
Impact: —
Likelihood: —
Risk score: —
Criticality: —
Selection: —
Robustness: —
Robustness justification: —
Residual path: —
Evidence: —
```

| Field | Constraint |
|-------|------------|
| **id** (in the heading) | `T<n>`, zero-padded (`T01`) — unique within the file; assigned in discovery order by the generator, **reassigned once** by the risk scorer into descending-risk order, and fixed from that point on |
| **title** (in the heading) | string, after the ` — ` |
| **Asset** | string |
| **Vector** | string |
| **Description** | string |
| **Assumptions** | string |
| **Justification** | string, **≤ 256 characters** |
| **Impact** | `critical` \| `high` \| `medium` \| `low` |
| **Likelihood** | `very high` \| `high` \| `medium` \| `low` |
| **Risk score** | integer `0`–`100` |
| **Criticality** | `low` \| `medium` \| `high` \| `critical` |
| **Selection** | `selected` \| `excluded` \| `undecided` (`—` until the **threat gate**) |
| **Robustness** | `weak` \| `adequate` \| `strong` — how well this threat is closed in the implementation: `weak` = the threat can still be realized (a route survives, or the analysis leaves its closure unestablished); `adequate` = its realization routes are closed; `strong` = closed broadly **plus** artefacts that would fail if the control regressed. Concluded by the Testing pass from negative testing against the implementation. Normative definitions: `references/testing/verification-pass.md` → **Robustness levels**. **Set it from that verification's verdict** — it reads `—` until then, and for any threat outside the `selected` set. |
| **Robustness justification** | string, **≤ 256 characters** — the reasoning behind **Robustness**, concluded by the Testing orchestrator from the verifier's evidence. Deliberately **not** named `Justification`: on this entry that name already means the risk-scoring rationale, and one name for two rationales is what makes them get interleaved. Reads `—` until Testing runs, and for any threat outside the `selected` set. |
| **Residual path** | string — for a `weak` verdict, the concrete route by which the threat can still be realized and the change that would close it. The actionable half of the verification. `—` for any other verdict, where there is no surviving route to name. |
| **Evidence** | *optional* — where the threat is closed or left open (`file:line`) — **anywhere in the tree, not only in the changed files**: a control that closes this threat counts wherever it lives, and a route that leaves it open counts wherever it survives. Advisory and volatile: line numbers drift as the code moves on, so treat it as a pointer, never as a claim the reader can re-verify later. `—` when the verifier cited none. |

**One field per line is what makes this file cheap to maintain.** Every stage after the
generator fills a field the stage before it left `—` — the risk scorer, the threat gate, the
verification pass — and each of those touches a contiguous run of lines inside an entry, so a
stage costs **one Edit per entry**, not one per field. Write the fields in the
order above; a field the stage that owns it has not run yet reads `—`.

**The four verification fields sit at the tail for that reason** — `Robustness` and the three
that follow it are everything the Testing pass owns, so they form one contiguous run and that
stage still edits a single block. They are appended rather than filed beside their relatives
(`Robustness justification` next to `Justification`, say) because existing fields keeping their
positions is what lets a parser written against the old order still find them.

**Justification leads the scoring fields on purpose.** The scorer fills an entry top-down,
so this schema doubles as a reasoning schema: writing the justification *before* the
numerical (Risk score) and qualitative (Impact, Likelihood, Criticality) scores lets the
reasoning come first and drive the scores.

**The id carries the priority.** Before scoring, an id is a provisional discovery-order label:
the generator assigns `T01`, `T02`, … as it finds threats, and those labels stay stable across
the critique and the single revision round so the critic's `[T<n>]` feedback keys line up.
Gaps from dropped threats are legal at that stage.

The `ingrain-risk-scorer` then **re-tags the list exactly once**. It sorts by **Risk score
descending**, breaking ties by impact (critical > high > medium > low), then likelihood
(very high > high > medium > low), then the pre-scoring id ascending — a deterministic total
order, so two runs over the same scores produce the same ids. It reassigns ids contiguously
from `T01`, closing any gaps, and writes the entries in that order. `T01` is the most
dangerous threat.

**After scoring the id is permanent.** It is what every guidance entry's **Threats** field
references, and guidance is written after scoring, so every reference points at a final id.

**Document order is id order is risk order.** Anywhere threats are shown — the threat gate's table,
a worker's report, the verification tables — display them in **id order, `T01` first**.

**The threat gate → Selection.** When the user decides, record each threat's **Selection**: act on
it → `selected`, accept the risk → `excluded`. Use `undecided` only if the user is explicitly
unsure. Before the gate the field reads `—`. It is one of the two driver gates, presented in the
same user moment as the **rule gate**, and its Selection scopes the **robustness** dimension
exactly as the rule gate's scopes **adherence**.

### `## Risk score` — plan-level residual risk
- **Score** — integer `0`–`100`.
- **Criticality** — `low` | `medium` | `high` | `critical`.

### `## Org rules` — one `###` entry per retrieved rule, and what the gate decided

The **second driver axis**, symmetric with `## Threats`: a threat sets a goal (close this), a
rule sets a goal (implement this control), and implementation guidance is how either goal is
reached. Written by the broad retrieval pass, which runs **in parallel with the threat chain**
and keys on the plan, the triage Surfaces and `## Affected paths` — never on gate selections.

Each entry is a `### <rule-id> — <title>` heading, then a `Selection` line, then the rule's
body verbatim:

```markdown
### 0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f — Documented function and data-level access rules
Selection: selected
Every function that reads or writes user-scoped data must document the access rule it
enforces, and enforce it at the boundary rather than in the caller.
```

| Field | Constraint |
|-------|------------|
| **id** (in the heading) | the full org rule id, **verbatim** as the `ingrain` CLI returned it — never abbreviated. It is an exact-match key into the platform's own rule table, so a shortened copy names no rule at all |
| **title** (in the heading) | the rule title, after the ` — ` |
| **Selection** | `selected` \| `excluded` (`—` until the rule gate runs) |
| body | the rule text, verbatim and in full, on the lines beneath — not a `Key: value` field. It is Testing's specification for judging the rule |

**Retrieval is broad on purpose, and precision is restored before the user sees anything.**
Missing a governing rule is the costly failure, so the pass casts a wide net; the
`ingrain-rule-critic` then judges each retrieved rule's applicability to *this* change in one
round, and the orchestrator **prunes the machine-rejected entries from this section before the
gate** — keeping any whose prune reason does not hold, since it holds the pen and the critique is
advice. A pruned rule is never presented and never recorded — machine judgment is retrieval
refinement, exactly like the search ranking, and only user decisions reach the record.

**The rule gate → Selection.** Presented in the same user moment as the threat gate, over the
curated set alone, with an **accept-all** option first: the default costs one choice, and
per-rule windows exist for the remaining misses. `selected` means the developer declares the
rule governs this change — which is what puts it in **adherence scope**. `excluded` means
deemed inapplicable here: a recorded decision, never a verdict, and left unjudged at Testing.

**Both decisions travel.** An exclusion is exactly what makes developer-side scoping
governable — its author gets to see that a rule was set aside, and a rule repeatedly excluded
across changes is itself a signal. Filtering exclusions out would make that silent.

**Finalize prunes by Selection.** A `selected` entry persists in full — its body is what the
Testing pass reads as the rule's specification, whether or not any guidance ended up driving
it. An `excluded` entry keeps its heading and `Selection` line and **drops its body**.

### `## Implementation guidance` — one `###` entry per piece of work

Work that reaches a goal a driver sets: closing a threat, or implementing an org rule. The
**lower abstraction level** — *how* we get there — and **never itself a subject of
verification**, so an entry carries no verdict, no Selection and no adoption state. Its
efficacy is read off the drivers beside it.

```markdown
### M01 — Bind the enrollment token to the request that produced it
Description: …
Yield: high
Effort: medium
Threats: T01, T03
Rule refs: 0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f
```

| Field | Constraint |
|-------|------------|
| **id** (in the heading) | `M<n>`, zero-padded (`M01`) — unique within the file, assigned once and **never changed**; gaps are legal. The `M` is the historical prefix, kept because stored rows and lineage carry-forward match on the literal tag |
| **title** (in the heading) | string, after the ` — ` |
| **Description** | string |
| **Yield** | `high` \| `medium` \| `low` |
| **Effort** | `high` \| `medium` \| `low` |
| **Threats** | `0..N` threat ids (e.g. `T01, T03`), each resolving to a `### T<n>` entry in this file — the threats this guidance closes; `—` when it is driven by rules alone |
| **Rule refs** | `0..N` org rule ids the guidance **implements** (e.g. `0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f, c611c934-151b-4fb9-8e7a-5b765e660837`), each resolving to a **`selected`** `## Org rules` entry in this file; `—` when it is driven by threats alone. **Each id is a full id, copied verbatim from that section — never abbreviated, never a prefix.** Ids are machine-facing — the user sees rule titles, resolved at display time from `## Org rules` |

**Every entry names at least one driver.** `Threats` and `Rule refs` may each be `—`, but
**not both**: work that traces to no stated goal cannot be attributed, verified or governed.
Guidance carries no verdict of its own, so an unanchored entry is unreachable from either
verification dimension — nothing would ever say whether it mattered. The CLI refuses such a
file and the platform refuses such an envelope.

**Rule-driven guidance is ordinary guidance.** An entry naming a rule and no threat is fully
anchored: it states how a standing org requirement becomes concrete in this change. This is
not the old "general implementation instruction" under a new name — that category existed
because rule-driven work had no driver to name, and it dissolves now that a rule is a driver
in its own right.

**A `Rule refs` id may only name a `selected` rule.** Driving is design intent — "this entry
is how that rule becomes concrete here" — and the gate is what decides a rule governs the
change at all. Naming an excluded rule claims a mandate the developer withheld; naming an
ungated one claims a rule nobody decided on.

**One entry may serve several threats *and* several rules — write it once.** A single control
routinely closes two threats *and* satisfies the org rule that prescribes it, and that is
exactly where this model earns its keep: the same work is reached from either side without
being duplicated. A guidance entry is **one object with a stable id and a set of drivers**,
never one object per (entry, driver) pair. Copying it per driver would read as several pieces
of work and be counted, rendered and verified as such.

**Guidance is not gated.** All critiqued guidance lands in the plan at finalize, and the user
refines it **there** — the plan is their editing surface. Drift between the refined plan and
the code is caught at verification, which judges the code and nothing else. Accepted boundary:
at the guidance level a deliberate drop and an oversight both read as an absent control; the
deliberate-decision records live at the two driver gates.

**Who fills the verification fields.** The Testing verification pass
(`references/testing/verification-pass.md`) writes `## Threats` → **Robustness**, **Robustness
justification**, **Residual path** and **Evidence** from its negative testing of each selected
threat, and every `## Rule adherence` entry from its rule-adherence pass. Threats outside the
`selected` set stay `—`. Writing them, alongside setting `## Task` → `Latest stage: testing`,
is what marks the assessment checked; the plan review leaves them at `—` for Testing to fill.
**Nothing in this section is among them** — the vessel has no verdict to write.

### `## Rule adherence` — one `###` entry per **selected** org rule

The rule-driven half of verification, written by the Testing pass. Where `## Threats` →
**Robustness** answers *"did we close the problem we found?"*, this section answers *"were the
rules we accepted actually followed?"* — a different question about the same code, for a
different reader, and it may legitimately disagree with the robustness beside it.

Each entry is a `### <rule-id> — <title>` heading followed by one `Name: value` field per line.
The heading is keyed by **rule id**, not by a `T`/`M` tag:

```markdown
### 0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f — Documented function and data-level access rules
Adherence: followed
Justification: …
```

| Field | Constraint |
|-------|------------|
| **id** (in the heading) | the full org rule id, verbatim — the same id keying its `## Org rules` entry |
| **title** (in the heading) | the rule title, after the ` — `, copied from `## Org rules` |
| **Adherence** | `followed` \| `not-followed` (`—` until the Testing pass runs) |
| **Justification** | string, **≤ 256 characters** — why the rule reads as it does, naming the evidence it rests on |

**Scope is the rules the user *selected*, and nothing else.** One entry per `selected`
`## Org rules` entry — **including a rule no guidance ended up driving**, which is precisely
the case a security owner most needs: "not-followed — nothing implements it" is the answer,
and the old cited-set scope could not reach it. A rule the gate **excluded** was deemed
inapplicable: it gets **no entry**, because a verdict on it would convert an applicability
decision into a compliance claim about code nobody assessed against it.

**Two values, because scope makes them exhaustive.** Every rule in scope is applicable by
**deliberate decision** — the strongest form of "by construction" — so there is no "not
applicable" state to record as a verdict. Inapplicability is expressed at the gate, as scope.

**One verdict per rule, judged against the code.** The question is always *does the control
this rule prescribes exist in the code as built?* — not *what became of the guidance that
drives it?*. So a rule driving several entries still gets exactly one entry here, and the
verdict stays meaningful when guidance is merged or dropped.

**Dropped guidance does not decide it.** Guidance dropped during plan refinement is the usual
reason a rule ends up `not-followed`, and the justification names the absent control — but a
rule satisfied by other means still reads `followed`. The verdict tracks the code, never the
paperwork.

**Never derived from Robustness.** The two dimensions are independent: a rule can be followed
while a threat stays reachable (the rule governed input validation; the surviving route is an
authorisation gap), and violated while every threat is closed (they were closed by other
means). The only thing standing between the axes — implementation guidance — carries no
verdict at all, so there is no chain to derive through. Deriving one from the other produces
confident, wrong compliance answers.

**A partial set is a mid-run state, not a defect.** A completed Testing pass leaves exactly one
entry per selected rule; a pass still under way leaves fewer. The CLI reports the gap as
information and syncs what was concluded — completeness is this pass's procedure, asserted in
its checklist, not a validation rule.

### `## Maintenance (for the implementing agent)`
- Instruction to keep the file in sync as the implementation evolves.
- **How that agent locates this file.** It runs in a later session and has no minted path
  in context, so it must **re-run** the `assessment-mint` command from its
  `INGRAIN-ASSESSMENT-PATHS` session context and write to the `assessment_abs` it
  returns. Re-minting is deterministic in branch + title, so it resolves to this same
  file — and the mint is what resolves the path and ensures the folder, so `assessment_abs`
  arrives ready to write to. 

## Template

A finalized file — the three critique sections deleted, `## Org rules` pruned by Selection.
Its static text (the banner and the Maintenance footer) is seeded by
`scripts/lib/artifact-template.sh` and reproduced here verbatim; keeping the two in step is
manual, so **an edit to either is an edit to both**. The **field cards are elided below** for
length — a real file carries one under every heading, and `artifact-template.sh` is where they
are written.

```markdown
# Security assessment — <task title>

> Local working artifact produced by ingrain-security — keep in sync as the
> implementation evolves (see Maintenance below). Git-ignored.
>
> Skeleton seeded by `assessment-mint` — fill the sections below; do not
> re-create the page. Each is empty until the stage that owns it writes it. The comment
> under each heading is that section's field card — write from it.

## Task
Title: <task title>
Latest stage: testing
Description: <one-line summary of the change>
Schema version: 2

## Affected paths
- <repository-relative folder this change will touch>
- <…>

## Triage
Verdict: major
Security relevant: true
Surfaces:
- …
Prior analysis: none

## Threats

### T01 — <short title>
Asset: …
Vector: …
Description: …
Assumptions: …
Justification: …
Impact: high
Likelihood: medium
Risk score: 78
Criticality: high
Selection: selected
Robustness: adequate
Robustness justification: …
Residual path: —
Evidence: services/auth/router.ts:42

### T02 — <short title>
Asset: …
Vector: …
Description: …
Assumptions: …
Justification: …
Impact: low
Likelihood: low
Risk score: 40
Criticality: medium
Selection: excluded
Robustness: —
Robustness justification: —
Residual path: —
Evidence: —

## Risk score
Score: 78
Criticality: high

## Org rules

### 0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f — Documented function and data-level access rules
Selection: selected
Every function that reads or writes user-scoped data must document the access rule it
enforces, and enforce it at the boundary rather than in the caller.

### c611c934-151b-4fb9-8e7a-5b765e660837 — Function-level access control
Selection: selected
Each privileged operation checks the caller's entitlement at the point of use.

### 71a8c460-2f9b-4e13-85d7-c0e4a6b39f28 — Rate-limit sensitive endpoints
Selection: excluded

## Implementation guidance

### M01 — <short title>
Description: …
Yield: high
Effort: medium
Threats: T01
Rule refs: 0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f

### M02 — <short title>
Description: …
Yield: medium
Effort: low
Threats: —
Rule refs: c611c934-151b-4fb9-8e7a-5b765e660837

## Rule adherence

### 0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f — Documented function and data-level access rules
Adherence: followed
Justification: …

### c611c934-151b-4fb9-8e7a-5b765e660837 — Function-level access control
Adherence: not-followed
Justification: no entitlement check is applied at the point of use in the code as built

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis — a new
surface, a threat's acceptance changes, or a guidance entry is added, dropped, or
altered. Keep the Selection fields on both driver axes honest against the code you
write, and keep every enumerated field within the values its section's field card
names — the comment under each heading. The scoring pass already re-tagged the
threats into risk order, so ids are permanent from here: add a new threat with the
next free `T<n>` and keep the existing ones as they are.

To locate this file, re-run the `assessment-mint` command from your
INGRAIN-ASSESSMENT-PATHS session context and write to the absolute `assessment_abs`
it returns — it resolves back to this same file. Do not resolve a relative path
against the file you are editing, and do not create an `.ingrain-security/` folder.
```

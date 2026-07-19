# Assessment file reference

Defines the local analysis artifact the `ingrain-security` review persists and hands
off through. The orchestrator creates and finalizes it; each worker writes its own
named section. Follow this structure exactly so every stage reads and writes the same
shape.

## Nature

- **Path.** A single file written directly into `.ingrain-security/` at the project
  root — it is **both** the living working copy the workers write during the run **and**
  its persisted record, so finalizing it in place is the whole of persisting it. The
  orchestrator mints it: it runs the `scripts/assessment-path` script
  (`mint` subcommand) once at review start and reuses its **`assessment_abs`** — the
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
  **same file** (the run resumes/updates it in place; `file_exists: true` signals this),
  while a different task or branch gets its own file. This is also **how two concurrent
  tasks on one branch stay isolated** — distinct titles mint distinct files, so parallel
  reviews never clobber each other; the separation is structural — the filename enforces
  it. Any unresolvable segment is dropped
  (branch unknown → `assessment-<task-slug>.md`; no usable title →
  `assessment-<branch-slug>.md`; both absent → `assessment.md`), and the `assessment-`
  prefix always leads. The folder is **self-ignoring** (an inner `.gitignore` of a bare `*`,
  seeded by the `ensure-assessment-dir` hook and re-ensured by the script), so the whole
  folder — the ignore file included — stays out of `git status`; sharing a file is an
  explicit `git add -f <file>` opt-in.
- **Pre-approved.** An `allow-assessment-write` hook auto-approves writes to this file on
  both hosts — `PreToolUse` on Claude Code, `PermissionRequest` on Codex — so expect **no
  permission prompt** when writing it. The grant covers only `assessment*.md` directly
  inside `.ingrain-security/` — which is exactly `assessment_abs`, and one more reason to
  write there and nowhere else. Any other path you write still prompts the user and stalls
  the run. On Codex the approval is granted per **patch**: a patch that touches the
  assessment *and* any other file prompts as a whole, so keep assessment edits in their own
  patch.
- **Hand-off medium.** Workers write their sections and return to the orchestrator
  only a branch keyword plus a one-line pointer. The orchestrator owns the
  title/banner and the finalize; it moves data between workers by pointer and does
  not read the full running analysis into its own context. Section ownership:

  | Section | Written by |
  |---------|-----------|
  | `## Task` | orchestrator (framing) |
  | `## Triage` | `ingrain-relevance-triage` |
  | `## Threats` | `ingrain-threat-generator` (descriptive columns, working tags) → `ingrain-risk-scorer` (scoring columns, then re-tags the rows into risk order) → orchestrator (Selection at Gate 1) → the Testing verification pass (Robustness at the Testing phase) — **filled in stages** |
  | `## Threat critique` | `ingrain-threat-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Risk score` | `ingrain-risk-scorer` (plan-level residual) |
  | `## Mitigations` | `ingrain-mitigation-generator` → orchestrator (Selection at Gate 2) → the Testing verification pass (Justification + Verification level at the Testing phase) |
  | `## Mitigation critique` | `ingrain-mitigation-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Coverage / open items` | orchestrator (Development finalize) |
  | `## Maintenance` | orchestrator (finalize) |

  The org security rules themselves live in the **linked `rules-<branch-slug>-<task-slug>.md`
  sidecar** (see `references/formatting/rules-file.md`), written by the orchestrator's
  retrieval step and `ingrain-rule-expander` when rules are retrieved. This file carries
  the compact **Rule refs** ids (in `## Mitigations`) as the link into that sidecar.
- **Living document.** Rewrite the relevant section at each commit point so the file
  always mirrors the current frozen state — critic-loop revisions and re-selection
  overwrite the prior contents of that section. The two critique sections
  (`## Threat critique`, `## Mitigation critique`) are iteration scratch, and the
  orchestrator **deletes both at finalize** — so the finalized file holds end results alone,
  which is why the template below omits them. (The retrieved org rules are persistent: they
  live in the `rules-<…>.md` sidecar and survive finalize.)

## Sections and fields

Every field below is **required** unless marked optional, and every enumerated field
must use **exactly one** of the listed values (lower-case, verbatim).

### `## Task` 
- **Title** — string.
- **Latest stage** — `development` | `testing`. The lifecycle stage the file has reached,
  and the same two names the skill's phases carry: `development` while the plan review and
  the implementation are in progress; `testing` once the Testing verification pass has
  checked the adopted mitigations against the implementation.

### `## Triage` — the relevance-triage verdict
- **Verdict** — `minor` | `major`.
- **Security relevant** — `true` | `false`.
- **Surfaces** — bullet list (present when `major`).
- **Prior analysis** — optional; a pointer to a prior analysis file found for this
  task (its `.ingrain-security/…` path and threat count, e.g.
  `.ingrain-security/assessment-<…>.md — 4 threats`), or `none`. Set by
  `ingrain-relevance-triage` when it finds a threats-bearing prior analysis of the same
  task (branch + title); the generator seeds from it.

### `## Threats` — a Markdown table; most tasks warrant **3–6 rows** — treat it as a target; keep it short and scoped

One row per threat, with these columns:

| Column | Constraint |
|--------|------------|
| **Tag** | `T<n>` (e.g. `T1`) — contiguous from `T1`, no gaps, **ordered by descending risk score**: `T1` is the most critical threat |
| **Title** | string |
| **Asset** | string |
| **Vector** | string |
| **Description** | string |
| **Assumptions** | string |
| **Justification** | string, **≤ 256 characters** |
| **Impact** | `critical` \| `high` \| `medium` \| `low` |
| **Likelihood** | `very high` \| `high` \| `medium` \| `low` |
| **Risk score** | integer `0`–`100` |
| **Criticality** | `low` \| `medium` \| `high` \| `critical` |
| **Selection** | `selected` \| `excluded` \| `undecided` (optional until Gate 1) |
| **Robustness** | `weak` \| `adequate` \| `strong` — how well the adopted mitigations cover this threat in the implementation: `weak` = the threat can still be realized (a route survives, or the analysis leaves its closure unestablished); `adequate` = its realization routes are closed; `strong` = closed broadly **plus** artefacts that would fail if the control regressed. Concluded by the Testing pass from negative testing against the branch diff. Normative definitions: `references/testing/verification-pass.md` → **Maturity levels**. **Must not be set before that verification runs** — `—` until then, and for any row not `selected`. |

**Justification leads the scoring columns on purpose.** The scorer fills a row
left-to-right, so this table doubles as a reasoning schema: writing the justification
*before* the numerical (Risk score) and qualitative (Impact, Likelihood, Criticality)
scores lets the reasoning come first and drive the scores. 

**The tag is a priority position.** Rows are stored in tag order and risk
descends down them, so a reader follows the threats from `T1` — the most critical — down to
the least. The `ingrain-threat-generator` assigns tags in discovery order; the
`ingrain-risk-scorer` establishes this invariant at freeze, sorting the scored
threats by risk and reassigning every tag (see `references/development/ingrain-risk-scorer.md` →
**Order the tags**).
Ordering is guaranteed in the finalized file; mid-loop, tags are the generator's working
labels and may have gaps. A re-review re-scores the task and so may re-tag it: a tag is
meaningful within the file it lives in.

**Gate 1 → Selection.** When the user decides at Gate 1, record each threat's
**Selection**: include → `selected`, exclude → `excluded`. Use
`undecided` only if the user is explicitly unsure. Before Gate 1 the column is empty.

### `## Risk score` — plan-level residual risk
- **Score** — integer `0`–`100`.
- **Criticality** — `low` | `medium` | `high` | `critical`.

### `## Mitigations` — a Markdown table, one row per mitigation, with these columns:

A mitigation is either a **threat mitigation** (carries ≥1 threat tag) or a **general
implementation instruction** for the full scoped task (no threat tag). Both belong in
this table.

| Column | Constraint |
|--------|------------|
| **Tag** | `M<n>` (e.g. `M1`) — contiguous from `M1`, no gaps, **ordered by descending priority**. Assigned by the `ingrain-mitigation-generator`, which re-derives them on every write (see `references/development/ingrain-mitigation-generator.md` → **Order the tags**). |
| **Title** | string |
| **Description** | string |
| **Yield** | `high` \| `medium` \| `low` |
| **Effort** | `high` \| `medium` \| `low` |
| **Threat tags** | `0..N` threat tags (e.g. `T1, T3`); `—` when the mitigation is a general implementation instruction not tied to a specific threat |
| **Rule refs** | the org rule id(s) the mitigation follows, `0..N` comma-separated (e.g. `r-auth-01, r-log-03`); `—` when it follows no org rule (a pure threat mitigation). One mitigation may follow multiple rules. Ids are machine-facing — stored here, **never rendered to the user** (Gate 2 shows rule titles instead). Each id is the link into the persistent `rules-<…>.md` sidecar, where the rule's title and full body live (see `references/formatting/rules-file.md`). |
| **Selection** | `selected` \| `excluded` \| `undecided` (optional until Gate 2) |
| **Justification** | string, **≤ 256 characters** — the reasoning behind the **Verification level**, concluded by the Testing orchestrator from the verifier's read. **Must not be set before that verification runs** — `—` until then, and for any row not `selected`. |
| **Verification level** | `weak` \| `adequate` \| `strong` — this mitigation's contribution to closing the threats it covers, **derived from their `Robustness`**: covering one threat, it takes that threat's level; covering several that differ, **the weakest governs**. A general implementation instruction (no threat tag) takes its level from whether the instruction was followed. Same ladder as `Robustness`; normative definitions: `references/testing/verification-pass.md` → **Maturity levels**. **Must not be set before that verification runs** — `—` until then, and for any row not `selected`. |

**Follows org rules is derived from Rule refs.** A mitigation with ≥1 **Rule ref**
follows org rules; an empty **Rule refs** (`—`) means a pure threat mitigation. Surface
this as a computed indicator (e.g. at Gate 2), keeping it out of the stored table: the
indicator is the rule **title(s)**, resolved at display time by looking each **Rule ref**
id up in the `rules-<…>.md` sidecar (its `## Retrieved rules` entries /
`## Per-mitigation mapping`). The sidecar owns the titles; this table owns the ids.

**Gate 2 → Selection.** Record each mitigation's **Selection**:
adopt → `selected`, decline → `excluded`; `undecided` only if the user is unsure.

**Justification leads the Verification level on purpose** — the same reasoning schema
`## Threats` uses for its scores (above): filling the row left-to-right forces the reasoning to
come first and drive the level. The 256-character cap on both justifications is part of that
forcing — it keeps the justification to the reasoning that produced the level.

**Who fills the verification columns.** The Testing verification pass
(`references/testing/verification-pass.md`) writes all three: `## Threats` → **Robustness** from its
negative testing of each selected threat, then `## Mitigations` → **Justification** and
**Verification level**, the latter derived from the threats each mitigation covers. Rows that
are not `selected` stay `—`. Writing them, alongside setting `## Task` →
`Latest stage: testing`, is what marks the assessment checked; the plan review leaves them
at `—` for Testing to fill.

**The threat column is the primary result.** `Robustness` records what was actually tested —
whether the threat survives the change. `Verification level` is derived bookkeeping on top of
it, so a mitigation's level always tracks the threats it covers.

### `## Coverage / open items`
- Any threat whose **Selection** is `selected` that has no mitigation with
  **Selection** `selected` covering it (via its **Threat tags**). Only **threat
  mitigations** (those carrying threat tags) count toward covering a threat; general
  implementation instructions apply to the scoped task as a whole.
- This is a **structural** join computed at the Development finalize: it records that a
  mitigation was adopted for the threat. Efficacy lives in `## Threats` → **Robustness**,
  written later by Testing. A threat can be "covered" here and `weak` there. This section is
  written once, at the Development finalize.

### `## Maintenance (for the implementing agent)`
- Instruction to keep the file in sync as the implementation evolves.
- **How that agent locates this file.** It runs in a later session and has no minted path
  in context, so it must **re-run** the `assessment-path` mint command from its
  `INGRAIN-ASSESSMENT-PATHS` session context and write to the `assessment_abs` it
  returns. Re-minting is deterministic in branch + title, so it resolves to this same
  file. It must never resolve a relative `.ingrain-security/…` string against the file it
  is editing, and must never create the folder. 

## Template

```markdown
# Security assessment — <task title>

> Local working artifact produced by ingrain-security — keep in sync as the
> implementation evolves (see Maintenance below). Git-ignored.

## Task
Title: <task title>
Latest stage: <development|testing>

## Triage
Verdict: <minor|major>
Security relevant: <true|false>
Surfaces:
- …
Prior analysis: <.ingrain-security/assessment-<…>.md — N threats | none>

## Threats
| Tag | Title | Asset | Vector | Description | Assumptions | Justification | Impact | Likelihood | Risk score | Criticality | Selection | Robustness |
|-----|-------|-------|--------|-------------|-------------|---------------|--------|------------|------------|-------------|------------|------------|
| T1  | …     | …     | …      | …           | …           | …             | high   | medium     | 78         | high        | selected   | adequate   |
| T2  | …     | …     | …      | …           | …           | …             | low    | low        | 40         | medium      | excluded   | —          |

## Risk score
Score: <0–100>
Criticality: <low|medium|high|critical>

## Mitigations
| Tag | Title | Description | Yield | Effort | Threat tags | Rule refs | Selection | Justification | Verification level |
|-----|-------|-------------|-------|--------|-------------|-----------|-----------|---------------|--------------------|
| M1  | …     | …           | high  | medium | T1          | r-auth-01 | selected  | …             | adequate           |
| M2  | …     | …           | medium| low    | —           | r-log-03  | selected  | …             | strong             |
| M3  | …     | …           | low   | low    | T2          | —         | excluded  | —             | —                  |

## Coverage / open items
- <any selected threat with no selected mitigation covering it>

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis — a new
surface, a threat's acceptance changes, or a mitigation is added, dropped, or
altered. Keep the Selection columns and coverage honest against the code you write,
and keep every enumerated field within its allowed values.

To locate this file, re-run the `assessment-path` mint command from your
INGRAIN-ASSESSMENT-PATHS session context and write to the absolute `assessment_abs`
it returns — it resolves back to this same file. Do not resolve a relative path
against the file you are editing, and do not create an `.ingrain-security/` folder.

Org rules for this task (if any were retrieved) live in the linked sidecar
.ingrain-security/rules-<branch-slug>-<task-slug>.md — re-mint it with the `rules-path`
command; it is persistent and maintained there.
```

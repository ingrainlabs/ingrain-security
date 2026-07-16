# Assessment file reference

Defines the local analysis artifact the `ingrain-security` review persists and hands
off through. The orchestrator creates and finalizes it; each worker writes its own
named section. Follow this structure exactly so every stage reads and writes the same
shape.

## Nature

- **Path.** A single file written directly into `.ingrain-security/` at the project
  root — it is **both** the living working copy the workers write during the run **and**
  its persisted record, so there is no separate temp file and no finalize copy. The
  orchestrator does not hand-build it: it runs the `scripts/assessment-path` script
  (`mint` subcommand) once at review start and reuses its **`assessment_abs`** — the
  absolute path — as the write target throughout; the relative `assessment_path` is a
  display form for prose and links only. **Every write goes to the absolute path.**
  See SKILL.md → **The assessment file**. The name is deterministic in the branch + task:
  `<project_root>/.ingrain-security/assessment-<branch-slug>-<task-slug>.md`. The script
  resolves `<project_root>` from the git repo root — so it may be run from any
  subdirectory — resolves
  `<branch-slug>` from the current git branch (`git branch --show-current`, not
  `.git/HEAD`, unreliable in a worktree/submodule), lowercased and reduced to `[a-z0-9-]`,
  and derives `<task-slug>` from the `## Task` Title by the same rule. Because the name
  *is* the task identity, re-reviewing the **same task on the same branch** resolves to the
  **same file** (the run resumes/updates it in place; `file_exists: true` signals this),
  while a different task or branch gets its own file. This is also **how two concurrent
  tasks on one branch stay isolated** — distinct titles mint distinct files, so parallel
  reviews never clobber each other; the separation is structural, not a worker's judgement
  call. Any unresolvable segment is dropped
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
  the run. On Codex the approval is per **patch**, not per file: a patch that touches the
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
  | `## Threats` | `ingrain-threat-generator` (descriptive columns, working tags) → `ingrain-risk-scorer` (scoring columns, then re-tags the rows into risk order) → orchestrator (Selection at Gate 1) — **filled in stages** |
  | `## Threat critique` | `ingrain-threat-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Risk score` | `ingrain-risk-scorer` (plan-level residual) |
  | `## Mitigations` | `ingrain-mitigation-generator` → orchestrator (Selection at Gate 2) → the Phase B verification pass (Verified at the review stage) |
  | `## Mitigation critique` | `ingrain-mitigation-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Coverage / open items`, `## Maintenance` | orchestrator (finalize) |

  The org security rules themselves do **not** live in this file — they are persisted to the
  **linked `rules-<branch-slug>-<task-slug>.md` sidecar** (see `references/rules-file.md`),
  written by the `ingrain-mitigation-generator` when rules are retrieved. This file carries
  only the compact **Rule refs** ids (in `## Mitigations`) as the link into that sidecar.
- **Living document.** Rewrite the relevant section at each commit point so the file
  always mirrors the current frozen state — critic-loop revisions and re-selection
  overwrite the prior contents of that section. The two critique sections
  (`## Threat critique`, `## Mitigation critique`) are iteration scratch, not results, and the
  orchestrator **deletes both at finalize** — so the finalized file contains only end results.
  This is why the template below has neither. (The retrieved org rules are **not** scratch in
  this file at all — they live in the persistent `rules-<…>.md` sidecar, which is never
  deleted.)

## Sections and fields

Every field below is **required** unless marked optional, and every enumerated field
must use **exactly one** of the listed values (lower-case, verbatim).

### `## Task` 
- **Title** — string.
- **Latest stage** — `planning` | `development` | `review`. The lifecycle stage the file has
  reached: `planning`/`development` while the Phase A review and implementation are
  in progress; `review` once the Phase B verification pass has checked the adopted
  mitigations against the implementation.

### `## Triage` — the relevance-triage verdict
- **Verdict** — `minor` | `major`.
- **Security relevant** — `true` | `false`.
- **Surfaces** — bullet list (present when `major`).
- **Prior analysis** — optional; a pointer to a prior analysis file found for this
  task (its `.ingrain-security/…` path and threat count, e.g.
  `.ingrain-security/assessment-<…>.md — 4 threats`), or `none`. Set by
  `ingrain-relevance-triage` when it finds a threats-bearing prior analysis of the same
  task (branch + title); the generator seeds from it.

### `## Threats` — a Markdown table; most tasks warrant **3–6 rows** — a target, not a hard limit; keep it short and scoped

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

**Justification leads the scoring columns on purpose.** The scorer fills a row
left-to-right, so this table doubles as a reasoning schema: writing the justification
*before* the numerical (Risk score) and qualitative (Impact, Likelihood, Criticality)
scores forces the reasoning to come first and drive the scores, rather than
rationalizing numbers already chosen. 

**The tag is a priority position, not an identity.** Rows are stored in tag order and risk
descends down them, so a reader follows the threats from `T1` — the most critical — down to
the least. The `ingrain-threat-generator` assigns tags in discovery order, which carries no
priority; the `ingrain-risk-scorer` establishes this invariant at freeze, sorting the scored
threats by risk and reassigning every tag (see `ingrain-risk-scorer.md` → **Order the tags**).
Only the finalized file is guaranteed ordered — mid-loop, tags are the generator's working
labels and may have gaps. A re-review re-scores the task and so may re-tag it: a tag means
something only relative to the file it lives in.

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
| **Tag** | `M<n>` (e.g. `M1`) — contiguous from `M1`, no gaps, **ordered by descending priority**: threat mitigations first, ranked by the lowest-numbered (highest-risk) threat tag they cover, then by Yield then Effort; general implementation instructions last. Assigned by the `ingrain-mitigation-generator`, which re-derives them on every write. |
| **Title** | string |
| **Description** | string |
| **Yield** | `high` \| `medium` \| `low` |
| **Effort** | `high` \| `medium` \| `low` |
| **Threat tags** | `0..N` threat tags (e.g. `T1, T3`); `—` when the mitigation is a general implementation instruction not tied to a specific threat |
| **Rule refs** | the org rule id(s) the mitigation follows, `0..N` comma-separated (e.g. `r-auth-01, r-log-03`); `—` when it follows no org rule (a pure threat mitigation). One mitigation may follow multiple rules. Ids are machine-facing — stored here, **never rendered to the user** (Gate 2 shows rule titles instead). Each id is the link into the persistent `rules-<…>.md` sidecar, where the rule's title and full body live (see `references/rules-file.md`). |
| **Selection** | `selected` \| `excluded` \| `undecided` (optional until Gate 2) |
| **Verified** | `verified` \| `insufficient` \| `missing` — the Phase B verification result for a `selected` mitigation. **Optional until that verification runs**; `—` before then and for any row not `selected`. |

**Follows org rules is derived, not stored twice.** A mitigation with ≥1 **Rule ref**
follows org rules; an empty **Rule refs** (`—`) means a pure threat mitigation. Surface
this as a computed indicator (e.g. at Gate 2) rather than a separate column: the
indicator is the rule **title(s)**, resolved by looking each **Rule ref** id up in the
`rules-<…>.md` sidecar (its `## Retrieved rules` entries / `## Per-mitigation mapping`).
Titles are not stored in this table — no title column is added.

**Gate 2 → Selection.** Record each mitigation's **Selection**:
adopt → `selected`, decline → `excluded`; `undecided` only if the user is unsure.

**Verification → Verified.** After implementation, the `ingrain-security` **Phase B**
verification pass (`references/verification-pass.md`) checks each `selected` mitigation
against the working-tree diff and records the outcome in **Verified**: `verified`
(implemented as described), `insufficient` (partial/weak), or `missing` (absent). Rows that
are not `selected` stay `—`. Writing this column is what "marks the assessment checked",
alongside setting `## Task` → `Latest stage: review`. The Phase A planning review leaves the
column empty/`—`; it is filled only at the review stage.

The retrieved org rules (ids, titles, full bodies, and the per-mitigation mapping) live in
the **linked `rules-<branch-slug>-<task-slug>.md` sidecar**, not in this file — see
`references/rules-file.md` for its schema. This file references them only by the compact
**Rule refs** ids in `## Mitigations`.

### `## Coverage / open items`
- Any threat whose **Selection** is `selected` that has no mitigation with
  **Selection** `selected` covering it (via its **Threat tags**). Only **threat
  mitigations** (those carrying threat tags) count toward covering a threat — general
  implementation instructions are not expected to cover a specific threat.

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
> implementation evolves (see Maintenance below). Not committed.

## Task
Title: <task title>
Latest stage: <planning|development|review>

## Triage
Verdict: <minor|major>
Security relevant: <true|false>
Surfaces:
- …
Prior analysis: <.ingrain-security/assessment-<…>.md — N threats | none>

## Threats
| Tag | Title | Asset | Vector | Description | Assumptions | Justification | Impact | Likelihood | Risk score | Criticality | Selection |
|-----|-------|-------|--------|-------------|-------------|---------------|--------|------------|------------|-------------|------------|
| T1  | …     | …     | …      | …           | …           | …             | high   | medium     | 78         | high        | selected   |
| T2  | …     | …     | …      | …           | …           | …             | low    | low        | 40         | medium      | excluded   |

## Risk score
Score: <0–100>
Criticality: <low|medium|high|critical>

## Mitigations
| Tag | Title | Description | Yield | Effort | Threat tags | Rule refs | Selection | Verified |
|-----|-------|-------------|-------|--------|-------------|-----------|-----------|----------|
| M1  | …     | …           | high  | medium | T1          | r-auth-01 | selected  | verified |
| M2  | …     | …           | medium| low    | —           | r-log-03  | selected  | —        |

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
command; it is persistent, not maintained here.
```

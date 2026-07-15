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
  | `## Mitigations` | `ingrain-mitigation-generator` → orchestrator (Selection at Gate 2) → `ingrain-security-test` orchestrator (Verified at the review stage) |
  | `## Org rules` | `ingrain-mitigation-generator` — **transient**, deleted by the orchestrator at finalize |
  | `## Mitigation critique` | `ingrain-mitigation-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Coverage / open items`, `## Maintenance` | orchestrator (finalize) |
- **Living document.** Rewrite the relevant section at each commit point so the file
  always mirrors the current frozen state — critic-loop revisions and re-selection
  overwrite the prior contents of that section. The two critique sections and the
  `## Org rules` section are iteration scratch, not results: they exist only to feed the
  mitigation loop (the critic and revision rounds read the org rules by pointer), so once
  that loop is done they are dead weight. The orchestrator **deletes all three transient
  sections at finalize** — `## Threat critique`, `## Mitigation critique`, and
  `## Org rules` — so the finalized file contains only end results. This is why the
  template below has none of them.

## Sections and fields

Every field below is **required** unless marked optional, and every enumerated field
must use **exactly one** of the listed values (lower-case, verbatim).

### `## Task` 
- **Title** — string.
- **Latest stage** — `planning` | `development` | `review`. The lifecycle stage the file has
  reached: `planning`/`development` while the `ingrain-security` review and implementation are
  in progress; `review` once the `ingrain-security-test` verification has checked the adopted
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
| **Rule refs** | the org rule id(s) the mitigation follows, `0..N` comma-separated (e.g. `r-auth-01, r-log-03`); `—` when it follows no org rule (a pure threat mitigation). One mitigation may follow multiple rules. Ids are machine-facing — stored here, **never rendered to the user** (Gate 2 shows rule titles instead). Full rule detail lives in the transient `## Org rules` section. |
| **Selection** | `selected` \| `excluded` \| `undecided` (optional until Gate 2) |
| **Verified** | `verified` \| `insufficient` \| `missing` — the `ingrain-security-test` verification result for a `selected` mitigation. **Optional until that verification runs**; `—` before then and for any row not `selected`. |

**Follows org rules is derived, not stored twice.** A mitigation with ≥1 **Rule ref**
follows org rules; an empty **Rule refs** (`—`) means a pure threat mitigation. Surface
this as a computed indicator (e.g. at Gate 2) rather than a separate column: the
indicator is the rule **title(s)**, resolved by looking each **Rule ref** id up in the
per-mitigation citations of the transient `## Org rules` section. Titles are not stored
in this table — no title column is added.

**Gate 2 → Selection.** Record each mitigation's **Selection**:
adopt → `selected`, decline → `excluded`; `undecided` only if the user is unsure.

**Verification → Verified.** After implementation, the `ingrain-security-test` skill checks
each `selected` mitigation against the working-tree diff and records the outcome in
**Verified**: `verified` (implemented as described), `insufficient` (partial/weak), or
`missing` (absent). Rows that are not `selected` stay `—`. Writing this column is what
"marks the assessment checked", alongside setting `## Task` → `Latest stage: review`. The
`ingrain-security` planning review leaves the column empty/`—`; it is filled only at the
review stage.

### `## Org rules` — transient, deleted at finalize

The org security rules the `ingrain-mitigation-generator` retrieved, kept here so the
`ingrain-mitigation-critic` and revision rounds can read them by pointer. The section
itself is **never** shown to the user; the orchestrator reads its per-mitigation
citations at Gate 2 to resolve each **Rule ref** id to a rule title for display, and
nothing else here (bodies, applicable rules) leaves the file. The orchestrator **deletes
the section at finalize** — so it is absent from the finalized template below. Content:

- **Rules retrieved** — a one-line summary: the queries run and how many rules each
  returned, or the graceful-degradation note if retrieval was skipped (e.g. `no org rules
  retrieved — CLI not configured`).
- **Per-mitigation citations** — one line per mitigation, keyed by its tag:
  `M<n> → "<title>" (<id>)` with a one-line note on how the rule shaped it; `none` where
  no retrieved rule applies to that mitigation.
- **Applicable rules** — retrieved rules relevant to the change that do not map cleanly
  onto a single mitigation, each as `"<title>" (<id>)`.

Cite only rules actually retrieved — never invent a rule or an `id`.

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
```

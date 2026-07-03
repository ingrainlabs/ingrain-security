# Assessment file reference

Defines the local analysis artifact the `ingrain-security` review persists and hands
off through. The orchestrator creates and finalizes it; each worker writes its own
named section. Follow this structure exactly so every stage reads and writes the same
shape.

## Nature

- **Path (per run):** a uniquely-named file under `.claude/.temp/`, relative to the
  working project root, so two reviews running at once never share (and clobber) one
  file. The orchestrator mints the path once at the start of the review and uses it
  throughout (see SKILL.md → **The assessment file**): in plan mode
  `.claude/.temp/assessment-<plan-basename>.md` (mirroring the active
  `.claude/plans/<plan-basename>.md`); ad-hoc
  `.claude/.temp/assessment-<YYYYMMDD-HHMMSS>-<rand>.md`. Both keep the `assessment-`
  prefix. It is a **local working artifact** in Claude's own folder (`.claude/`), not
  committed. `.claude/` is git-ignored by convention; keep the file uncommitted.
- **Committed snapshot(s).** At finalize (SKILL.md Step 7, and the Gate 1
  none-selected close) the orchestrator invokes the vetted, argument-less helper
  `hooks/run-hook.cmd save-assessment`, which copies the current review's working
  file — **the most-recently-modified `.claude/.temp/assessment*.md`, found by globbing
  (no path argument)** — into
  `ingrain-securityAssessment/assessment-<task-slug>-<timestamp>.md` at the project
  root. The helper — not the orchestrator — owns the copy: it reads the task
  `Title` from that file (never off the command line), normalizes and allowlist-
  validates the slug, and **refuses a symlinked source or target** so a planted link
  can't be read or written through. The folder is created by the
  `ensure-assessment-dir` SessionStart hook. Snapshots are **additive** — each run
  writes a new timestamped file, never overwriting an earlier one. The folder is
  **self-ignoring** (an inner `.gitignore` of `*` + `!.gitignore`), so snapshots do
  not appear in `git status`; sharing one is an explicit `git add -f <file>` opt-in.
  Relationship: the per-run `.claude/.temp/assessment-<run>.md` is the **living,
  uncommitted** working copy that workers write and the Maintenance instruction tracks;
  the folder holds the **frozen** snapshots of it over time.
- **Hand-off medium.** Workers write their sections and return to the orchestrator
  only a branch keyword plus a one-line pointer. The orchestrator owns the
  title/banner and the finalize; it moves data between workers by pointer and does
  not read the full running analysis into its own context. Section ownership:

  | Section | Written by |
  |---------|-----------|
  | `## Task` | orchestrator (framing) |
  | `## Triage` | `ingrain-relevance-triage` |
  | `## Threats` | `ingrain-threat-generator` (descriptive columns) → `ingrain-risk-scorer` (scoring columns) → orchestrator (Acceptance at Gate 1) — **filled in stages** |
  | `## Threat critique` | `ingrain-threat-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Risk score` | `ingrain-risk-scorer` (plan-level residual) |
  | `## Mitigations` | `ingrain-mitigation-generator` → orchestrator (Acceptance at Gate 2) |
  | `## Mitigation critique` | `ingrain-mitigation-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Coverage / open items`, `## Maintenance` | orchestrator (finalize) |
- **Living document.** Rewrite the relevant section at each commit point so the file
  always mirrors the current frozen state — critic-loop revisions and re-selection
  overwrite the prior contents of that section. The critique sections are iteration
  scratch, not results: once their loop is done they are dead weight, and the
  orchestrator **deletes both critique sections at finalize** — the finalized file and
  every durable snapshot contain only end results. This is why the template below has
  no critique sections.

## Sections and fields

Every field below is **required** unless marked optional, and every enumerated field
must use **exactly one** of the listed values (lower-case, verbatim).

### `## Task` 
- **Title** — string.
- **Latest stage** — one of `planning` | `development` | `review`.

### `## Triage` — the relevance-triage verdict
- **Verdict** — `minor` | `major`.
- **Security relevant** — `true` | `false`.
- **Surfaces** — bullet list (present when `major`).

### `## Threats` — a Markdown table; most tasks warrant **3–6 rows**, **never exceed 8**

One row per threat, with these columns:

| Column | Constraint |
|--------|------------|
| **Tag** | `T<n>` (e.g. `T1`) |
| **Title** | string |
| **Asset** | string |
| **Vector** | string |
| **Description** | string |
| **Assumptions** | string |
| **Impact** | `critical` \| `high` \| `medium` \| `low` |
| **Likelihood** | `very high` \| `high` \| `medium` \| `low` |
| **Risk score** | integer `0`–`100` |
| **Criticality** | `low` \| `medium` \| `high` \| `critical` |
| **Justification** | string, **≤ 256 characters** |
| **Acceptance** | `accepted` \| `rejected` \| `uncertain` (optional until Gate 1) |

**Gate 1 → Acceptance.** When the user decides at Gate 1, record each threat's
**Acceptance**: include → `accepted`, exclude → `rejected`. Use
`uncertain` only if the user is explicitly unsure. Before Gate 1 the column is empty.

### `## Risk score` — plan-level residual risk
- **Score** — integer `0`–`100`.
- **Criticality** — `low` | `medium` | `high` | `critical`.

### `## Mitigations` — a Markdown table, one row per mitigation, with these columns:

| Column | Constraint |
|--------|------------|
| **Tag** | `M<n>` (e.g. `M1`) |
| **Title** | string |
| **Description** | string |
| **Yield** | `high` \| `medium` \| `low` |
| **Effort** | `high` \| `medium` \| `low` |
| **Threat tags** | **≥ 1** threat tag (e.g. `T1, T3`) |
| **Acceptance** | `accepted` \| `rejected` \| `uncertain` (optional until Gate 2) |

**Gate 2 → Acceptance.** Record each mitigation's **Acceptance**:
adopt → `accepted`, decline → `rejected`; `uncertain` only if the user is unsure.

### `## Coverage / open items`
- Any threat whose **Acceptance** is `accepted` that has no mitigation with
  **Acceptance** `accepted` covering it (via its **Threat tags**).

### `## Maintenance (for the implementing agent)`
- Instruction to keep the file in sync as the implementation evolves.

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

## Threats
| Tag | Title | Asset | Vector | Description | Assumptions | Impact | Likelihood | Risk score | Criticality | Justification | Acceptance |
|-----|-------|-------|--------|-------------|-------------|--------|------------|------------|-------------|---------------|------------|
| T1  | …     | …     | …      | …           | …           | high   | medium     | 78         | high        | …             | accepted   |
| T2  | …     | …     | …      | …           | …           | low    | low        | 40         | medium      | …             | rejected   |

## Risk score
Score: <0–100>
Criticality: <low|medium|high|critical>

## Mitigations
| Tag | Title | Description | Yield | Effort | Threat tags | Acceptance |
|-----|-------|-------------|-------|--------|-------------|------------|
| M1  | …     | …           | high  | medium | T1          | accepted   |

## Coverage / open items
- <any accepted threat with no accepted mitigation covering it>

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis — a new
surface, a threat's acceptance changes, or a mitigation is added, dropped, or
altered. Keep the Acceptance columns and coverage honest against the code you write,
and keep every enumerated field within its allowed values.
```

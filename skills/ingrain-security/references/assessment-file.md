# Assessment file reference

Defines the local analysis artifact the `ingrain-security` review persists and hands
off through. The orchestrator creates and finalizes it; each worker writes its own
named section. Follow this structure exactly so every stage reads and writes the same
shape.

## Nature

- **Path (per run):** a uniquely-named file under `.${coding_agent_root}/.temp/`,
  relative to the working project root, so two reviews running at once never share
  (and clobber) one file. `${coding_agent_root}` is the host's config dotfolder base
  name — `claude` under Claude Code, `codex` under Codex (substitute it for your host);
  see SKILL.md → **The assessment file**. The
  orchestrator mints the path once at the start of the review and uses it throughout:
  in plan mode `.${coding_agent_root}/.temp/assessment-<plan-basename>.md` (mirroring
  the active `.${coding_agent_root}/plans/<plan-basename>.md`); ad-hoc
  `.${coding_agent_root}/.temp/assessment-<YYYYMMDD-HHMMSS>-<rand>.md`. Both keep the
  `assessment-` prefix. It is a **local working artifact** in the host's own config
  folder (`.${coding_agent_root}/`), not committed — that folder is git-ignored by
  convention; keep the file uncommitted.
- **Committed snapshot(s).** At finalize (SKILL.md Step 7, and the Gate 1
  none-selected close) the orchestrator copies the finalized working file itself, using
  its file tools (no shell, so it works on every platform), into
  `ingrain-security/assessment-<branch-slug>-<task-slug>-<timestamp>.md` at the
  project root. `<branch-slug>` is the current git branch — resolved once at review start
  via `git branch --show-current` (not `.git/HEAD`, unreliable in a worktree/submodule),
  then lowercased and reduced to `[a-z0-9-]`; it keys every snapshot for a feature branch
  together and lets triage find a prior analysis of the same task (see
  `ingrain-relevance-triage`). It derives `<task-slug>` from the `## Task` Title —
  lowercased and reduced to `[a-z0-9-]`. Any unresolvable segment is dropped (branch
  unknown → `assessment-<task-slug>-<timestamp>.md`; no usable title →
  `assessment-<branch-slug>-<timestamp>.md`; both absent → `assessment-<timestamp>.md`),
  and the `assessment-` prefix always leads. The
  folder and its self-ignoring `.gitignore` are seeded by the
  `ensure-assessment-dir` SessionStart hook. Snapshots are **additive** — each run
  writes a new timestamped file, never overwriting an earlier one. The folder is
  **self-ignoring** (an inner `.gitignore` of `*` + `!.gitignore`), so snapshots do
  not appear in `git status`; sharing one is an explicit `git add -f <file>` opt-in.
  Relationship: the per-run `.${coding_agent_root}/.temp/assessment-<run>.md` is the **living,
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
  | `## Threats` | `ingrain-threat-generator` (descriptive columns) → `ingrain-risk-scorer` (scoring columns) → orchestrator (Selection at Gate 1) — **filled in stages** |
  | `## Threat critique` | `ingrain-threat-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Risk score` | `ingrain-risk-scorer` (plan-level residual) |
  | `## Mitigations` | `ingrain-mitigation-generator` → orchestrator (Selection at Gate 2) |
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

### `## Triage` — the relevance-triage verdict
- **Verdict** — `minor` | `major`.
- **Security relevant** — `true` | `false`.
- **Surfaces** — bullet list (present when `major`).
- **Prior analysis** — optional; a pointer to a prior durable snapshot found for this
  task (its `ingrain-security/…` path and threat count, e.g.
  `ingrain-security/assessment-<…>.md — 4 threats`), or `none`. Set by
  `ingrain-relevance-triage` when it finds a threats-bearing prior analysis of the same
  task (branch + title); the generator seeds from it.

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
rationalizing numbers already chosen. This intentionally diverges from the field order
of `@ingrain`'s `PThreatSchema` (which trails justification last); the divergence is
deliberate and scoped to this skill.

**Gate 1 → Selection.** When the user decides at Gate 1, record each threat's
**Selection**: include → `selected`, exclude → `excluded`. Use
`undecided` only if the user is explicitly unsure. Before Gate 1 the column is empty.

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
| **Selection** | `selected` \| `excluded` \| `undecided` (optional until Gate 2) |

**Gate 2 → Selection.** Record each mitigation's **Selection**:
adopt → `selected`, decline → `excluded`; `undecided` only if the user is unsure.

### `## Coverage / open items`
- Any threat whose **Selection** is `selected` that has no mitigation with
  **Selection** `selected` covering it (via its **Threat tags**).

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
Prior analysis: <ingrain-security/assessment-<…>.md — N threats | none>

## Threats
| Tag | Title | Asset | Vector | Description | Assumptions | Justification | Impact | Likelihood | Risk score | Criticality | Selection |
|-----|-------|-------|--------|-------------|-------------|---------------|--------|------------|------------|-------------|------------|
| T1  | …     | …     | …      | …           | …           | …             | high   | medium     | 78         | high        | selected   |
| T2  | …     | …     | …      | …           | …           | …             | low    | low        | 40         | medium      | excluded   |

## Risk score
Score: <0–100>
Criticality: <low|medium|high|critical>

## Mitigations
| Tag | Title | Description | Yield | Effort | Threat tags | Selection |
|-----|-------|-------------|-------|--------|-------------|------------|
| M1  | …     | …           | high  | medium | T1          | selected   |

## Coverage / open items
- <any selected threat with no selected mitigation covering it>

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis — a new
surface, a threat's acceptance changes, or a mitigation is added, dropped, or
altered. Keep the Selection columns and coverage honest against the code you write,
and keep every enumerated field within its allowed values.
```

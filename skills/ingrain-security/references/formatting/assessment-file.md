# Assessment file reference

Defines the local analysis artifact the `ingrain-security` review persists and hands
off through. The orchestrator creates and finalizes it; each worker writes its own
named section. Follow this structure exactly so every stage reads and writes the same
shape.

## Nature

- **Path.** A single file written directly into `ingrain-security/` at the project
  root — it is **both** the living working copy the workers write during the run **and**
  its persisted record, so there is no separate temp file and no finalize copy. The
  orchestrator does not hand-build it: it runs the `scripts/assessment-path` script
  (`mint` subcommand) once at review start and reuses its `assessment_path` throughout —
  see SKILL.md → **The assessment file**. The name is deterministic in the branch + task:
  `ingrain-security/assessment-<branch-slug>-<task-slug>.md`. The script resolves
  `<branch-slug>` from the current git branch (`git branch --show-current`, not
  `.git/HEAD`, unreliable in a worktree/submodule), lowercased and reduced to `[a-z0-9-]`,
  and derives `<task-slug>` from the `## Task` Title by the same rule. Because the name
  *is* the task identity, re-reviewing the **same task on the same branch** resolves to the
  **same file** (the run resumes/updates it in place; `file_exists: true` signals this),
  while a different task or branch gets its own file. This is also **how two concurrent
  tasks on one branch stay isolated** — distinct titles mint distinct files, so parallel
  reviews each keep to their own file; the separation is structural — the filename enforces
  it. Any unresolvable segment is dropped
  (branch unknown → `assessment-<task-slug>.md`; no usable title →
  `assessment-<branch-slug>.md`; both absent → `assessment.md`), and the `assessment-`
  prefix always leads. The folder is **self-ignoring** (an inner `.gitignore` of `*` +
  `!.gitignore`, seeded by the `ensure-assessment-dir` hook and re-ensured by the script),
  so the file does not appear in `git status`; sharing it is an explicit
  `git add -f <file>` opt-in.
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
  | `## Coverage / open items` | orchestrator (Development finalize) |
  | `## Maintenance` | orchestrator (finalize) |

  The org security rules themselves live in the **linked `rules-<branch-slug>-<task-slug>.md`
  sidecar** (see `references/formatting/rules-file.md`), written by the orchestrator's
  retrieval step when rules are retrieved. This file carries
  the compact **Rule refs** ids (in `## Mitigations`) as the link into that sidecar.
- **Living document.** Rewrite the relevant section at each commit point so the file
  always mirrors the current frozen state — critic-loop revisions and re-selection
  overwrite the prior contents of that section. The critique sections are iteration
  scratch, not results: once their loop is done they are dead weight, and the
  orchestrator **deletes both critique sections at finalize** — the finalized file
  contains only end results. This is why the template below has
  no critique sections.

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
  task (its `ingrain-security/…` path and threat count, e.g.
  `ingrain-security/assessment-<…>.md — 4 threats`), or `none`. Set by
  `ingrain-relevance-triage` when it finds a threats-bearing prior analysis of the same
  task (branch + title); the generator seeds from it.

### `## Threats` — one `###` entry per threat; most tasks warrant **3–6** — treat it as a target; keep it short and scoped

Each threat is a `### <id> — <title>` heading followed by one `Name: value` field per line:

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
| **Selection** | `selected` \| `excluded` \| `undecided` (`—` until Gate 1) |
| **Robustness** | `weak` \| `adequate` \| `strong` — how well the adopted mitigations cover this threat in the implementation: `weak` = the threat can still be realized (a route survives, or the analysis leaves its closure unestablished); `adequate` = its realization routes are closed; `strong` = closed broadly **plus** artefacts that would fail if the control regressed. Concluded by the Testing pass from negative testing against the branch diff. Normative definitions: `references/testing/verification-pass.md` → **Robustness levels**. **Set it from that verification's verdict** — it reads `—` until then, and for any threat outside the `selected` set. |

**One field per line is what makes this file cheap to maintain.** Every stage after the
generator fills a field the stage before it left `—` — the risk scorer, Gate 1, the
verification pass — and each of those touches a contiguous run of lines inside an entry, so a
stage costs **one Edit per entry**, not one per field. Write the fields in the
order above; a field the stage that owns it has not run yet reads `—`.

**Gate 1 → Selection.** When the user decides at Gate 1, record each threat's
**Selection**: include → `selected`, exclude → `excluded`. Use
`undecided` only if the user is explicitly unsure. Before Gate 1 the field reads `—`.

### `## Risk score` — plan-level residual risk
- **Score** — integer `0`–`100`.
- **Criticality** — `low` | `medium` | `high` | `critical`.

### `## Mitigations` — one `###` entry per mitigation

| Column | Constraint |
|--------|------------|
| **Tag** | `M<n>` (e.g. `M1`) |
| **Title** | string |
| **Description** | string |
| **Yield** | `high` \| `medium` \| `low` |
| **Effort** | `high` \| `medium` \| `low` |
| **Threat tags** | **≥ 1** threat tag (e.g. `T1, T3`) |
| **Selection** | `selected` \| `excluded` \| `undecided` (optional until Gate 2) |
| **Justification** | string, **≤ 256 characters** — the reasoning behind this mitigation's **Robustness**, concluded by the Testing orchestrator from the verifier's read. **Set it from that verification's verdict** — it reads `—` until then, and for any mitigation outside the `selected` set. |
| **Robustness** | `weak` \| `adequate` \| `strong` — this mitigation's contribution to closing the threats it covers, **derived from their `## Threats` → `Robustness`**: covering one threat, it takes that threat's value; covering several that differ, **the weakest governs**. A general implementation instruction (naming no threat) takes its value from whether the instruction was followed. The same measure as the threat field, projected onto the mitigation — not a second axis; normative definitions: `references/testing/verification-pass.md` → **Robustness levels**. **Set it from that verification's verdict** — it reads `—` until then, and for any mitigation outside the `selected` set. |

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
> implementation evolves (see Maintenance below). Git-ignored.

## Task
Title: <task title>
Latest stage: <development|testing>

## Triage
Verdict: <minor|major>
Security relevant: <true|false>
Surfaces:
- …
Prior analysis: <ingrain-security/assessment-<…>.md — N threats | none>

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

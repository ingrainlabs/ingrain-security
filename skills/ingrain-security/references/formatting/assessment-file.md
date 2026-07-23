# Assessment file reference

Defines the local analysis artifact the `ingrain-security` review persists and hands
off through. The orchestrator creates and finalizes it; each worker writes its own
named section. Follow this structure exactly so every stage reads and writes the same
shape.

## Nature

- **Path.** A single file written directly into `.ingrain-security/` at the project
  root — it is **both** the living working copy the workers write during the run **and**
  its persisted record, so finalizing it in place is the whole of persisting it. The
  orchestrator mints it: it runs the `scripts/mint-assessment-path` script
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
  reviews each keep to their own file; the separation is structural — the filename enforces
  it. Any unresolvable segment is dropped
  (branch unknown → `assessment-<task-slug>.md`; no usable title →
  `assessment-<branch-slug>.md`; both absent → `assessment.md`), and the `assessment-`
  prefix always leads. The folder is **self-ignoring** (an inner `.gitignore` of a bare `*`,
  seeded by the `ensure-assessment-dir` hook and re-ensured by the script), so the whole
  folder — the ignore file included — stays out of `git status`; sharing a file is an
  explicit `git add -f <file>` opt-in.
- **Seeded with a skeleton.** The same mint **writes this file's empty skeleton** when it does
  not exist yet — every heading in schema order and the field labels of the fixed sections,
  as **structure only**: every value left empty, every entry left to the writer. `## Threats` and
  `## Mitigations` are seeded as bare headings, and the worker that fills each writes its
  `### <id> — <title>` entries beneath.
  So every writer starts from a ready-made page:
  **fill the sections in place** rather than re-creating the page — an existing file is always
  filled as it stands. The skeleton is deliberately valid under `validate-assessment --lenient`
  and invalid strictly, which is what marks an unfilled skeleton apart from a finished
  assessment.
  Because of the seeding, **`file_exists` reports written content, not the file's
  presence**: an untouched skeleton reads as `false`, exactly like no file at all, which is
  what keeps it usable as the Phase-select and resume signal. Two further fields say which
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
  | `## Task` | orchestrator (framing) |
  | `## Triage` | `ingrain-relevance-triage` |
  | `## Threats` | `ingrain-threat-generator` (the entries and their descriptive fields) → `ingrain-risk-scorer` (the scoring fields) → orchestrator (Selection at Gate 1) → the Testing verification pass (Robustness at the Testing phase) — **filled in stages**, each stage editing the field lines it owns |
  | `## Threat critique` | `ingrain-threat-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Risk score` | `ingrain-risk-scorer` (plan-level residual) |
  | `## Mitigations` | `ingrain-mitigation-generator` → orchestrator (Selection at Gate 2) → the Testing verification pass (Justification + Robustness at the Testing phase) |
  | `## Mitigation critique` | `ingrain-mitigation-critic` — **transient**, deleted by the orchestrator at finalize |
  | `## Coverage / open items` | orchestrator (Development finalize) |
  | `## Maintenance` | orchestrator (finalize) |

  The org security rules themselves live in the **linked `rules-<branch-slug>-<task-slug>.md`
  sidecar** (see `references/formatting/rules-file.md`), written by the orchestrator's
  retrieval step when rules are retrieved. This file carries
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
```

| Field | Constraint |
|-------|------------|
| **id** (in the heading) | `T<n>`, zero-padded (`T01`) — unique within the file, assigned once and **never changed** |
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
| **Selection** | `selected` \| `excluded` \| `undecided` (`—` until Gate 1) |
| **Robustness** | `weak` \| `adequate` \| `strong` — how well the adopted mitigations cover this threat in the implementation: `weak` = the threat can still be realized (a route survives, or the analysis leaves its closure unestablished); `adequate` = its realization routes are closed; `strong` = closed broadly **plus** artefacts that would fail if the control regressed. Concluded by the Testing pass from negative testing against the branch diff. Normative definitions: `references/testing/verification-pass.md` → **Robustness levels**. **Set it from that verification's verdict** — it reads `—` until then, and for any threat outside the `selected` set. |

**One field per line is what makes this file cheap to maintain.** Every stage after the
generator fills a field the stage before it left `—` — the risk scorer, Gate 1, the
verification pass — and each of those is an Edit of one short line. Write the fields in the
order above; a field the stage that owns it has not run yet reads `—`.

**Justification leads the scoring fields on purpose.** The scorer fills an entry top-down,
so this schema doubles as a reasoning schema: writing the justification *before* the
numerical (Risk score) and qualitative (Impact, Likelihood, Criticality) scores lets the
reasoning come first and drive the scores.

**The id is permanent; priority is derived.** An id is assigned at creation, in discovery
order, and never changes — not when a threat is dropped, not when the scores change. Gaps are
expected and legal: a retired `T02` leaves `T01` and `T03` pointing exactly where they did,
so every mitigation's **Threats** reference stays correct without re-derivation.

Priority is **not stored**. Anywhere threats are shown in priority order — the Gate 1 table,
a worker's report — sort by **Risk score descending**, breaking ties by impact
(critical > high > medium > low), then likelihood (very high > high > medium > low), then id
ascending. Document order carries no meaning.

**Gate 1 → Selection.** When the user decides at Gate 1, record each threat's
**Selection**: include → `selected`, exclude → `excluded`. Use
`undecided` only if the user is explicitly unsure. Before Gate 1 the field reads `—`.

### `## Risk score` — plan-level residual risk
- **Score** — integer `0`–`100`.
- **Criticality** — `low` | `medium` | `high` | `critical`.

### `## Mitigations` — one `###` entry per mitigation

A mitigation is either a **threat mitigation** (names ≥1 threat) or a **general
implementation instruction** for the full scoped task (names none). Both belong in
this section, in the same shape as a threat:

```markdown
### M01 — Bind the enrollment token to the request that produced it
Description: …
Yield: high
Effort: medium
Threats: T01, T03
Rule refs: r-auth-01
Selection: —
Justification: —
Robustness: —
```

| Field | Constraint |
|-------|------------|
| **id** (in the heading) | `M<n>`, zero-padded (`M01`) — unique within the file, assigned once and **never changed**; gaps are legal |
| **title** (in the heading) | string, after the ` — ` |
| **Description** | string |
| **Yield** | `high` \| `medium` \| `low` |
| **Effort** | `high` \| `medium` \| `low` |
| **Threats** | `0..N` threat ids (e.g. `T01, T03`), each resolving to a `### T<n>` entry in this file; `—` when the mitigation is a general implementation instruction not tied to a specific threat |
| **Rule refs** | the org rule id(s) the mitigation follows, `0..N` comma-separated (e.g. `r-auth-01, r-log-03`); `—` when it follows no org rule (a pure threat mitigation). One mitigation may follow multiple rules. Ids are machine-facing — they stay in this file, and **the user sees rule titles** (Gate 2 resolves each id to its title). Each id is the link into the persistent `rules-<…>.md` sidecar, where the rule's title and full body live (see `references/formatting/rules-file.md`). |
| **Selection** | `selected` \| `excluded` \| `undecided` (optional until Gate 2) |
| **Justification** | string, **≤ 256 characters** — the reasoning behind this mitigation's **Robustness**, concluded by the Testing orchestrator from the verifier's read. **Set it from that verification's verdict** — it reads `—` until then, and for any mitigation outside the `selected` set. |
| **Robustness** | `weak` \| `adequate` \| `strong` — this mitigation's contribution to closing the threats it covers, **derived from their `## Threats` → `Robustness`**: covering one threat, it takes that threat's value; covering several that differ, **the weakest governs**. A general implementation instruction (naming no threat) takes its value from whether the instruction was followed. The same measure as the threat field, projected onto the mitigation — not a second axis; normative definitions: `references/testing/verification-pass.md` → **Robustness levels**. **Set it from that verification's verdict** — it reads `—` until then, and for any mitigation outside the `selected` set. |

**Follows org rules is derived from Rule refs.** A mitigation with ≥1 **Rule ref**
follows org rules; an empty **Rule refs** (`—`) means a pure threat mitigation. Surface
this as a computed indicator (e.g. at Gate 2), keeping it out of the stored file: the
indicator is the rule **title(s)**, resolved at display time by looking each **Rule ref**
id up in the `rules-<…>.md` sidecar (its `## Retrieved rules` entries /
`## Per-mitigation mapping`). The sidecar owns the titles; this file owns the ids.

**Gate 2 → Selection.** Record each mitigation's **Selection**:
adopt → `selected`, decline → `excluded`; `undecided` only if the user is unsure.

**Justification leads the Robustness on purpose** — the same reasoning schema
`## Threats` uses for its scores (above): filling the entry top-down forces the reasoning to
come first and drive the conclusion. The 256-character cap on both justifications is part of
that forcing — it keeps the justification to the reasoning that produced the value.

**Who fills the verification fields.** The Testing verification pass
(`references/testing/verification-pass.md`) writes all three: `## Threats` → **Robustness** from its
negative testing of each selected threat, then `## Mitigations` → **Justification** and
**Robustness**, the latter derived from the threats each mitigation covers. Entries that
are not `selected` stay `—`. Writing them, alongside setting `## Task` →
`Latest stage: testing`, is what marks the assessment checked; the plan review leaves them
at `—` for Testing to fill.

**The threat field is the primary result.** `## Threats` → `Robustness` records what was
actually tested — whether the threat survives the change. The `## Mitigations` field of the
same name is derived bookkeeping on top of it: one measure, carried onto the entries that
produced it, so a mitigation's Robustness always tracks the threats it covers.

### `## Coverage / open items`
- Any threat whose **Selection** is `selected` that has no mitigation with
  **Selection** `selected` covering it (via its **Threats** field). Only **threat
  mitigations** (those naming threats) count toward covering a threat; general
  implementation instructions apply to the scoped task as a whole.
- This is a **structural** join computed at the Development finalize: it records that a
  mitigation was adopted for the threat. Efficacy lives in `## Threats` → **Robustness**,
  written later by Testing. A threat can be "covered" here and `weak` there. This section is
  written once, at the Development finalize.

### `## Maintenance (for the implementing agent)`
- Instruction to keep the file in sync as the implementation evolves.
- **How that agent locates this file.** It runs in a later session and has no minted path
  in context, so it must **re-run** the `mint-assessment-path` mint command from its
  `INGRAIN-ASSESSMENT-PATHS` session context and write to the `assessment_abs` it
  returns. Re-minting is deterministic in branch + title, so it resolves to this same
  file — and the mint is what resolves the path and ensures the folder, so `assessment_abs`
  arrives ready to write to. 

## Validation — run it after every write

**Every time this file is written, it is checked with the bundled
`scripts/validate-assessment` script.** No exceptions: after the orchestrator opens it, after
each worker returns from writing its section, after a gate's `Selection` is recorded, and at
finalize. The next reader is a different agent in a different context — a malformed entry is
invisible until it breaks there, and by then the run that produced it is over.

**The orchestrator runs it, including for the workers.** A worker carries Read, Grep, Glob,
Edit and Write — enough to inspect the repo and to write its own section with Edit or Write —
but no shell, so it writes its section and returns; the orchestrator validates that write
before dispatching the next one, and re-dispatches the worker with the violations quoted back
if something is wrong.

Run it on the **same absolute path you just wrote to** (`assessment_abs`); the ready-to-run
command, with the plugin root already substituted, is in your `INGRAIN-ASSESSMENT-PATHS`
session context:

    bash <plugin>/skills/ingrain-security/scripts/validate-assessment <assessment_abs> [--lenient]

**Pre-approved, like the writes.** An `allow-script-run` hook auto-approves this command on
both hosts, so expect **no permission prompt** — run it as often as the rule below says. The
grant covers a *bare* run of the plugin's own read-only scripts and nothing more: append
anything to the command (a `;`, a pipe, a redirect) and it prompts again. **Run it exactly as
printed above — nothing appended.** In particular do not chain an `echo` of the exit status:
the verdict is already on stdout (below), so the suffix buys nothing and costs the
pre-approval.

**Two modes, one rule.** Pass **`--lenient` while the run is in progress** — mid-run this
file is incomplete by design (at Step 0 it holds only `## Task` and `## Triage`), and
lenient waives exactly the checks that cannot hold yet: a section not written, an entry's
field absent or still `—` because the stage that owns it has not run. Everything already
filled in is still checked in full — a wrong `Impact` is a violation in either mode.
**Drop the flag at finalize**, where every field must be filled.

**Read the result off stdout.** It prints one JSON object there — `"valid"` is the verdict and
`"error_count"` the tally — and each violation on stderr as `<path>:<line>: <message>`, the
line and the field named, so the fix is local. That JSON is the whole answer; nothing else
needs to be observed. (It also exits `0` valid · `1` schema violations · `2` usage error, for
the hooks and tests that consume it non-interactively.)

**On `"valid":false`: fix exactly the violations it names, then re-run — at most twice.** Fix by
correcting what you wrote, so the file earns the pass on its content. If it still fails
after the second attempt, **say so in one line naming the remaining violations** and carry
on — two attempts is the bound, and saying it out loud is what the check exists to secure.
**Make every correction with the Edit or Write tool, on `assessment_abs`** — the
`allow-assessment-write` hook pre-approves those tools for this file on both hosts, so the
fix lands with no permission prompt.

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

### M01 — <short title>
Description: …
Yield: high
Effort: medium
Threats: T01
Rule refs: r-auth-01
Selection: selected
Justification: …
Robustness: adequate

### M02 — <short title>
Description: …
Yield: medium
Effort: low
Threats: —
Rule refs: r-log-03
Selection: selected
Justification: …
Robustness: strong

## Coverage / open items
- <any selected threat with no selected mitigation covering it>

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis — a new
surface, a threat's acceptance changes, or a mitigation is added, dropped, or
altered. Keep the Selection fields and coverage honest against the code you write,
and keep every enumerated field within its allowed values. Ids are permanent: add a new
threat with the next free `T<n>` and never renumber the existing ones.

To locate this file, re-run the `mint-assessment-path` mint command from your
INGRAIN-ASSESSMENT-PATHS session context and write to the absolute `assessment_abs`
it returns — it resolves back to this same file, and the mint is what resolves the
path and ensures the folder.

Org rules for this task (if any were retrieved) live in the linked sidecar
.ingrain-security/rules-<branch-slug>-<task-slug>.md — re-mint it with the `mint-rules-path`
command; it is persistent and maintained there.
```

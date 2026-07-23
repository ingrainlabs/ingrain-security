# Rules file reference

Defines the org-rules **sidecar** the `ingrain-security` review persists next to the
assessment file. It is the twin of `assessment-file.md`: same folder, same branch + task
slug, same minted-path discipline — but where the assessment carries the
analysis, this file carries the **org security rules** (id, title, and full body/description)
retrieved for the task, so the verification stage reads the rule descriptions **straight off
disk**. It is filled by the orchestrator's single retrieval pass, which queries from the plan
and the selected threats before mitigations exist. Follow this structure exactly.

## Nature

- **Path.** A single file written directly into `.ingrain-security/` at the project root, a
  **sibling of the assessment file**. Nobody hand-builds it: the orchestrator (in Development
  at the retrieval step, or in the verification pass) runs the plugin's
  `scripts/mint-rules-path` script (`mint` subcommand) and uses its **`rules_abs`** — the absolute
  path — as the write/read target, passing that same absolute path to every worker that reads
  or appends to it; the relative `rules_path` is a display form for prose and
  links only. The name is deterministic in the branch + task, keyed by the **same slug** as
  the assessment:
  `<project_root>/.ingrain-security/rules-<branch-slug>-<task-slug>.md`
  so `rules-<…>.md` and `assessment-<…>.md` are twin sidecars for one task. The same slug
  fallbacks apply (branch unknown → `rules-<task-slug>.md`; no title → `rules-<branch-slug>.md`;
  both absent → `rules.md`), and the `rules-` prefix always leads. Minting is shared with the
  assessment path (`scripts/lib/mint-path.sh`), so the two always resolve to matching slugs.
- **Filled when org rules are retrieved.** Minting **seeds the file with its empty skeleton**
  (`## Retrieved rules`, `## Per-mitigation mapping`, both empty), so a retrieval pass fills
  the sections in place rather than building the page; an existing file is always filled as it
  stands.
  Its **content** is conditional: it carries rules exactly when the retrieval pass got them
  back from the `ingrain` CLI, and stays an empty skeleton where nothing came back.
  Because the file is seeded, **the presence of the file says nothing** — read the mint JSON
  instead: **`file_exists: true`** (equivalently `template_only: false`) means org rules back
  this task's mitigations; an untouched skeleton means judge from the mitigation Descriptions
  alone.
- **Persistent.** Once written it **stays** — the assessment file's scratch sections are
  deleted at finalize, this file survives it — so the Testing verification pass (which runs
  in a later session) can re-mint the path and read the rule descriptions. It is
  **git-ignored** (the folder self-ignores), so it stays uncommitted.
- **Pre-approved for writing.** The `auto-approve-assessment-write` hook auto-approves writes to
  `rules*.md` directly inside `.ingrain-security/` (the same grant that covers `assessment*.md`),
  so expect **no permission prompt** when writing it. Any other path still prompts. In
  **plan mode** the write is held for the user's approval all the same: ask them to allow
  writes to `.ingrain-security/`, naming this file and what the run needs it for, then retry
  the same write to `rules_abs`. Keeping it on disk is what lets the Testing pass re-mint and
  read it in a later session.
- **Linked from the assessment.** The assessment file links to this sidecar by its relative
  `rules_path`, and each mitigation's **Rule refs** ids (in the assessment's `## Mitigations`
  entries) are the machine link into this file's rule entries. The rule **titles and bodies**
  live here, and the assessment reaches them by that link.

## Sections and fields

Every field below is **required** unless marked optional.

### `## Retrieved rules` — one entry per retrieved org rule

One entry per retrieved rule, keyed by its id — written by the orchestrator's retrieval pass.
Render as a subsection per rule so the full body is readable:

- **`### <id> — <title>`** — the rule id (verbatim, machine-facing — matches a **Rule refs**
  entry in the assessment) and the rule title (verbatim).
- The rule **body/description** underneath — the full text as returned by
  `ingrain context security_rules … --json` (the `body` field), the org's authoritative
  guidance on *how to implement* the control. Keep it verbatim, in full.

Cite exactly the rules the retrieval pass returned, with the id, title and body as they came back.

### `## Per-mitigation mapping` — which rules each mitigation follows

One line per mitigation that follows ≥1 rule, keyed by its permanent id:
`M<n> → <id>[, <id>…]` with a one-line note on how the rule(s) shaped it. Because ids never
change, a key written here stays valid across revision rounds. A mitigation whose
**Rule refs** is `—` (a pure threat mitigation with no backing rule) is simply absent here. Every id
here must appear as an entry in `## Retrieved rules`, and must match that mitigation's
**Rule refs** in the assessment — the three stay in sync.

### `## Applicable rules` — optional

Retrieved rules that apply to the change as a whole rather than to one mitigation, each
as `<id> — <title>`, written by the orchestrator's retrieval pass so the critic and reviewer
still see them. Omit the section if there are none.

## Ownership and lifecycle

| Stage | Actor | Action |
|-------|-------|--------|
| Plan · Retrieve rules (step 5) | orchestrator | Creates the file and writes `## Retrieved rules` / `## Applicable rules` from the CLI pass (only if rules came back) |
| Plan · Mitigate (step 6) | `ingrain-mitigation-generator` | Reads `## Retrieved rules`; writes **only** `## Per-mitigation mapping`, rewriting it each revision round to stay in sync with `## Mitigations` |
| Plan · Critique (step 7) | `ingrain-mitigation-critic` | Reads it by pointer to judge how faithfully mitigations follow the cited rules, and which retrieved rules go unapplied |
| Plan · Gate 2 (step 8) | orchestrator | Reads `## Per-mitigation mapping` + `## Retrieved rules` to resolve each **Rule ref** id → title for the "Follows rules" display |
| Plan · finalize | orchestrator | **Leaves it in place** — the file is persistent |
| Review | `ingrain-threat-verifier` | Reads the rule description(s) behind its threat's covering mitigations as supporting context for verification |

Only the rule **titles** it records reach the user, at Gate 2; the file itself stays internal.

## Maintenance

To locate this file, re-run the `mint-rules-path` mint command from the
`INGRAIN-ASSESSMENT-PATHS` session context and use the absolute `rules_abs` it returns — it
resolves back to this same file (deterministic in branch + title). The mint is what resolves
the path and ensures the folder, so `rules_abs` is ready to write to as it comes back.
`file_exists: false` means no org rules were retrieved for this task — the file on disk is the
minter's empty skeleton, and an empty `## Retrieved rules` stays empty until a real retrieval
pass fills it. Judge from the mitigation Descriptions in the meantime.

## Template

```markdown
# Org rules — <task title>

> Local sidecar produced by ingrain-security when org rules were retrieved for this task's
> mitigations. Read by the mitigation critic, Gate 2, and the verification skill. Git-ignored.

## Retrieved rules

### r-auth-01 — Authenticated service calls
<full rule body / description, verbatim from the CLI>

### r-log-03 — Structured audit logging
<full rule body / description, verbatim from the CLI>

## Per-mitigation mapping
M01 → r-auth-01 — authenticates the token-refresh endpoint per the org's service-auth rule
M02 → r-log-03 — emits a structured audit record on the sensitive action

## Applicable rules
r-rate-07 — Rate-limit sensitive endpoints
```

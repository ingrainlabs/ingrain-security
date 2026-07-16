# Rules file reference

Defines the org-rules **sidecar** the `ingrain-security` review persists next to the
assessment file. It is the twin of `assessment-file.md`: same folder, same branch + task
slug, same minted-not-hand-built discipline — but where the assessment carries the
analysis, this file carries the **org security rules** (id, title, and full body/description)
the mitigation-generator retrieved, so the verification stage can read the rule descriptions
back **without re-querying the CLI**. Follow this structure exactly.

## Nature

- **Path.** A single file written directly into `.ingrain-security/` at the project root, a
  **sibling of the assessment file**. The orchestrator does not hand-build it: the
  mitigation-generator (or the verification orchestrator) runs the bundled
  `scripts/rules-path` script (`mint` subcommand) and uses its **`rules_abs`** — the absolute
  path — as the write/read target; the relative `rules_path` is a display form for prose and
  links only. The name is deterministic in the branch + task, keyed by the **same slug** as
  the assessment:
  `<project_root>/.ingrain-security/rules-<branch-slug>-<task-slug>.md`
  so `rules-<…>.md` and `assessment-<…>.md` are twin sidecars for one task. The same slug
  fallbacks apply (branch unknown → `rules-<task-slug>.md`; no title → `rules-<branch-slug>.md`;
  both absent → `rules.md`), and the `rules-` prefix always leads. Minting is shared with the
  assessment path (`scripts/lib/mint-path.sh`), so the two never drift.
- **Created only when org rules are retrieved.** Unlike the assessment file, this file is
  **conditional**: it is written during the mitigation step **only if** the mitigation-generator
  actually retrieved org rules from the `ingrain` CLI. If the CLI is absent, unconfigured, or
  returns nothing (graceful degradation), **no rules file is written** — its absence is the
  signal that no org rules back this task's mitigations, and downstream readers fall back to
  the mitigation Descriptions alone.
- **Persistent — not deleted at finalize.** This is the key difference from the assessment
  file's transient scratch sections. Once written it **stays**, so the Phase B verification
  pass (which runs in a later session) can re-mint the path and read the rule
  descriptions. It is **git-ignored** (the folder self-ignores), so it stays uncommitted.
- **Pre-approved for writing.** The `allow-assessment-write` hook auto-approves writes to
  `rules*.md` directly inside `.ingrain-security/` (the same grant that covers `assessment*.md`),
  so expect **no permission prompt** when writing it. Any other path still prompts.
- **Linked from the assessment.** The assessment file links to this sidecar by its relative
  `rules_path`, and each mitigation's **Rule refs** ids (in the assessment's `## Mitigations`
  table) are the machine link into this file's rule entries. The rule **titles and bodies** are
  not duplicated into the assessment — they live only here.

## Sections and fields

Every field below is **required** unless marked optional.

### `## Retrieved rules` — one entry per retrieved org rule

For each rule the generator retrieved and a mitigation follows, an entry keyed by its id.
Render as a subsection per rule so the full body is readable:

- **`### <id> — <title>`** — the rule id (verbatim, machine-facing — matches a **Rule refs**
  entry in the assessment) and the rule title (verbatim).
- The rule **body/description** underneath — the full text as returned by
  `ingrain context security_rules … --json` (the `body` field), the org's authoritative
  guidance on *how to implement* the control. Keep it verbatim; do not summarize.

Cite only rules actually retrieved — never invent a rule, an id, or a body.

### `## Per-mitigation mapping` — which rules each mitigation follows

One line per mitigation that follows ≥1 rule, keyed by its tag:
`M<n> → <id>[, <id>…]` with a one-line note on how the rule(s) shaped it. Write nothing for a
mitigation whose **Rule refs** is `—` (a pure threat mitigation with no backing rule). Every id
here must appear as an entry in `## Retrieved rules`, and must match that mitigation's
**Rule refs** in the assessment — the three stay in sync.

### `## Applicable rules` — optional

Retrieved rules relevant to the change that do not map cleanly onto a single mitigation, each
as `<id> — <title>`, so the critic and reviewer still see them. Omit the section if there are
none.

## Ownership and lifecycle

| Stage | Actor | Action |
|-------|-------|--------|
| Plan · Mitigate (step 5) | `ingrain-mitigation-generator` | Creates & writes the file (only if rules retrieved); rewrites it on each revision round to stay in sync with `## Mitigations` |
| Plan · Critique (step 6) | `ingrain-mitigation-critic` | Reads it by pointer to judge how faithfully mitigations follow the cited rules |
| Plan · Gate 2 (step 7) | orchestrator | Reads `## Per-mitigation mapping` + `## Retrieved rules` to resolve each **Rule ref** id → title for the "Follows rules" display |
| Plan · finalize | orchestrator | **Leaves it in place** — persistent, never deleted |
| Review | `ingrain-mitigation-verifier` | Reads its own mitigation's rule description(s) as supporting context for verification |

Phase B's `ingrain-blind-maturity-reviewer` is deliberately **not** a reader of this file — it
is given no rules and no path to them, so that its read of the implementation is independent of
the analysis it is checking; see `references/verification-pass.md` → **How to dispatch the blind
reviewer**.

The file is never shown to the user directly; only the rule **titles** it records reach the
user at Gate 2.

## Maintenance

To locate this file, re-run the `rules-path` mint command from the
`INGRAIN-ASSESSMENT-PATHS` session context and use the absolute `rules_abs` it returns — it
resolves back to this same file (deterministic in branch + title). Never resolve a relative
`.ingrain-security/…` string against the file being edited, and never create the folder. If
the file does not exist (`file_exists: false`), no org rules were retrieved for this task —
do not fabricate one; fall back to the mitigation Descriptions.

## Template

```markdown
# Org rules — <task title>

> Local sidecar produced by ingrain-security when org rules were retrieved for this task's
> mitigations. Read by the mitigation critic, Gate 2, and the verification skill. Not committed.

## Retrieved rules

### r-auth-01 — Authenticated service calls
<full rule body / description, verbatim from the CLI>

### r-log-03 — Structured audit logging
<full rule body / description, verbatim from the CLI>

## Per-mitigation mapping
M1 → r-auth-01 — authenticates the token-refresh endpoint per the org's service-auth rule
M2 → r-log-03 — emits a structured audit record on the sensitive action

## Applicable rules
r-rate-07 — Rate-limit sensitive endpoints
```

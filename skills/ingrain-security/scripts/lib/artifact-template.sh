# Skeleton templates for the ingrain-security markdown artifacts.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose, and sourcing must not change that.
#
# Sourced by:
#   skills/ingrain-security/scripts/assessment-path   (label: assessment)
#   skills/ingrain-security/scripts/rules-path        (label: rules)
#
# A mint seeds this skeleton into the artifact when the file does not exist yet, so no
# writer ever starts from a blank page. The skeleton carries structure and a FIELD CARD per
# section — never content: no example entries and no placeholder values that could survive
# into the finalized file. `## Threats` and `## Mitigations` hold no entries; the worker that
# fills each writes its `### <id> — <title>` entries under the card.
#
# The cards below RENDER the schema that `references/formatting/assessment-file.md` (and, for
# the sidecar, `rules-file.md`) owns — see its § The field cards carry the shape for what they
# are for and why they are PERMANENT. What that leaves to this file is the rendering itself,
# under three invariants: a field or value changed in the reference is changed here in the
# same edit; no line of a card may begin with `###`, so an untouched skeleton still holds no
# entry by any test of it; and a card is static text, so the skeleton stays deterministic.
#
# Sections present but unfilled is the skeleton's whole point: an unfilled skeleton is not a
# finished assessment, and nothing in it should read as one.
#
# Because the skeleton is deterministic in (label, title), a caller can tell an untouched
# artifact from a written one by comparing the file against a freshly rendered skeleton —
# that comparison is what the minters report as `template_only`, and what keeps
# `file_exists` meaning "already holds written content" rather than merely "the inode is
# there".

# Render one artifact's skeleton on stdout, WITHOUT a trailing newline so it compares
# byte for byte against `$(cat <file>)`, which strips trailing newlines.
# $1 label (assessment | rules), $2 the task title ("" when none was resolved).
render_artifact_template() {
    # An unresolved title leaves both the heading suffix and the field value off entirely,
    # rather than trailing a separator or a space behind.
    local label="$1" title="$2" heading_suffix="" title_field="Title:"
    if [ -n "${title}" ]; then
        heading_suffix=" — ${title}"
        title_field="Title: ${title}"
    fi

    if [ "${label}" = "rules" ]; then
        printf '%s' "# Org rules${heading_suffix}

> Local sidecar produced by ingrain-security when org rules are retrieved for this task's
> mitigations. Read by the mitigation critic, Gate 2, and the verification skill. Git-ignored.
>
> Skeleton seeded by the \`rules-path\` minter — fill the sections below; do not re-create
> the page. The comment under each heading is that section's field card — write from it.
> While it is untouched, no org rules have been retrieved for this task.

## Retrieved rules
<!-- One entry per retrieved rule: a \"### <id> — <title>\" heading, then the rule body
     underneath — verbatim and in full, exactly as the ingrain CLI returned it. Ids are
     machine-facing and must match the Rule refs in the assessment file. -->

## Per-mitigation mapping
<!-- One line per mitigation that follows at least one rule, keyed by its permanent id:
     \"M<nn> → <id>[, <id>…]\" plus a one-line note on how the rule(s) shaped it. A
     mitigation with no backing rule is simply absent here. Every id used here must have an
     entry under Retrieved rules. -->"
        return 0
    fi

    printf '%s' "# Security assessment${heading_suffix}

> Local working artifact produced by ingrain-security — keep in sync as the
> implementation evolves (see Maintenance below). Git-ignored.
>
> Skeleton seeded by the \`assessment-path\` minter — fill the sections below; do not
> re-create the page. Each is empty until the stage that owns it writes it. The comment
> under each heading is that section's field card — write from it.

## Task
<!-- Title: the task's title. Latest stage: development|testing — development while the plan
     review and the implementation are in progress; testing once the verification pass has
     run. -->
${title_field}
Latest stage: development

## Triage
<!-- Verdict: minor|major. Security relevant: true|false. Surfaces: a bullet list, present
     when major. Prior analysis: optional — a pointer to a prior analysis of this task, or
     none. -->
Verdict:
Security relevant:
Surfaces:

## Threats
<!-- Each threat is a \"### T<nn> — <title>\" heading, then these fields, one per line, in
     this order: Asset, Vector, Description, Assumptions, Justification (≤256 chars),
     Impact (critical|high|medium|low), Likelihood (very high|high|medium|low),
     Risk score (0-100), Criticality (low|medium|high|critical),
     Selection (selected|excluded|undecided), Robustness (weak|adequate|strong).
     A field whose stage has not run yet reads \"—\". Ids are permanent. -->

## Risk score
<!-- Score: 0-100. Criticality: low|medium|high|critical. The plan-level residual risk. -->
Score:
Criticality:

## Mitigations
<!-- Each mitigation is a \"### M<nn> — <title>\" heading, then these fields, one per line, in
     this order: Description, Yield (high|medium|low), Effort (high|medium|low),
     Threats (the T-ids it covers, or — for a general implementation instruction),
     Rule refs (org rule ids, or —), Selection (selected|excluded|undecided),
     Justification (≤256 chars), Robustness (weak|adequate|strong).
     A field whose stage has not run yet reads \"—\". Ids are permanent. -->

## Coverage / open items

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis — a new
surface, a threat's acceptance changes, or a mitigation is added, dropped, or
altered. Keep the Selection fields and coverage honest against the code you write,
and keep every enumerated field within the values its section's field card names —
the comment under each heading. Ids are permanent: add a new threat with the next
free \`T<n>\` and never renumber the existing ones.

To locate this file, re-run the \`assessment-path\` mint command from your
INGRAIN-ASSESSMENT-PATHS session context and write to the absolute \`assessment_abs\`
it returns — it resolves back to this same file. Do not resolve a relative path
against the file you are editing, and do not create an \`.ingrain-security/\` folder."
}

# Seed the skeleton into $3 when that file does not exist, and report what the caller is
# looking at: `seeded` (it was absent and now holds a fresh skeleton), `template_only` (it
# existed and is still an untouched skeleton) or `written` (it holds real content). An
# existing file is never rewritten. $1 label, $2 title, $3 absolute path.
# Returns 1 when the write fails.
seed_artifact_template() {
    local label="$1" title="$2" path="$3" template
    template="$(render_artifact_template "${label}" "${title}")"

    if [ ! -f "${path}" ]; then
        printf '%s\n' "${template}" > "${path}" 2>/dev/null || return 1
        printf 'seeded'
        return 0
    fi

    if [ "$(cat "${path}" 2>/dev/null)" = "${template}" ]; then
        printf 'template_only'
    else
        printf 'written'
    fi
    return 0
}

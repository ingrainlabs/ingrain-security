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
# writer ever starts from a blank page. The skeleton carries ONLY structure — every heading
# in schema order and the field labels of the sections whose fields are fixed — and no
# content: no example entries and no placeholder values that could survive into the
# finalized file. `## Threats` and `## Mitigations` are seeded empty; the worker that fills
# each writes its `### <id> — <title>` entries under the heading.
#
# It is deliberately valid under `validate-assessment --lenient` (sections present but
# unfilled is exactly what leniency waives) and deliberately INVALID strictly: an unfilled
# skeleton is not a finished assessment.
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
> the page. While it is untouched, no org rules have been retrieved for this task.

## Retrieved rules

## Per-mitigation mapping"
        return 0
    fi

    printf '%s' "# Security assessment${heading_suffix}

> Local working artifact produced by ingrain-security — keep in sync as the
> implementation evolves (see Maintenance below). Git-ignored.
>
> Skeleton seeded by the \`assessment-path\` minter — fill the sections below; do not
> re-create the page. Each is empty until the stage that owns it writes it.

## Task
${title_field}
Latest stage: development

## Triage
Verdict:
Security relevant:
Surfaces:

## Threats

## Risk score
Score:
Criticality:

## Mitigations

## Coverage / open items

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis — a new
surface, a threat's acceptance changes, or a mitigation is added, dropped, or
altered. Keep the Selection fields and coverage honest against the code you write,
and keep every enumerated field within its allowed values. Ids are permanent: add a
new threat with the next free \`T<n>\` and never renumber the existing ones.

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

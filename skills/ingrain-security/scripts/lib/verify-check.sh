# Shared decision logic for the ingrain-security-test Stop-hook reminder.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose (git lookups on a non-git or detached-HEAD checkout must
# degrade to an empty result, not abort), and sourcing must not change that.
#
# Sourced by the two host Stop-hook wrappers, which own stdin (the `stop_hook_active`
# loop guard) and emit the host's Stop JSON:
#   hooks/claude/verify-check   (Stop, Claude Code)
#   hooks/codex/verify-check    (Stop, Codex)
# Both also source lib/project-root.sh, whose resolve_project_root this file calls.
#
# The reminder fires only after implementation: a task with adopted mitigations that
# have not yet been verified, on a working tree with uncommitted changes. It stays quiet
# otherwise so a routine turn-end is never interrupted.

# The instruction handed back to the agent when a reminder is warranted. Shared so both
# hosts emit identical wording.
VERIFY_CHECK_REASON="This task has an ingrain-security assessment with adopted mitigations that have not been verified against the implementation. Before presenting or committing the change, run the 'ingrain-security-test' skill via the Skill tool to verify each adopted mitigation was implemented."

# Echo VERIFY_CHECK_REASON and return 0 when the current repo state warrants reminding the
# agent to run ingrain-security-test; echo nothing and return non-zero otherwise. The
# host ($1) selects the project-root resolution (resolve_project_root, from
# project-root.sh, which the caller must have sourced).
#
# Guards (all must hold): the project has an .ingrain-security/ folder; the working tree
# is dirty; and some assessment for the current branch has an adopted (selected)
# mitigation row and has not already reached `Latest stage: review`.
verify_check_reason() {
    local host="${1:-}" project_root assessment_dir branch branch_slug f
    local -a candidates

    project_root="$(resolve_project_root "${host}")"
    [ -n "${project_root}" ] || return 1
    assessment_dir="${project_root}/.ingrain-security"
    [ -d "${assessment_dir}" ] || return 1

    # Only remind when the working tree actually has changes to verify.
    [ -n "$(git -C "${project_root}" status --porcelain 2>/dev/null)" ] || return 1

    # Resolve the current branch slug the same way scripts/assessment-path does, so the
    # glob matches this branch's assessment file(s). An unknown branch widens the glob.
    branch="$(git -C "${project_root}" branch --show-current 2>/dev/null)"
    [ -n "${branch}" ] || branch="$(git -C "${project_root}" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    branch_slug="$(printf '%s' "${branch}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed -E 's/-+/-/g; s/^-|-$//g')"

    shopt -s nullglob
    if [ -n "${branch_slug}" ] && [ "${branch_slug}" != "head" ]; then
        candidates=("${assessment_dir}"/assessment-"${branch_slug}"-*.md "${assessment_dir}"/assessment-"${branch_slug}".md)
    else
        candidates=("${assessment_dir}"/assessment-*.md)
    fi

    # Remind if any candidate assessment has an adopted (selected) mitigation row and has
    # not already been verified (Latest stage: review). A selected mitigation row is a
    # `| M<n> | … | selected | …` line in the ## Mitigations table.
    for f in "${candidates[@]}"; do
        [ -f "${f}" ] || continue
        grep -q 'Latest stage: review' "${f}" 2>/dev/null && continue
        if grep -qE '^\| *M[0-9]+ .*\bselected\b' "${f}" 2>/dev/null; then
            printf '%s' "${VERIFY_CHECK_REASON}"
            return 0
        fi
    done
    return 1
}

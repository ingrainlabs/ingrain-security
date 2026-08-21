# The assessment folder's lifecycle, for the ingrain-security plugin.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options, for the reason project-root.sh states.
# Self-contained: `ensure_assessment_dir` takes the project root as an argument, so this file
# requires nothing from its siblings.
#
# Split out of project-root.sh, which had accumulated three unrelated concerns under a name
# covering one. The folder is its own subject: who creates it, what keeps it out of git, and
# what refuses a crafted target.
#
# Sourced by:
#   hooks/scripts/ensure-assessment-dir                  (creates it at SessionStart)
#   skills/ingrain-security/scripts/assessment-mint    (for lib/mint.sh)
#   hooks/claude/allow-assessment-write                (for hooks/scripts/lib/assessment-write.sh)
#   hooks/codex/allow-assessment-write                 (for hooks/scripts/lib/assessment-write.sh)
#   hooks/scripts/require-review-before-write          (names the folder the gate reads)

# INTERNAL to this file — `ensure_assessment_dir` is its only caller.
#
# Idempotently ensure the assessment folder's self-ignoring .gitignore, so a routine
# `git add -A` cannot sweep up an assessment — which can contain analysis of a private
# codebase — into a commit. The bare `*` matches this file too, so the whole folder,
# ignore file included, stays out of `git status`; `git add -f <file>` remains the
# explicit escape hatch for sharing one.
#
# printf (not a heredoc) — documented bash 5.3 heredoc hang.
seed_gitignore() {
    local ignore="$1/.gitignore"
    [ -f "${ignore}" ] && return 0
    printf '%s\n' \
        '# Assessments here can contain analysis of a private codebase, so they' \
        '# are ignored by default. Share one explicitly with: git add -f <file>' \
        '*' \
        > "${ignore}" 2>/dev/null || true
}

# The one artifact folder, named once. Every caller that builds a path under it reads this
# rather than repeating the literal, so the folder can never be half-renamed.
ASSESSMENT_DIR_NAME=".ingrain-security"

# Idempotently ensure <project_root>/.ingrain-security, refusing a symlinked target, and
# leave its self-ignoring .gitignore in place. Prints the absolute folder on success.
#
# Shared by the SessionStart hook and the minter, which had grown the same three steps
# independently. Their failure POLICIES differ and stay with the callers: the hook must
# never abort a session, the minter must report why it could not write. Hence distinct
# codes rather than one boolean — 2 is the crafted-repo case, 1 is a plain I/O failure.
ensure_assessment_dir() {
    local dir="$1/${ASSESSMENT_DIR_NAME}"
    # A pre-placed symlink could redirect every later write outside the tree.
    [ -L "${dir}" ] && return 2
    [ -d "${dir}" ] || mkdir -p "${dir}" 2>/dev/null || return 1
    seed_gitignore "${dir}"
    printf '%s' "${dir}"
}

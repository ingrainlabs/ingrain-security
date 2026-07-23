# Project-root helpers: resolve_project_root, seed_gitignore, escape_for_json.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by both write hooks, hooks/start/*, and all four scripts in run/ — the one lib here
# used by both entities. Sets no shell options: every caller runs `set -uo pipefail` WITHOUT
# `-e` on purpose (git lookups on a non-git or detached-HEAD checkout must degrade to an empty
# result, not abort).
#
# Every function echoes empty and returns non-zero on failure, so callers can fall through to
# the next candidate rather than act on a bad path.

# Normalize a directory to an absolute, canonical forward-slash path. An empty argument or an
# unreachable directory yields empty output and a non-zero status.
#
# The `cd && pwd` idiom normalizes the value for Git Bash on Windows, where CLAUDE_PROJECT_DIR
# is a native backslash path that MSYS does not convert for env vars. The subshell keeps a bare
# call from moving the $PWD of every hook that sources this file.
normalize_dir() {
    [ -n "${1:-}" ] || return 1
    (cd "$1" 2>/dev/null && pwd)
}

# The root of the git repository containing the current directory; empty when outside a
# repo. `rev-parse --show-toplevel` answers from ANY subdirectory, which is what pins the
# assessment folder to the top of the repo even when the host starts us in one of its
# children.
resolve_git_root() {
    git rev-parse --show-toplevel 2>/dev/null
}

# Resolve the current git branch, anchored to the resolved project root. Uses
# `branch --show-current` (fallback `rev-parse --abbrev-ref HEAD`) — never `.git/HEAD`,
# unreliable in a worktree/submodule. Detached HEAD or a non-git dir yields empty
# (git noise swallowed), which callers treat as an unknown branch.
resolve_branch() {
    local root="$1" branch
    branch="$(git -C "${root}" branch --show-current 2>/dev/null)"
    [ -n "${branch}" ] || branch="$(git -C "${root}" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    [ "${branch}" = "HEAD" ] && branch=""
    printf '%s' "${branch}"
}

# Resolve the user's PROJECT root — NOT the plugin root — as a normalized forward-slash
# path. The host is passed as $1 by each hook.json:
#   - codex: Codex exports no project-dir variable, so we resolve from the git repo root,
#     falling back to $PWD. We deliberately IGNORE CLAUDE_PROJECT_DIR even if it leaked
#     into the environment (e.g. a shell that also ran Claude Code) — honoring a stray
#     Claude var would seed the folder in the wrong project.
#   - claude (default): CLAUDE_PROJECT_DIR is authoritative and outranks git, so a cwd
#     inside a vendored nested repo cannot retarget the folder; git root, then $PWD,
#     back it up.
#
# Echoes empty on total failure — callers no-op rather than risk writing to the
# filesystem root (there is no `set -e` to abort them).
resolve_project_root() {
    local root
    if [ "${1:-}" != "codex" ]; then
        root="$(normalize_dir "${CLAUDE_PROJECT_DIR:-}")" && [ -n "${root}" ] && {
            printf '%s' "${root}"
            return 0
        }
    fi
    root="$(normalize_dir "$(resolve_git_root)")" && [ -n "${root}" ] && {
        printf '%s' "${root}"
        return 0
    }
    normalize_dir "$PWD"
}

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

# Single-pass JSON string escape. Orders of magnitude faster than a char-by-char loop.
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "${s}"
}

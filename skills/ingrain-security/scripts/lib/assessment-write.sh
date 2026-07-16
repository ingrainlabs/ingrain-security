# Shared helpers for the allow-assessment-write hooks (one per host).
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose, and sourcing must not change that. Requires the sibling
# project-root.sh to be sourced first (resolve_project_root), and jq to read the
# payload — without jq every decision degrades to "defer".
#
# Sourced by:
#   hooks/claude/allow-assessment-write   (PreToolUse,        Claude Code)
#   hooks/codex/allow-assessment-write    (PermissionRequest, Codex)
#
# Both hooks answer the same question — "is this write aimed at the assessment file this
# plugin mints, and nothing else?" — from different payloads: Claude names the target in
# `tool_input.file_path`, Codex hands over an apply_patch patch whose envelope names it.
# Everything downstream of that difference — payload parsing, path canonicalization, the
# containment test — is identical, and lives here so the two hosts cannot drift apart on
# the security-critical half.
#
# Every function returns non-zero on anything it cannot represent exactly. Both hooks read
# that as "defer": no opinion, leave the user's normal permission prompt in place. That is
# also what happens when jq is missing (see extract_string): the plugin still works, the
# user just keeps their usual permission prompt on every assessment write.

# Pull a JSON string out of the payload at the given jq path ($2, e.g. `.tool_input.cwd`).
#
# The path is addressed structurally rather than by scanning the raw text for a key, and
# that is the security-critical part. The payload embeds attacker-influenceable text (a
# Write's `content`, an apply_patch body), so a text scan could be fooled: content carrying
# a decoy `"file_path":"…/.ingrain-security/assessment.md"` could win the match while the
# tool actually writes somewhere else, turning these hooks into an auto-approve-anything
# primitive. A decoy at any other position in the tree — inside `content`, or nested one
# level down — simply is not the value at this path, so it cannot be read as one.
#
# `strings` makes the type explicit: a non-string at the path (an object, a number, null)
# yields no output and a non-zero exit, rather than a stringified approximation of itself.
#
# Echoes the decoded value; returns non-zero when jq is unavailable, the payload is not
# valid JSON, or the path holds no string.
extract_string() {
    local payload="$1" path="$2" value
    command -v jq >/dev/null 2>&1 || return 1
    value="$(printf '%s' "${payload}" | jq -e -r "${path} | strings" 2>/dev/null)" || return 1
    printf '%s' "${value}"
}

# Resolve a directory to its PHYSICAL path, with every symlink component followed
# (`pwd -P`, not the logical `pwd` of normalize_dir).
#
# The containment test compares two paths for equality, so both sides must be spelled the
# same way. The logical form cannot guarantee that: the two sides reach us from different
# places — the folder from `resolve_project_root`, the target from the tool call — and
# macOS alone routinely hands out both `/var/…` and `/private/var/…` for one directory.
# Physical resolution also means a symlinked path component cannot smuggle the target out
# of the folder while still comparing equal.
#
# The `cd` runs in a subshell, so this resolves a path without ever moving the caller.
# Callers may invoke it bare, and the containment test cannot be made order-dependent by a
# stray `cd` — which matters because absolutize() resolves a relative path against $PWD.
physical_dir() {
    [ -n "${1:-}" ] || return 1
    (cd "$1" 2>/dev/null && pwd -P)
}

# True when the path is absolute: POSIX (`/…`) or a Windows drive (`C:\…`, `C:/…`), which
# is the form a Git Bash hook is handed on Windows.
is_absolute() {
    case "$1" in
        /*) return 0 ;;
        [A-Za-z]:[/\\]*) return 0 ;;
        *) return 1 ;;
    esac
}

# Make a tool-supplied path absolute and forward-slashed: a drive-letter path arrives with
# backslashes that dirname/cd cannot follow, and a relative path is relative to the cwd the
# host reported. Echoes the result; never fails.
absolutize() {
    local path="$1" cwd="${2:-}"
    if [[ "${path}" =~ ^[A-Za-z]:[/\\] ]]; then
        path="${path//\\//}"
    fi
    is_absolute "${path}" || path="${cwd:-$PWD}/${path}"
    printf '%s' "${path}"
}

# The project's canonical `.ingrain-security/` folder for the given host ($1: claude|codex),
# or non-zero when it is missing or is itself a symlink — either could redirect the write
# outside the tree, the same guard ensure-assessment-dir and assessment-path apply.
canonical_assessment_dir() {
    local dir
    dir="$(resolve_project_root "$1")/.ingrain-security"
    [ -L "${dir}" ] && return 1
    physical_dir "${dir}"
}

# True when the path ($2, absolute) is a file this plugin may write on the user's behalf,
# inside the canonical assessment folder ($1). The grant is deliberately narrow — a path
# qualifies only when ALL hold:
#   - its canonical parent IS the assessment folder: a direct child, not a nested path and
#     not a `..` escape. The parent is canonicalized BEFORE the equality test, so a literal
#     `…/.ingrain-security/../src/app.ts` resolves away rather than passing a prefix check,
#     and equality (not a prefix) means a sibling folder sharing the prefix falls through.
#   - the basename matches one of the minters' naming (`assessment*.md` or `rules*.md` — the
#     assessment file and its org-rules sidecar are the only two files this plugin mints),
#   - the target is not a symlink, which would follow the link out of the folder.
#
# A legitimate target's parent already exists — ensure-assessment-dir, assessment-path and
# rules-path all create the folder — so a parent that cannot be entered is grounds to refuse.
is_assessment_target() {
    local canon_dir="$1" path="$2" parent base canon_parent

    parent="$(dirname "${path}")"
    base="$(basename "${path}")"
    canon_parent="$(physical_dir "${parent}")" || return 1
    [ -n "${canon_parent}" ] || return 1
    [ "${canon_parent}" = "${canon_dir}" ] || return 1

    case "${base}" in
        assessment*.md | rules*.md) ;;
        *) return 1 ;;
    esac

    [ -L "${canon_parent}/${base}" ] && return 1
    return 0
}

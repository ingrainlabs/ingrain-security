# The WRITE grant: is this path a write target this plugin may approve on the user's behalf?
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by hooks/claude/allow-write-assessment (PreToolUse) and hooks/codex/allow-write-assessment
# (PermissionRequest) — Claude names the target in `tool_input.file_path`, Codex in an
# apply_patch envelope; everything downstream of that difference lives here so the two hosts
# cannot drift. Sets no shell options. Needs, sourced first:
#   ../lib/project-root.sh   resolve_project_root
#   ../lib/hook-input.sh     extract_string
#   ../lib/path.sh           physical_dir, absolutize
#
# Every function returns non-zero on anything it cannot represent exactly, which both hooks
# read as "defer" — including when jq is missing.

# The project's canonical `.ingrain-security/` folder for the given host ($1: claude|codex),
# or non-zero when it is missing or is itself a symlink — either could redirect the write
# outside the tree, the same guard ensure-assessment-dir and mint-assessment-path apply.
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
# A legitimate target's parent already exists — ensure-assessment-dir, run/mint-assessment-path
# and run/mint-rules-path all create the folder — so a parent that cannot be entered is grounds
# to refuse.
is_allowed_write_target() {
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

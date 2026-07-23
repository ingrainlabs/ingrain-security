# The WRITE grant. Answers one question — "is this path a write target this plugin may approve
# on the user's behalf?" — and nothing else.
#
# Its sibling is the RUN grant in `run/allow-run-check.sh`, which approves the model *executing*
# one of the scripts in `run/`. Different tool, different payload, different guard: a Bash
# payload never reaches this file, and a Write payload never reaches that one. The two meet at
# exactly one point — `run/mint-assessment-path` computes the path this grant later approves
# writes to — and even that is a naming-convention link, not a provenance check: nothing here
# asks whether a minter produced the file.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose, and sourcing must not change that. Needs, sourced first:
#   ../lib/project-root.sh   resolve_project_root
#   ../lib/hook-input.sh     extract_string  (the hooks read the target with it)
#   ../lib/path.sh      physical_dir, absolutize
#
# Sourced by:
#   hooks/claude/allow-write-assessment   (PreToolUse,        Claude Code)
#   hooks/codex/allow-write-assessment    (PermissionRequest, Codex)
#
# Both hooks answer the same question from different payloads: Claude names the target in
# `tool_input.file_path`, Codex hands over an apply_patch patch whose envelope names it.
# Everything downstream of that difference is identical and lives here, so the two hosts
# cannot drift apart on the security-critical half.
#
# Every function returns non-zero on anything it cannot represent exactly. Both hooks read
# that as "defer": no opinion, leave the user's normal permission prompt in place. That is
# also what happens when jq is missing (see extract_string): the plugin still works, the
# user just keeps their usual permission prompt on every assessment write.

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

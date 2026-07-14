# Shared helpers for the allow-assessment-write hooks (one per host).
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose, and sourcing must not change that. Requires
# hooks/lib/project-root.sh to be sourced first (resolve_project_root).
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
# that as "defer": no opinion, leave the user's normal permission prompt in place.

# Count how many times a key regex occurs in the payload. See extract_string: a value that
# appears more than once is ambiguous and must not be trusted.
count_matches() {
    local haystack="$1" pattern="$2" n=0
    while [[ "${haystack}" =~ ${pattern} ]]; do
        n=$((n + 1))
        haystack="${haystack#*"${BASH_REMATCH[0]}"}"
    done
    printf '%s' "${n}"
}

# Pull a top-level-ish JSON string value out of the raw payload without jq, which is not a
# runtime dependency of this plugin and is not guaranteed on an end user's machine.
#
# The payload embeds attacker-influenceable text (a Write's `content`, an apply_patch
# body), so a naive "first match wins" regex could be fooled: content carrying a decoy
# `"file_path":"…/ingrain-security/assessment.md"` would win the leftmost match while the
# tool actually writes somewhere else, turning these hooks into an auto-approve-anything
# primitive.
#
# The guard is uniqueness: a key that occurs more than once in the payload is ambiguous, so
# we refuse to guess and defer. A decoy therefore costs the user a permission prompt —
# never an unearned approval. (An assessment that happens to quote the literal text
# `"file_path":` degrades the same way, to an ordinary prompt.)
#
# Echoes the unescaped value; returns non-zero when absent, ambiguous, or unparseable.
extract_string() {
    local payload="$1" key="$2" key_re value_re
    key_re="\"${key}\"[[:space:]]*:"
    [ "$(count_matches "${payload}" "${key_re}")" = "1" ] || return 1

    # Value: a JSON string body — any escape pair, or any char that is neither a quote nor
    # a backslash. This is what stops the match at the true closing quote rather than at an
    # escaped one.
    value_re="${key_re}[[:space:]]*\"((\\\\.|[^\"\\\\])*)\""
    [[ "${payload}" =~ ${value_re} ]] || return 1
    json_unescape "${BASH_REMATCH[1]}"
}

# Resolve JSON string escapes. Refuses \uXXXX and any unknown escape by returning
# non-zero — these hooks approve writes, so an input they cannot represent exactly must
# defer rather than be approximated.
json_unescape() {
    local s="$1" len=${#1} out="" i=0 c n
    while [ "${i}" -lt "${len}" ]; do
        c="${s:i:1}"
        if [ "${c}" != "\\" ]; then
            out+="${c}"
            i=$((i + 1))
            continue
        fi
        [ $((i + 1)) -lt "${len}" ] || return 1
        n="${s:i+1:1}"
        if   [ "${n}" = '"' ];  then out+='"'
        elif [ "${n}" = '\' ];  then out+='\'
        elif [ "${n}" = '/' ];  then out+='/'
        elif [ "${n}" = 'n' ];  then out+=$'\n'
        elif [ "${n}" = 'r' ];  then out+=$'\r'
        elif [ "${n}" = 't' ];  then out+=$'\t'
        elif [ "${n}" = 'b' ];  then out+=$'\b'
        elif [ "${n}" = 'f' ];  then out+=$'\f'
        else return 1
        fi
        i=$((i + 2))
    done
    printf '%s' "${out}"
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
physical_dir() {
    [ -n "${1:-}" ] || return 1
    cd "$1" 2>/dev/null && pwd -P
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

# The project's canonical `ingrain-security/` folder for the given host ($1: claude|codex),
# or non-zero when it is missing or is itself a symlink — either could redirect the write
# outside the tree, the same guard ensure-assessment-dir and assessment-path apply.
canonical_assessment_dir() {
    local dir
    dir="$(resolve_project_root "$1")/ingrain-security"
    [ -L "${dir}" ] && return 1
    physical_dir "${dir}"
}

# True when the path ($2, absolute) is a file this plugin may write on the user's behalf,
# inside the canonical assessment folder ($1). The grant is deliberately narrow — a path
# qualifies only when ALL hold:
#   - its canonical parent IS the assessment folder: a direct child, not a nested path and
#     not a `..` escape. The parent is canonicalized BEFORE the equality test, so a literal
#     `…/ingrain-security/../src/app.ts` resolves away rather than passing a prefix check,
#     and equality (not a prefix) means a sibling folder sharing the prefix falls through.
#   - the basename matches the minter's naming (`assessment*.md`),
#   - the target is not a symlink, which would follow the link out of the folder.
#
# A legitimate target's parent already exists — ensure-assessment-dir and assessment-path
# both create the folder — so a parent that cannot be entered is itself grounds to refuse.
is_assessment_target() {
    local canon_dir="$1" path="$2" parent base canon_parent

    parent="$(dirname "${path}")"
    base="$(basename "${path}")"
    canon_parent="$(physical_dir "${parent}")" || return 1
    [ -n "${canon_parent}" ] || return 1
    [ "${canon_parent}" = "${canon_dir}" ] || return 1

    case "${base}" in
        assessment*.md) ;;
        *) return 1 ;;
    esac

    [ -L "${canon_parent}/${base}" ] && return 1
    return 0
}

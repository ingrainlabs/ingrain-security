# Shared helpers for the hooks that decide about a file write: the two allow-assessment-write
# hooks (one per host) and the review gate that blocks an unreviewed one.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose, and sourcing must not change that.
#
# Flat: every function takes what it needs as arguments, so this file requires no sibling lib.
# Composition — resolving the project root, naming the folder — belongs to the hook that has
# both. jq is the one external requirement; without it every decision degrades to "defer".
#
# Sourced by:
#   hooks/claude/allow-assessment-write   (PreToolUse,        Claude Code)
#   hooks/codex/allow-assessment-write    (PermissionRequest, Codex)
#   hooks/scripts/require-review-before-write  (PreToolUse, both hosts — the review gate)
#
# All three consumers answer the same question — "is this write aimed at the assessment file
# this plugin mints, and nothing else?" — from different payloads: Claude names the target in
# `tool_input.file_path`, Codex hands over an apply_patch patch whose envelope names it.
# Everything downstream of that difference — payload parsing, path canonicalization, the
# containment test — is identical, and lives here so the hosts cannot drift apart on
# the security-critical half.
#
# They act on the SAME answer in OPPOSITE directions, which is the strongest reason this is one
# file: an allow-hook lifts the prompt when the answer is yes, the gate stands aside when the
# answer is yes and blocks when it is no. A second copy drifting would not merely widen a grant
# — it would let one hook approve a write another had decided was unreviewed code.
#
# Every function returns non-zero on anything it cannot represent exactly. Every consumer reads
# that as "defer": no opinion, leave the host's normal flow in place. That is also what happens
# when jq is missing (see extract_string): the plugin still works, the user just keeps their
# usual permission prompt on every assessment write, and the gate stops blocking.

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

# Canonicalize the assessment folder ($1, absolute), or return non-zero when it is missing or
# is itself a symlink — either could redirect the write outside the tree, the same guard
# ensure-assessment-dir and assessment-mint apply.
#
# Takes the folder rather than the host: resolving a project root and knowing the folder's
# name belong to two other libs, and reaching into them from here is what made this file
# require siblings sourced first. The hook composes those two and passes the result.
canonical_assessment_dir() {
    local dir="$1"
    [ -n "${dir}" ] || return 1
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
#   - the basename matches the minter's naming (`assessment*.md` — one artifact carries the
#     whole analysis, so it is the only file this plugin mints),
#   - the target is not a symlink, which would follow the link out of the folder.
#
# A legitimate target's parent already exists — ensure-assessment-dir and assessment-mint
# both create the folder — so a parent that cannot be entered is grounds to refuse.
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

# True when the path LOOKS like an assessment artifact — any `.ingrain-security/assessment*.md`,
# wherever it sits — without requiring it to be the folder the caller's project root resolves to.
#
# The permissive twin of `is_assessment_target`, and the two exist because they answer OPPOSITE
# questions. `is_assessment_target` decides whether to AUTO-APPROVE a write: a false yes hands
# out a grant, so it must be exact, and equality against the canonical folder is the point of it.
# This one decides whether to WITHHOLD A BLOCK: a false yes merely declines to interfere, while a
# false NO blocks the review from writing its own artifact — and that artifact is what the block
# exists to send the agent to produce. The error directions are reversed, so the strictness is.
#
# Sharing the strict test between them was a real defect: a worker dispatched against an
# assessment outside the caller's resolved root — a temp tree, a second checkout, a nested repo,
# a git worktree — had its write reclassified as code and denied, deadlocking the very review the
# denial routes to. It also made the gate's own promise that assessment writes are never blocked
# false in exactly the cases nobody would test by hand.
#
# Purely lexical, and deliberately so: it touches no filesystem, needs no project root, and
# therefore cannot be wrong about a path it was never given the context to resolve.
looks_like_assessment_path() {
    local path="$1"
    [ -n "${path}" ] || return 1
    [ "$(basename "$(dirname "${path}")")" = ".ingrain-security" ] || return 1
    case "$(basename "${path}")" in
        assessment*.md) return 0 ;;
        *) return 1 ;;
    esac
}

# Collect the paths an apply_patch command touches, one per line, or return non-zero when
# the command is anything other than a pure add/update patch.
#
# Lives here rather than beside one caller because BOTH Codex-side hooks need it and they
# reach opposite verdicts from it: the allow-hook approves a patch whose every target is the
# assessment file, the review gate blocks one whose targets are not. Two copies of an
# envelope parser drifting apart would mean the same patch reading as two different sets of
# files, which is the one disagreement neither hook could detect.
#
# The patch body is attacker-influenceable text, so the parse keys on structure the body
# cannot forge: envelope lines sit at column 0, while every line of a hunk is prefixed
# (` `, `+`, `-`). A decoy `*** Add File: /etc/passwd` written INTO an assessment is
# therefore a `+`-prefixed content line, and is ignored — as it should be, since what the
# assessment says is none of this parse's business.
#
# Anything unrecognized is a refusal, not a skip: an envelope verb this parser does not know
# is exactly the case where a caller must not be guessing.
collect_patch_paths() {
    local patch="$1" line region="prefix" count=0 opener_re
    local saw_opener=0 terminator="" closed=0

    # `apply_patch`, optionally opening a heredoc: `apply_patch <<'EOF'`, `<<-"PATCH"`, …
    # Group 2 captures the delimiter, so the suffix can be held to the one actually opened.
    opener_re="^apply_patch([[:space:]]+<<-?[\"']?([A-Za-z_][A-Za-z0-9_]*)[\"']?)?[[:space:]]*\$"

    while IFS= read -r line; do
        line="${line%$'\r'}"

        case "${region}" in
            # Before the patch: ONE wrapper line, and only the wrapper Codex may put there —
            # bare `apply_patch`, or `apply_patch <<'EOF'`. Nothing else, which is what stops
            # a chained shell command from riding along on the patch's decision.
            prefix)
                [ -z "${line}" ] && continue
                if [ "${line}" = "*** Begin Patch" ]; then
                    region="body"
                    continue
                fi
                [ "${saw_opener}" -eq 0 ] || return 1
                [[ "${line}" =~ ${opener_re} ]] || return 1
                saw_opener=1
                terminator="${BASH_REMATCH[2]}"
                ;;

            body)
                if [ "${line}" = "*** End Patch" ]; then
                    region="suffix"
                    continue
                fi
                # A hunk's own lines are prefixed, so an unprefixed `*** …` is an envelope
                # line and must be one this parser understands.
                case "${line}" in
                    '*** Add File: '* | '*** Update File: '*)
                        printf '%s\n' "${line#*File: }"
                        count=$((count + 1))
                        ;;
                    '*** End of File') ;;
                    '***'*) return 1 ;;
                esac
                ;;

            # After the patch: EXACTLY the delimiter the wrapper opened, once, and nothing
            # after it. A wrapper that opened no heredoc leaves nothing legal here at all —
            # otherwise a bareword line like `reboot`, which needs no argument and so carries
            # none of the spaces the envelope check would catch, is a second shell command
            # riding along on the patch's decision.
            suffix)
                [ -z "${line}" ] && continue
                [ -n "${terminator}" ] || return 1
                [ "${closed}" -eq 0 ] || return 1
                [ "${line}" = "${terminator}" ] || return 1
                closed=1
                ;;
        esac
    done < <(printf '%s\n' "${patch}")

    # A truncated patch, or one that touches nothing, is not something to act on.
    [ "${region}" = "suffix" ] || return 1
    [ "${count}" -gt 0 ] || return 1
    # Likewise a heredoc that was opened and never closed: a truncated command, not a patch.
    [ -z "${terminator}" ] || [ "${closed}" -eq 1 ] || return 1
}

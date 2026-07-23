# The RUN grant. Answers one question — "is this shell command nothing but a bare run of one of
# the scripts in this folder?" — and nothing else. Holds the allowlist, the parser that safely
# splits an untrusted command into words, and the predicates that answer for each shape a host
# can present.
#
# Its sibling is the WRITE grant in `write/allow-write-check.sh`, which approves the model
# *writing* the assessment file. Different tool, different payload, different guard: a Write
# payload never reaches this file, and a Bash payload never reaches that one.
#
# Declares its dialect here because it is sourced, not executed. It lives in `run/` beside the
# scripts it guards, but it is NOT one of them: `.sh` means sourced, and it is absent from
# RUNNABLE_SCRIPTS, so `bash run/allow-run-check.sh` defers like any other non-runnable path.
# shellcheck shell=bash
#
# Sourced by hooks/claude/allow-run-script (PreToolUse) and its Codex twin
# hooks/codex/allow-run-script (PermissionRequest). Sets no shell options. Needs, sourced first:
#   ../lib/hook-input.sh   extract_string_array  (the Codex hook reads an argv array with it)
#   ../lib/path.sh    physical_dir, absolutize
#
# Every function returns non-zero on anything it cannot represent exactly, which both hooks
# read as "defer".

# The scripts this grant covers, by EXACT basename; arguments uninspected. All four are run by
# the ORCHESTRATOR only — subagent workers hold no shell — and all four are injected into every
# session as ready-to-run commands by hooks/start/session-start:
#
#   mint-assessment-path   mints assessment_abs, the review's one write target · writes .ingrain-security/ only
#   mint-rules-path        mints rules_abs, the org-rules sidecar              · writes .ingrain-security/ only
#   resolve-branch-delta   resolves the diff basis: base_ref/diff_ref/delta_empty · READ-ONLY
#   validate-assessment    schema-checks the assessment file after every write    · READ-ONLY
#
# That last column is the grant's security argument. Approving a command approves everything it
# does, unreviewed by any path check — so the set is fixed, resolved against this folder, and
# holds only scripts that either report or write inside `.ingrain-security/`. None of them
# touches the user's code.
RUNNABLE_SCRIPTS='mint-assessment-path mint-rules-path resolve-branch-delta validate-assessment'

# Every character a legitimate invocation can contain. Substitution, chaining, redirection,
# globbing, expansion, comments, newlines and `C:\…` paths all need one outside it.
SAFE_COMMAND_CHARS="A-Za-z0-9_.,:=+@%/ \t'\"-"

# True when the string holds a character outside SAFE_COMMAND_CHARS. The `|` sentinel
# keeps a TRAILING disallowed character visible, which command substitution would otherwise
# strip along with the newline.
has_unexpected_char() {
    local rest
    rest="$(printf '%s|' "$1" | tr -d "${SAFE_COMMAND_CHARS}")"
    [ "${rest}" != "|" ]
}

# Split a command string into words onto COMMAND_TOKENS, honoring `'` and `"` as plain
# delimiters. Run has_unexpected_char FIRST, never this alone. Returns non-zero on an
# unterminated quote or an empty command.
tokenize_command() {
    local s="$1" len i ch state="plain" token="" started=0

    COMMAND_TOKENS=()
    len="${#s}"

    for ((i = 0; i < len; i++)); do
        ch="${s:i:1}"
        case "${state}" in
            plain)
                case "${ch}" in
                    ' ' | $'\t')
                        if [ "${started}" -eq 1 ]; then
                            COMMAND_TOKENS+=("${token}")
                            token=""
                            started=0
                        fi
                        ;;
                    "'")
                        state="single"
                        started=1
                        ;;
                    '"')
                        state="double"
                        started=1
                        ;;
                    *)
                        token+="${ch}"
                        started=1
                        ;;
                esac
                ;;
            single)
                if [ "${ch}" = "'" ]; then state="plain"; else token+="${ch}"; fi
                ;;
            double)
                if [ "${ch}" = '"' ]; then state="plain"; else token+="${ch}"; fi
                ;;
        esac
    done

    [ "${state}" = "plain" ] || return 1
    [ "${started}" -eq 1 ] && COMMAND_TOKENS+=("${token}")
    [ "${#COMMAND_TOKENS[@]}" -gt 0 ]
}

# This folder — the plugin's `scripts/run/` — physically resolved from the hook's location
# ($1 = plugin root). Derived, never hardcoded, so the grant follows the installed copy.
# The folder IS the boundary: a script qualifies only when its canonical parent is this dir.
runnable_scripts_dir() {
    physical_dir "$1/skills/ingrain-security/scripts/run"
}

# True when the argv ($3…) is a bare run of one of the runnable scripts, resolved against the
# run dir ($1) and the host's cwd ($2). Accepted: `<script> [args…]` and
# `bash <script> [args…]`; an interpreter flag (`bash -c …`) is refused. The script's
# canonical parent must EQUAL the run dir, and the name must not be a symlink.
is_allowed_run_argv() {
    local run_dir="$1" cwd="$2" script base parent
    shift 2

    [ "$#" -ge 1 ] || return 1
    case "$(basename "$1")" in
        bash | sh | bash.exe | sh.exe)
            shift
            [ "$#" -ge 1 ] || return 1
            ;;
    esac

    script="$1"
    case "${script}" in
        -*) return 1 ;;
    esac

    base="$(basename "${script}")"
    case " ${RUNNABLE_SCRIPTS} " in
        *" ${base} "*) ;;
        *) return 1 ;;
    esac

    script="$(absolutize "${script}" "${cwd}")"
    parent="$(physical_dir "$(dirname "${script}")")" || return 1
    [ -n "${parent}" ] || return 1
    [ "${parent}" = "${run_dir}" ] || return 1

    [ -L "${parent}/${base}" ] && return 1
    [ -f "${parent}/${base}" ]
}

# True when the command STRING ($3) is a bare run of one of the runnable scripts — what Claude
# Code sends, and what Codex wraps in `bash -lc`.
is_allowed_run_command() {
    local run_dir="$1" cwd="$2" command="$3"

    [ -n "${command}" ] || return 1
    has_unexpected_char "${command}" && return 1
    tokenize_command "${command}" || return 1
    is_allowed_run_argv "${run_dir}" "${cwd}" "${COMMAND_TOKENS[@]}"
}

# True when the argv ($3…) is a bare run of one of the runnable scripts, in either shape a
# shell tool presents: an already-split `[bash] <script> [args…]`, or a `bash -lc "<command>"`
# wrapper of exactly three elements, whose string goes back through the string parser. An
# already-split argv needs no SAFE_COMMAND_CHARS check — nothing re-parses it.
is_allowed_run_exec() {
    local run_dir="$1" cwd="$2"
    shift 2

    if [ "$#" -eq 3 ]; then
        case "$(basename "$1")" in
            bash | sh | bash.exe | sh.exe)
                case "$2" in
                    -*c)
                        is_allowed_run_command "${run_dir}" "${cwd}" "$3"
                        return
                        ;;
                esac
                ;;
        esac
    fi

    is_allowed_run_argv "${run_dir}" "${cwd}" "$@"
}

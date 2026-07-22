# Shared helpers for the allow-script-run hooks (one per host).
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose, and sourcing must not change that. Requires the sibling
# assessment-write.sh to be sourced first (extract_string, absolutize, physical_dir).
#
# Sourced by:
#   hooks/claude/allow-script-run   (PreToolUse,        Claude Code)
#   hooks/codex/allow-script-run    (PermissionRequest, Codex)
#
# Both hooks answer the same question — "is this shell command nothing but a run of one of
# this plugin's own read-only scripts?" — from different payloads: Claude always hands over
# a command STRING, Codex may hand over an argv ARRAY instead. Everything downstream of
# that difference — the character allowlist, tokenization, the containment test — is
# identical and lives here, so the two hosts cannot drift apart on the security-critical
# half.
#
# Every function returns non-zero on anything it cannot represent exactly. Both hooks read
# that as "defer": no opinion, leave the user's normal permission prompt in place.

# The scripts this plugin may run on the user's behalf, by EXACT basename. All four are
# read-only — they mint paths, read git, and validate markdown — which is why their
# arguments need no inspection: the worst a hostile argument buys is a file read the agent
# could already perform with the Read tool. Nothing else in scripts/ is listed, so the
# sourceable `lib/*.sh` helpers stay outside the grant.
SCRIPT_RUN_ALLOWED='assessment-path rules-path branch-diff validate-assessment'

# Every character a legitimate invocation of those scripts can contain: word characters,
# path punctuation, quotes, and the space that separates arguments.
#
# An ALLOWLIST rather than a metacharacter blocklist, because the failure modes are not
# symmetric — a metacharacter this file forgot to list would be approved, whereas an
# ordinary character it forgot merely defers to the usual prompt. It also covers the whole
# class in one test: command substitution, chaining, redirection, globbing, expansion,
# comments and embedded newlines all require a character that is not on this list.
#
# Windows-native paths (`C:\…`) are deferred by the excluded backslash. That is
# deliberate: the escape it introduces inside double quotes would make the tokenizer below
# a second, subtler parser of the same string, and a prompt on Windows is a smaller cost
# than a parse the shell disagrees with.
SCRIPT_RUN_ALLOWED_CHARS="A-Za-z0-9_.,:=+@%/ \t'\"-"

# True when the string holds a character outside SCRIPT_RUN_ALLOWED_CHARS — i.e. when it
# cannot be a bare run of one of our scripts and must fall through to the normal prompt.
#
# The `|` sentinel is what makes a TRAILING disallowed character visible: command
# substitution strips trailing newlines, so a command ending in `\nid` would otherwise come
# back with an empty leftover and read as clean. Terminating the stream with a character
# `tr` cannot delete puts every leftover strictly before it.
has_unexpected_char() {
    local rest
    rest="$(printf '%s|' "$1" | tr -d "${SCRIPT_RUN_ALLOWED_CHARS}")"
    [ "${rest}" != "|" ]
}

# Split a command string into words on SCRIPT_RUN_TOKENS, honoring `'` and `"` as plain
# delimiters.
#
# Treating quotes as purely literal is only sound because has_unexpected_char has already
# rejected `$`, a backtick and a backslash — with those gone, bash performs no expansion
# and no escaping inside either quote style, so this split and the shell's own agree
# character for character. Call the two in that order, never this one alone.
#
# Returns non-zero on an unterminated quote or an empty command: a string this cannot
# represent exactly is one to defer on, not to guess at.
tokenize_command() {
    local s="$1" len i ch state="plain" token="" started=0

    SCRIPT_RUN_TOKENS=()
    len="${#s}"

    for ((i = 0; i < len; i++)); do
        ch="${s:i:1}"
        case "${state}" in
            plain)
                case "${ch}" in
                    ' ' | $'\t')
                        if [ "${started}" -eq 1 ]; then
                            SCRIPT_RUN_TOKENS+=("${token}")
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
    [ "${started}" -eq 1 ] && SCRIPT_RUN_TOKENS+=("${token}")
    [ "${#SCRIPT_RUN_TOKENS[@]}" -gt 0 ]
}

# The plugin's own scripts/ directory, physically resolved from the hook's location ($1 =
# plugin root). Derived, never hardcoded: the grant then follows the installed copy of the
# plugin, and a second checkout elsewhere on disk is not covered by it.
script_run_dir() {
    physical_dir "$1/skills/ingrain-security/scripts"
}

# True when the argv ($3…) is a bare run of one allowlisted script, resolved against the
# scripts dir ($1) and the host's cwd ($2).
#
# Accepted shapes are `<script> [args…]` and `bash <script> [args…]` — the form the skill
# documents. An interpreter flag (`bash -c …`) is refused: its argument is a fresh command
# string this function never parsed, so approving it would approve whatever it contains.
#
# The script's canonical PARENT must EQUAL the scripts dir. Canonicalizing before the test
# resolves any `..` away rather than letting it slip past a prefix check, and equality (not
# a prefix) keeps a sibling directory sharing the prefix out. The final symlink test stops
# an allowlisted NAME inside that directory from standing in for a file outside it.
is_allowed_script_argv() {
    local scripts_dir="$1" cwd="$2" script base parent
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
    case " ${SCRIPT_RUN_ALLOWED} " in
        *" ${base} "*) ;;
        *) return 1 ;;
    esac

    script="$(absolutize "${script}" "${cwd}")"
    parent="$(physical_dir "$(dirname "${script}")")" || return 1
    [ -n "${parent}" ] || return 1
    [ "${parent}" = "${scripts_dir}" ] || return 1

    [ -L "${parent}/${base}" ] && return 1
    [ -f "${parent}/${base}" ]
}

# True when the command STRING ($3) is a bare run of one allowlisted script — the form
# Claude Code always sends, and the one Codex wraps in `bash -lc`.
is_allowed_script_command() {
    local scripts_dir="$1" cwd="$2" command="$3"

    [ -n "${command}" ] || return 1
    has_unexpected_char "${command}" && return 1
    tokenize_command "${command}" || return 1
    is_allowed_script_argv "${scripts_dir}" "${cwd}" "${SCRIPT_RUN_TOKENS[@]}"
}

# True when the argv ($3…) is a bare run of one allowlisted script, in EITHER argv shape a
# shell tool can present: an already-split `[bash] <script> [args…]`, or the `bash -lc
# "<command>"` wrapper Codex routinely builds, whose single string argument is handed back
# to the string parser rather than trusted.
#
# The wrapper form is recognized only at exactly three elements — interpreter, one `-…c`
# flag, one command — so a `bash -lc <cmd> <extra…>` this function cannot account for
# defers rather than being approved on its prefix.
#
# An already-split argv needs no character allowlist: nothing re-parses it, so a `;` in an
# argument is an ordinary character on its way to a read-only script, not a chain operator.
is_allowed_script_exec() {
    local scripts_dir="$1" cwd="$2"
    shift 2

    if [ "$#" -eq 3 ]; then
        case "$(basename "$1")" in
            bash | sh | bash.exe | sh.exe)
                case "$2" in
                    -*c)
                        is_allowed_script_command "${scripts_dir}" "${cwd}" "$3"
                        return
                        ;;
                esac
                ;;
        esac
    fi

    is_allowed_script_argv "${scripts_dir}" "${cwd}" "$@"
}

# Read a JSON array of strings out of the payload ($1) at the given jq path ($2) onto
# SCRIPT_RUN_ARGV.
#
# Addressed structurally, for the reason extract_string documents: the payload embeds
# attacker-influenceable text, and a text scan of it could be fooled into reading a decoy
# as the command actually being run.
#
# Elements are separated on NUL, so an argument containing a newline stays one argument
# instead of silently splitting into two. Returns non-zero when jq is unavailable, the
# payload is not valid JSON, or the path holds anything but a non-empty array of strings.
extract_string_array() {
    local payload="$1" path="$2" program element
    command -v jq >/dev/null 2>&1 || return 1

    # NUL-terminate each element INSIDE jq and read the stream directly: bash drops NUL
    # bytes from a variable, so routing this through a command substitution would silently
    # join the arguments into one.
    program="${path} | if type == \"array\" and length > 0 and (map(type == \"string\") | all)"
    program="${program} then .[] + \"\\u0000\" else empty end"

    SCRIPT_RUN_ARGV=()
    while IFS= read -r -d '' element; do
        SCRIPT_RUN_ARGV+=("${element}")
    done < <(printf '%s' "${payload}" | jq -j -e "${program}" 2>/dev/null)

    [ "${#SCRIPT_RUN_ARGV[@]}" -gt 0 ]
}


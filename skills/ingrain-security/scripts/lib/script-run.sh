# Shared helpers for the allow-script-run hooks: is this shell command nothing but a run
# of one of this plugin's own read-only scripts?
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by hooks/claude/allow-script-run (PreToolUse) and hooks/codex/allow-script-run
# (PermissionRequest). Sets no shell options; needs assessment-write.sh sourced first
# (extract_string, absolutize, physical_dir). Every function returns non-zero on anything
# it cannot represent exactly, which both hooks read as "defer".

# The scripts this plugin may run, by EXACT basename. All read-only, arguments uninspected.
SCRIPT_RUN_ALLOWED='assessment-path rules-path branch-diff validate-assessment'

# Every character a legitimate invocation can contain. Substitution, chaining, redirection,
# globbing, expansion, comments, newlines and `C:\…` paths all need one outside it.
SCRIPT_RUN_ALLOWED_CHARS="A-Za-z0-9_.,:=+@%/ \t'\"-"

# True when the string holds a character outside SCRIPT_RUN_ALLOWED_CHARS. The `|` sentinel
# keeps a TRAILING disallowed character visible, which command substitution would otherwise
# strip along with the newline.
has_unexpected_char() {
    local rest
    rest="$(printf '%s|' "$1" | tr -d "${SCRIPT_RUN_ALLOWED_CHARS}")"
    [ "${rest}" != "|" ]
}

# Split a command string into words on SCRIPT_RUN_TOKENS, honoring `'` and `"` as plain
# delimiters. Run has_unexpected_char FIRST, never this alone. Returns non-zero on an
# unterminated quote or an empty command.
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
# plugin root). Derived, never hardcoded, so the grant follows the installed copy.
script_run_dir() {
    physical_dir "$1/skills/ingrain-security/scripts"
}

# True when the argv ($3…) is a bare run of one allowlisted script, resolved against the
# scripts dir ($1) and the host's cwd ($2). Accepted: `<script> [args…]` and
# `bash <script> [args…]`; an interpreter flag (`bash -c …`) is refused. The script's
# canonical parent must EQUAL the scripts dir, and the name must not be a symlink.
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

# True when the command STRING ($3) is a bare run of one allowlisted script — what Claude
# Code sends, and what Codex wraps in `bash -lc`.
is_allowed_script_command() {
    local scripts_dir="$1" cwd="$2" command="$3"

    [ -n "${command}" ] || return 1
    has_unexpected_char "${command}" && return 1
    tokenize_command "${command}" || return 1
    is_allowed_script_argv "${scripts_dir}" "${cwd}" "${SCRIPT_RUN_TOKENS[@]}"
}

# True when the argv ($3…) is a bare run of one allowlisted script, in either shape a shell
# tool presents: an already-split `[bash] <script> [args…]`, or a `bash -lc "<command>"`
# wrapper of exactly three elements, whose string goes back through the string parser. An
# already-split argv needs no character allowlist — nothing re-parses it.
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

# Read a JSON array of strings out of the payload ($1) at jq path ($2) onto SCRIPT_RUN_ARGV,
# separated on NUL so an argument containing a newline stays one argument. Returns non-zero
# when jq is unavailable, the payload is not valid JSON, or the path holds anything but a
# non-empty array of strings.
extract_string_array() {
    local payload="$1" path="$2" program element
    command -v jq >/dev/null 2>&1 || return 1

    # NUL-terminate inside jq and read the stream directly: bash drops NUL bytes from a
    # variable, so a command substitution here would join the arguments into one.
    program="${path} | if type == \"array\" and length > 0 and (map(type == \"string\") | all)"
    program="${program} then .[] + \"\\u0000\" else empty end"

    SCRIPT_RUN_ARGV=()
    while IFS= read -r -d '' element; do
        SCRIPT_RUN_ARGV+=("${element}")
    done < <(printf '%s' "${payload}" | jq -j -e "${program}" 2>/dev/null)

    [ "${#SCRIPT_RUN_ARGV[@]}" -gt 0 ]
}


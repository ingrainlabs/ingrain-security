# Reading the hook input — the JSON document the host pipes to a hook on stdin, describing the
# tool call it is about to run. SHARED by both grants: `write/allow-write-check.sh` and
# `run/allow-run-check.sh` both start here, then hand what they read to their own test.
# Holds accessors only; nothing here decides anything.
#
# Pairs with `path.sh`, which canonicalizes the paths these accessors return.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced by all four allow hooks (two grants × two hosts). Sets no shell options: every
# caller runs `set -uo pipefail` WITHOUT `-e` on purpose, and sourcing must not change that.
#
# Needs jq. Without it every accessor fails, and each hook reads that as "defer": the plugin
# still works, the user just keeps their usual permission prompt.

# Pull a JSON string out of the payload at the given jq path ($2, e.g. `.tool_input.cwd`).
#
# The path is addressed structurally rather than by scanning the raw text for a key, and
# that is the security-critical part. The payload embeds attacker-influenceable text (a
# Write's `content`, an apply_patch body, a shell command), so a text scan could be fooled:
# content carrying a decoy `"file_path":"…/.ingrain-security/assessment.md"` could win the
# match while the tool actually writes somewhere else, turning these hooks into an
# auto-approve-anything primitive. A decoy at any other position in the tree — inside
# `content`, or nested one level down — simply is not the value at this path, so it cannot
# be read as one.
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

# Read a JSON array of strings out of the payload ($1) at jq path ($2) onto PAYLOAD_ARGV,
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

    PAYLOAD_ARGV=()
    while IFS= read -r -d '' element; do
        PAYLOAD_ARGV+=("${element}")
    done < <(printf '%s' "${payload}" | jq -j -e "${program}" 2>/dev/null)

    [ "${#PAYLOAD_ARGV[@]}" -gt 0 ]
}

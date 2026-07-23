# Accessors for the hook input — the JSON the host pipes to a hook on stdin. Shared by both
# grants; decides nothing itself.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by all four allow hooks. Sets no shell options. Needs jq — without it every accessor
# fails, which each hook reads as "defer".

# Pull a JSON string out of the payload at the given jq path ($2, e.g. `.tool_input.cwd`).
#
# Addressed structurally by jq path, never by scanning the raw text for a key — the
# security-critical part. The payload embeds attacker-influenceable text (a Write's `content`,
# an apply_patch body), so a text scan could be won by a decoy
# `"file_path":"…/.ingrain-security/assessment.md"` while the tool writes elsewhere, turning
# these hooks into an auto-approve-anything primitive. A decoy at any other position simply is
# not the value at this path.
#
# `strings` makes the type explicit: a non-string at the path yields no output and a non-zero
# exit, not a stringified approximation.
#
# Echoes the decoded value. Returns non-zero only when jq is unavailable: an invalid payload,
# an absent path, or a non-string at the path all echo nothing and return zero, so callers
# must test the result for emptiness rather than the exit status. Every call site does — see
# the `[ -n … ]` guards in the four hooks, and `is_allowed_run_command` in
# ../run/lib/allow-run-check.sh for the one that is checked a frame down.
extract_string() {
    local payload="$1" path="$2"
    command -v jq >/dev/null 2>&1 || return 1

    # The substitution is folded into `local` deliberately. `local` reports its own exit
    # status, so the `|| return 1` below never fires and jq's failure surfaces as empty
    # output instead — the emptiness checks at the call sites carry the defer decision.
    # shellcheck disable=SC2155
    local payload="$(printf '%s' "${payload}" | jq -e -r "${path} | strings" 2>/dev/null)" || return 1
    printf '%s' "${payload}"
}

# Read a JSON array of strings out of the payload ($1) at jq path ($2) onto PAYLOAD_ARGV,
# separated on NUL so an argument containing a newline stays one argument. Returns non-zero
# when jq is unavailable, the payload is not valid JSON, or the path holds anything but a
# non-empty array of strings.
extract_string_array() {
    local payload="$1" path="$2"
    command -v jq >/dev/null 2>&1 || return 1

    # NUL-terminate inside jq and read the stream directly: bash drops NUL bytes from a
    # variable, so a command substitution here would join the arguments into one.
    local program
    program="${path} | if type == \"array\" and length > 0 and (map(type == \"string\") | all)"
    program="${program} then .[] + \"\\u0000\" else empty end"

    local element
    PAYLOAD_ARGV=()
    while IFS= read -r -d '' element; do
        PAYLOAD_ARGV+=("${element}")
    done < <(printf '%s' "${payload}" | jq -j -e "${program}" 2>/dev/null)

    [ "${#PAYLOAD_ARGV[@]}" -gt 0 ]
}

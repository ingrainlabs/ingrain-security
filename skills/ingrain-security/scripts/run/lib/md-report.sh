# The two report emitters: the human-readable violation list on stderr and the machine
# verdict on stdout. The only file that formats output; every check above it only records.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by run/validate-assessment, last of the validator's five files. Sets no shell
# options; needs, sourced first:
#   ../../lib/project-root.sh   escape_for_json
#   lib/md-primitives.sh        VLD_ERR_LINES, VLD_ERR_MSGS, VLD_LENIENT
#
# Written for bash 3.2: no associative arrays, no `mapfile`, no `${var,,}`.

# Print every collected violation to stderr, one per line, as `<path>:<line>: <message>`
# (line 0 — a whole-file violation — prints without a line number).
vld_report_stderr() {
    local path="$1" i
    for ((i = 0; i < ${#VLD_ERR_LINES[@]}; i++)); do
        if [ "${VLD_ERR_LINES[i]}" -eq 0 ]; then
            printf '%s: %s\n' "${path}" "${VLD_ERR_MSGS[i]}" >&2
        else
            printf '%s:%s: %s\n' "${path}" "${VLD_ERR_LINES[i]}" "${VLD_ERR_MSGS[i]}" >&2
        fi
    done
}

# Print the machine-readable result as ONE JSON object on stdout, the same shape the
# sibling scripts emit.
vld_report_json() {
    local path="$1"

    local valid
    if [ "${#VLD_ERR_LINES[@]}" -eq 0 ]; then valid="true"; else valid="false"; fi

    printf '{"path":"%s","lenient":%s,"valid":%s,"error_count":%s,"errors":[' \
        "$(escape_for_json "${path}")" "${VLD_LENIENT}" "${valid}" "${#VLD_ERR_LINES[@]}"

    local i
    for ((i = 0; i < ${#VLD_ERR_LINES[@]}; i++)); do
        [ "${i}" -gt 0 ] && printf ','
        printf '{"line":%s,"message":"%s"}' \
            "${VLD_ERR_LINES[i]}" "$(escape_for_json "${VLD_ERR_MSGS[i]}")"
    done
    printf ']}\n'
}

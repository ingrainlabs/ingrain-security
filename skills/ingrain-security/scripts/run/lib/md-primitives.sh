# The base layer every other validator file builds on: the two mode constants, the error
# collector violations accumulate into, and the string predicates the checks are written in.
# Knows nothing about markdown, sections or the assessment schema.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by run/validate-assessment, first of the validator's five files. Sets no shell
# options and needs nothing sourced before it.
#
# Written for bash 3.2 (the system bash on macOS): no associative arrays, no `mapfile`,
# no `${var,,}`.

# Values a column may hold when it has not been filled yet. The reference file spells an
# unset cell as the em dash; an empty cell means the same thing.
VLD_UNSET_DASH='—'

# The file is still being written: waive the checks that can only hold once it is complete
# — missing sections, unfilled fields, unwritten tables, unsorted rows. Everything already
# on the page is still checked. Set by the caller from `--lenient`; initialized here so
# every check reads a defined value under `set -u`.
#
# Declared here as the base layer's mode flag, but read only by the files above it
# (md-document.sh, md-fields.sh) — which ShellCheck, linting one file at a time, cannot see.
# shellcheck disable=SC2034
VLD_LENIENT="false"

# --- error collection -------------------------------------------------------------

# Errors accumulate in two parallel arrays rather than aborting at the first one.
VLD_ERR_LINES=()
VLD_ERR_MSGS=()

vld_reset() {
    VLD_ERR_LINES=()
    VLD_ERR_MSGS=()
}

# Record one violation. $1 the 1-based line it sits on (0 when it is the file as a
# whole, e.g. a missing section), $2 the message.
vld_error() {
    VLD_ERR_LINES+=("$1")
    VLD_ERR_MSGS+=("$2")
}

vld_error_count() {
    printf '%s' "${#VLD_ERR_LINES[@]}"
}

# --- string primitives ------------------------------------------------------------

# Strip leading and trailing whitespace.
vld_trim() {
    local s="$1"
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    printf '%s' "${s}"
}

vld_lower() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# True when the (already trimmed) value $1 equals one of the remaining arguments,
# compared case-insensitively.
vld_in_list() {
    local value
    value="$(vld_lower "$1")"
    shift

    local candidate
    for candidate in "$@"; do
        [ "${value}" = "$(vld_lower "${candidate}")" ] && return 0
    done
    return 1
}

# True when the value is an unfilled cell: empty, or the em dash the templates use.
vld_is_unset() {
    [ -z "$1" ] || [ "$1" = "${VLD_UNSET_DASH}" ]
}

# True when $1 is an integer within [$2, $3].
vld_is_int_in_range() {
    [[ "$1" =~ ^[0-9]+$ ]] || return 1
    [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]
}

# Check one enumerated field, reporting a violation naming the field and the allowed
# values. $1 line, $2 field name, $3 value, then the allowed values. Unset values are
# resolved by vld_check_entry_field and its _optional twin before they call this.
vld_check_enum() {
    local line="$1" column="$2" value="$3"
    shift 3
    vld_in_list "${value}" "$@" && return 0
    vld_error "${line}" "${column}: \"${value}\" is not one of: $*"
    return 1
}

# Enforce the schema's 256-character cap on a justification cell.
vld_check_justification() {
    local line="$1" column="$2" value="$3"
    [ "${#value}" -le 256 ] && return 0
    vld_error "${line}" "${column}: ${#value} characters, exceeds the 256-character cap"
}

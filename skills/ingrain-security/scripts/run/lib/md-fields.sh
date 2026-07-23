# The field layer, one level below the sections: finds a `Name: value` line inside a line
# range, indexes the `### <id> — <title>` entry blocks a section holds, and checks an entry's
# id and one of its fields. Still schema-agnostic — which fields an entry must carry is the
# next file's business.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by run/validate-assessment. Sets no shell options; needs, sourced first:
#   lib/md-primitives.sh   vld_trim, vld_lower, vld_error, vld_is_unset, vld_check_enum,
#                          VLD_LENIENT
#   lib/md-document.sh     DOC, DOC_COUNT
#
# Written for bash 3.2: no associative arrays, no `mapfile`, no `${var,,}`.

# --- field lookup -----------------------------------------------------------------

# Look up a `Name: value` field within the line range $1..$2, returning 0 when found. The
# result lands in globals, not stdout: a `$(…)` capture would lose violations to a subshell.
VLD_FIELD_LINE=0
VLD_VALUE=""

vld_field() {
    local start="$1" end="$2" name="$3"

    local i line
    for ((i = start; i <= end && i <= DOC_COUNT; i++)); do
        line="${DOC[i]}"
        case "${line}" in
            "${name}:"*)
                VLD_FIELD_LINE="${i}"
                VLD_VALUE="$(vld_trim "${line#"${name}":}")"
                return 0
                ;;
        esac
    done
    VLD_FIELD_LINE=0
    VLD_VALUE=""
    return 1
}

# Require a `Name: value` field, leaving its value in VLD_VALUE and its line in
# VLD_FIELD_LINE. Returns 1 when the field is missing or empty, reporting unless
# `--lenient` (where the caller still skips the value check).
vld_require_field() {
    local start="$1" end="$2" name="$3" heading_line="$4"
    if ! vld_field "${start}" "${end}" "${name}"; then
        [ "${VLD_LENIENT}" = "true" ] || vld_error "${heading_line}" "missing required field \"${name}:\""
        return 1
    fi
    if [ -z "${VLD_VALUE}" ]; then
        [ "${VLD_LENIENT}" = "true" ] || vld_error "${VLD_FIELD_LINE}" "field \"${name}:\" is empty"
        return 1
    fi
    return 0
}

# --- entry index ------------------------------------------------------------------

# Threats and mitigations are stored as one `### <id> — <title>` block each, with one
# `Name: value` field per line beneath. The entry-level twin of the section index in
# md-document.sh: same shape, one heading level down, scoped to a section's line range.
ENTRY_IDS=()
ENTRY_STARTS=()
ENTRY_ENDS=()

# Index the `### ` blocks inside the line range $1..$2. The id is the heading text up to
# the first em dash, the title the remainder; a heading with no dash yields the whole text
# as the id, which then fails the id check. An entry's body runs to the line before the
# next `###` or to the end of the range.
vld_index_entries() {
    local start="$1" end="$2"
    ENTRY_IDS=()
    ENTRY_STARTS=()
    ENTRY_ENDS=()

    local i text id
    for ((i = start; i <= end && i <= DOC_COUNT; i++)); do
        case "${DOC[i]}" in
            '### '*)
                text="$(vld_trim "${DOC[i]#\#\#\# }")"
                id="$(vld_trim "${text%%—*}")"
                ENTRY_IDS+=("${id}")
                ENTRY_STARTS+=("${i}")
                ;;
        esac
    done

    for ((i = 0; i < ${#ENTRY_STARTS[@]}; i++)); do
        if [ $((i + 1)) -lt "${#ENTRY_STARTS[@]}" ]; then
            ENTRY_ENDS+=($((ENTRY_STARTS[i + 1] - 1)))
        else
            ENTRY_ENDS+=("${end}")
        fi
    done
}

# Check an entry id: the right prefix ($3 = T|M, either case) followed by digits, and unique
# within its section. $1 the line it sits on, $2 the value. Ids are permanent, so there is no
# contiguity rule. Uniqueness compares case-folded, while the message quotes the id as
# written.
VLD_SEEN_IDS=""

# Start a fresh ledger of seen ids — called before each run of entries, so `T01` in one
# section and `M01` in the next are not weighed against each other.
vld_reset_ids() {
    VLD_SEEN_IDS=""
}

vld_check_id() {
    local line="$1" value="$2" prefix="$3"

    local lower_prefix
    lower_prefix="$(vld_lower "${prefix}")"
    if ! [[ "${value}" =~ ^[${prefix}${lower_prefix}][0-9]+$ ]]; then
        vld_error "${line}" "id: \"${value}\" is not of the form ${prefix}<n>"
        return 1
    fi

    local folded
    folded="$(vld_lower "${value}")"
    case " ${VLD_SEEN_IDS} " in
        *" ${folded} "*)
            vld_error "${line}" "id: \"${value}\" is a duplicate"
            return 1
            ;;
    esac
    VLD_SEEN_IDS="${VLD_SEEN_IDS} ${folded}"
    return 0
}

# Check one `Name: value` field a later stage must have filled by finalize. $4.. the allowed
# values; with none given the field is free text and only its presence is checked.
#
# Both ways a field can be unfilled — absent, or `—` — are waived under `--lenient` and
# reported when strict. vld_require_field covers the absent case; this adds the `—` case.
vld_check_entry_field() {
    local start="$1" end="$2" name="$3" heading_line="$4"
    shift 4
    vld_require_field "${start}" "${end}" "${name}" "${heading_line}" || return 1
    if vld_is_unset "${VLD_VALUE}"; then
        [ "${VLD_LENIENT}" = "true" ] || vld_error "${VLD_FIELD_LINE}" "${name}: is not filled in"
        return 1
    fi
    [ "$#" -eq 0 ] && return 0
    vld_check_enum "${VLD_FIELD_LINE}" "${name}" "${VLD_VALUE}" "$@"
}

# As vld_check_entry_field, but `—` is a settled answer in either mode — for the fields the
# schema leaves permanently optional (Robustness on an unselected threat, Threats on a
# general instruction).
vld_check_entry_field_optional() {
    local start="$1" end="$2" name="$3" heading_line="$4"
    shift 4
    vld_require_field "${start}" "${end}" "${name}" "${heading_line}" || return 1
    vld_is_unset "${VLD_VALUE}" && return 0
    [ "$#" -eq 0 ] && return 0
    vld_check_enum "${VLD_FIELD_LINE}" "${name}" "${VLD_VALUE}" "$@"
}

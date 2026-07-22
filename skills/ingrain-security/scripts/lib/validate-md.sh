# Shared schema validator for the ingrain-security assessment file: sections, table headers,
# tag sequences, enumerated values, numeric ranges, length caps and cross-references, against
# the shape references/formatting/assessment-file.md specifies. Never which phase filled
# which column.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by skills/ingrain-security/scripts/validate-assessment. Sets no shell options;
# needs project-root.sh sourced first (escape_for_json).
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
    local value candidate
    value="$(vld_lower "$1")"
    shift
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

# --- document loading -------------------------------------------------------------

# The file as a 1-based array of lines: DOC[1] is line 1, so an index doubles as the
# line number carried in every error.
DOC=()
DOC_COUNT=0

vld_load() {
    local path="$1" line
    DOC=("")
    while IFS= read -r line || [ -n "${line}" ]; do
        DOC+=("${line}")
    done < "${path}"
    DOC_COUNT=$((${#DOC[@]} - 1))
}

# --- section index ----------------------------------------------------------------

# Every `## ` heading, in document order, with the line it sits on.
SEC_TITLES=()
SEC_STARTS=()

vld_index_sections() {
    local i title
    SEC_TITLES=()
    SEC_STARTS=()
    for ((i = 1; i <= DOC_COUNT; i++)); do
        case "${DOC[i]}" in
            '## '*)
                title="$(vld_trim "${DOC[i]#\#\# }")"
                SEC_TITLES+=("${title}")
                SEC_STARTS+=("${i}")
                ;;
        esac
    done
}

# The index of the section whose heading starts with $1 (case-insensitive), or -1. Prefix
# matching lets `## Maintenance (for the implementing agent)` answer to `Maintenance`.
vld_section_index() {
    local want lower i
    want="$(vld_lower "$1")"
    for ((i = 0; i < ${#SEC_TITLES[@]}; i++)); do
        lower="$(vld_lower "${SEC_TITLES[i]}")"
        case "${lower}" in
            "${want}"*)
                printf '%s' "${i}"
                return 0
                ;;
        esac
    done
    printf '%s' '-1'
}

# The body of section index $1 as a line range, echoed as "<start> <end>". The body
# starts on the line after the heading and ends before the next `##` heading (or at the
# end of the file).
vld_section_range() {
    local idx="$1" start end next
    start=$((SEC_STARTS[idx] + 1))
    next=$((idx + 1))
    if [ "${next}" -lt "${#SEC_STARTS[@]}" ]; then
        end=$((SEC_STARTS[next] - 1))
    else
        end="${DOC_COUNT}"
    fi
    printf '%s %s' "${start}" "${end}"
}

# Report any `##` heading that is not one of the schema's known sections. $@ the known
# section names (prefixes).
vld_check_unknown_sections() {
    local known_list=("$@")
    local i j lower known matched
    for ((i = 0; i < ${#SEC_TITLES[@]}; i++)); do
        lower="$(vld_lower "${SEC_TITLES[i]}")"
        matched="false"
        for ((j = 0; j < ${#known_list[@]}; j++)); do
            known="$(vld_lower "${known_list[j]}")"
            case "${lower}" in
                "${known}"*)
                    matched="true"
                    break
                    ;;
            esac
        done
        [ "${matched}" = "true" ] || vld_error "${SEC_STARTS[i]}" \
            "unknown section \"## ${SEC_TITLES[i]}\""
    done
}

# Require the named sections, in the given order. Missing ones are reported against the
# file as a whole; one out of order is reported on its heading line. `--lenient` waives the
# missing-section report, holding the sections that ARE present to their order.
vld_check_required_sections() {
    local name idx previous=-1 previous_name=""
    for name in "$@"; do
        idx="$(vld_section_index "${name}")"
        if [ "${idx}" -lt 0 ]; then
            [ "${VLD_LENIENT}" = "true" ] || vld_error 0 "missing required section \"## ${name}\""
            continue
        fi
        if [ "${idx}" -lt "${previous}" ]; then
            vld_error "${SEC_STARTS[idx]}" \
                "section \"## ${name}\" is out of order — it must follow \"## ${previous_name}\""
        fi
        previous="${idx}"
        previous_name="${name}"
    done
}

# --- field lookup -----------------------------------------------------------------

# Look up a `Name: value` field within the line range $1..$2, returning 0 when found. The
# result lands in globals, not stdout: a `$(…)` capture would lose violations to a subshell.
VLD_FIELD_LINE=0
VLD_VALUE=""

vld_field() {
    local start="$1" end="$2" name="$3" i line
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
# `Name: value` field per line beneath. The entry-level twin of the section index above:
# same shape, one heading level down, scoped to a section's line range.
ENTRY_IDS=()
ENTRY_STARTS=()
ENTRY_ENDS=()

# Index the `### ` blocks inside the line range $1..$2. The id is the heading text up to
# the first em dash, the title the remainder; a heading with no dash yields the whole text
# as the id, which then fails the id check. An entry's body runs to the line before the
# next `###` or to the end of the range.
vld_index_entries() {
    local start="$1" end="$2" i text id
    ENTRY_IDS=()
    ENTRY_STARTS=()
    ENTRY_ENDS=()

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

vld_check_id() {
    local line="$1" value="$2" prefix="$3" lower_prefix folded
    lower_prefix="$(vld_lower "${prefix}")"
    if ! [[ "${value}" =~ ^[${prefix}${lower_prefix}][0-9]+$ ]]; then
        vld_error "${line}" "id: \"${value}\" is not of the form ${prefix}<n>"
        return 1
    fi
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

# --- assessment schema ------------------------------------------------------------

# Validate an assessment file. Reports through vld_error; never returns non-zero for a
# schema violation (the caller reads the error count).
vld_validate_assessment() {
    vld_index_sections
    vld_check_first_heading
    vld_check_required_sections \
        "Task" "Triage" "Threats" "Risk score" "Mitigations" "Coverage / open items" "Maintenance"
    vld_check_unknown_sections \
        "Task" "Triage" "Threats" "Threat critique" "Risk score" "Mitigations" \
        "Mitigation critique" "Coverage / open items" "Maintenance"

    vld_check_task_section
    vld_check_triage_section
    vld_check_threats_section
    vld_check_risk_score_section
    vld_check_mitigations_section
}

# The level-1 title every artifact leads with.
vld_check_first_heading() {
    local i line
    for ((i = 1; i <= DOC_COUNT; i++)); do
        line="$(vld_trim "${DOC[i]}")"
        [ -z "${line}" ] && continue
        case "${line}" in
            '# '*) return 0 ;;
        esac
        vld_error "${i}" "file does not start with a \"# <title>\" heading"
        return 1
    done
    vld_error 0 "file is empty"
    return 1
}

vld_check_task_section() {
    local idx range start end heading
    idx="$(vld_section_index "Task")"
    [ "${idx}" -lt 0 ] && return 0
    range="$(vld_section_range "${idx}")"
    start="${range%% *}"
    end="${range##* }"
    heading="${SEC_STARTS[idx]}"

    vld_require_field "${start}" "${end}" "Title" "${heading}"
    if vld_require_field "${start}" "${end}" "Latest stage" "${heading}"; then
        vld_check_enum "${VLD_FIELD_LINE}" "Latest stage" "${VLD_VALUE}" development testing
    fi
}

vld_check_triage_section() {
    local idx range start end heading
    idx="$(vld_section_index "Triage")"
    [ "${idx}" -lt 0 ] && return 0
    range="$(vld_section_range "${idx}")"
    start="${range%% *}"
    end="${range##* }"
    heading="${SEC_STARTS[idx]}"

    if vld_require_field "${start}" "${end}" "Verdict" "${heading}"; then
        vld_check_enum "${VLD_FIELD_LINE}" "Verdict" "${VLD_VALUE}" minor major
    fi
    if vld_require_field "${start}" "${end}" "Security relevant" "${heading}"; then
        vld_check_enum "${VLD_FIELD_LINE}" "Security relevant" "${VLD_VALUE}" true false
    fi
}

# The threat ids this file declares, space delimited — the set a mitigation's **Threats**
# field must draw from.
VLD_THREAT_TAGS=""

vld_check_threats_section() {
    local idx range start end heading i entry_start entry_end entry_head

    VLD_THREAT_TAGS=""
    idx="$(vld_section_index "Threats")"
    [ "${idx}" -lt 0 ] && return 0
    range="$(vld_section_range "${idx}")"
    start="${range%% *}"
    end="${range##* }"
    heading="${SEC_STARTS[idx]}"

    # No entries is legitimate in either mode: a `minor` triage has no threats, and mid-run
    # the heading lands before the worker that fills it.
    vld_index_entries "${start}" "${end}"
    [ "${#ENTRY_STARTS[@]}" -eq 0 ] && return 0

    VLD_SEEN_IDS=""
    for ((i = 0; i < ${#ENTRY_STARTS[@]}; i++)); do
        entry_head="${ENTRY_STARTS[i]}"
        entry_start=$((entry_head + 1))
        entry_end="${ENTRY_ENDS[i]}"

        # Case-folded, because a mitigation's Threats field may spell the id in either case.
        if vld_check_id "${entry_head}" "${ENTRY_IDS[i]}" T; then
            VLD_THREAT_TAGS="${VLD_THREAT_TAGS} $(vld_lower "${ENTRY_IDS[i]}")"
        fi

        vld_check_entry_field "${entry_start}" "${entry_end}" "Asset" "${entry_head}"
        vld_check_entry_field "${entry_start}" "${entry_end}" "Vector" "${entry_head}"
        vld_check_entry_field "${entry_start}" "${entry_end}" "Description" "${entry_head}"
        vld_check_entry_field "${entry_start}" "${entry_end}" "Assumptions" "${entry_head}"

        if vld_check_entry_field "${entry_start}" "${entry_end}" "Justification" "${entry_head}"; then
            vld_check_justification "${VLD_FIELD_LINE}" "Justification" "${VLD_VALUE}"
        fi
        vld_check_entry_field "${entry_start}" "${entry_end}" "Impact" "${entry_head}" \
            critical high medium low
        vld_check_entry_field "${entry_start}" "${entry_end}" "Likelihood" "${entry_head}" \
            "very high" high medium low

        if vld_check_entry_field "${entry_start}" "${entry_end}" "Risk score" "${entry_head}"; then
            vld_is_int_in_range "${VLD_VALUE}" 0 100 \
                || vld_error "${VLD_FIELD_LINE}" "Risk score: \"${VLD_VALUE}\" is not an integer in 0–100"
        fi
        vld_check_entry_field "${entry_start}" "${entry_end}" "Criticality" "${entry_head}" \
            low medium high critical

        vld_check_entry_field_optional "${entry_start}" "${entry_end}" "Selection" "${entry_head}" \
            selected excluded undecided
        vld_check_entry_field_optional "${entry_start}" "${entry_end}" "Robustness" "${entry_head}" \
            weak adequate strong
    done
}

vld_check_risk_score_section() {
    local idx range start end heading
    idx="$(vld_section_index "Risk score")"
    [ "${idx}" -lt 0 ] && return 0
    range="$(vld_section_range "${idx}")"
    start="${range%% *}"
    end="${range##* }"
    heading="${SEC_STARTS[idx]}"

    # Entry-field checks, not bare vld_require_field: the risk scorer fills this section as
    # it scores the threats, so `—` here means the same "not yet".
    if vld_check_entry_field "${start}" "${end}" "Score" "${heading}"; then
        vld_is_int_in_range "${VLD_VALUE}" 0 100 \
            || vld_error "${VLD_FIELD_LINE}" "Score: \"${VLD_VALUE}\" is not an integer in 0–100"
    fi
    vld_check_entry_field "${start}" "${end}" "Criticality" "${heading}" low medium high critical
}

# Check a mitigation's **Threats** field: `—` for a general implementation instruction,
# else a comma-separated list of ids this file's `## Threats` section declares.
vld_check_threat_tags() {
    local line="$1" value="$2" tag folded rest
    vld_is_unset "${value}" && return 0
    rest="${value}"
    while [ -n "${rest}" ]; do
        if [[ "${rest}" == *","* ]]; then
            tag="$(vld_trim "${rest%%,*}")"
            rest="${rest#*,}"
        else
            tag="$(vld_trim "${rest}")"
            rest=""
        fi
        if ! [[ "${tag}" =~ ^[Tt][0-9]+$ ]]; then
            vld_error "${line}" "Threats: \"${tag}\" is not of the form T<n>"
            continue
        fi
        # VLD_THREAT_TAGS holds case-folded ids, so the tag folds before the lookup.
        folded="$(vld_lower "${tag}")"
        case " ${VLD_THREAT_TAGS} " in
            *" ${folded} "*) ;;
            *) vld_error "${line}" "Threats: \"${tag}\" is not a threat in this file" ;;
        esac
    done
}

# Check a **Rule refs** cell: `—`, or a comma-separated list of non-empty ids.
vld_check_rule_refs() {
    local line="$1" value="$2" ref rest
    vld_is_unset "${value}" && return 0
    rest="${value}"
    while [ -n "${rest}" ]; do
        if [[ "${rest}" == *","* ]]; then
            ref="$(vld_trim "${rest%%,*}")"
            rest="${rest#*,}"
        else
            ref="$(vld_trim "${rest}")"
            rest=""
        fi
        [[ "${ref}" =~ ^[A-Za-z0-9._-]+$ ]] \
            || vld_error "${line}" "Rule refs: \"${ref}\" is not a rule id"
    done
}

vld_check_mitigations_section() {
    local idx range start end heading i entry_start entry_end entry_head

    idx="$(vld_section_index "Mitigations")"
    [ "${idx}" -lt 0 ] && return 0
    range="$(vld_section_range "${idx}")"
    start="${range%% *}"
    end="${range##* }"
    heading="${SEC_STARTS[idx]}"

    # As in Threats: an empty section is not a defect in either mode.
    vld_index_entries "${start}" "${end}"
    [ "${#ENTRY_STARTS[@]}" -eq 0 ] && return 0

    VLD_SEEN_IDS=""
    for ((i = 0; i < ${#ENTRY_STARTS[@]}; i++)); do
        entry_head="${ENTRY_STARTS[i]}"
        entry_start=$((entry_head + 1))
        entry_end="${ENTRY_ENDS[i]}"

        vld_check_id "${entry_head}" "${ENTRY_IDS[i]}" M

        vld_check_entry_field "${entry_start}" "${entry_end}" "Description" "${entry_head}"
        vld_check_entry_field "${entry_start}" "${entry_end}" "Yield" "${entry_head}" \
            high medium low
        vld_check_entry_field "${entry_start}" "${entry_end}" "Effort" "${entry_head}" \
            high medium low

        if vld_check_entry_field_optional "${entry_start}" "${entry_end}" "Threats" "${entry_head}"; then
            vld_check_threat_tags "${VLD_FIELD_LINE}" "${VLD_VALUE}"
        fi
        if vld_check_entry_field_optional "${entry_start}" "${entry_end}" "Rule refs" "${entry_head}"; then
            vld_check_rule_refs "${VLD_FIELD_LINE}" "${VLD_VALUE}"
        fi

        vld_check_entry_field_optional "${entry_start}" "${entry_end}" "Selection" "${entry_head}" \
            selected excluded undecided
        if vld_check_entry_field_optional "${entry_start}" "${entry_end}" "Justification" "${entry_head}"; then
            vld_check_justification "${VLD_FIELD_LINE}" "Justification" "${VLD_VALUE}"
        fi
        vld_check_entry_field_optional "${entry_start}" "${entry_end}" "Robustness" "${entry_head}" \
            weak adequate strong
    done
}

# --- reporting --------------------------------------------------------------------

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
    local path="$1" valid i
    if [ "${#VLD_ERR_LINES[@]}" -eq 0 ]; then valid="true"; else valid="false"; fi

    printf '{"path":"%s","lenient":%s,"valid":%s,"error_count":%s,"errors":[' \
        "$(escape_for_json "${path}")" "${VLD_LENIENT}" "${valid}" "${#VLD_ERR_LINES[@]}"
    for ((i = 0; i < ${#VLD_ERR_LINES[@]}; i++)); do
        [ "${i}" -gt 0 ] && printf ','
        printf '{"line":%s,"message":"%s"}' \
            "${VLD_ERR_LINES[i]}" "$(escape_for_json "${VLD_ERR_MSGS[i]}")"
    done
    printf ']}\n'
}

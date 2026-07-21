# Shared schema validator for the ingrain-security assessment file.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: the caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose (every check must run so one pass reports every violation),
# and sourcing must not change that. Requires the sibling project-root.sh to be sourced
# first (escape_for_json).
#
# Sourced by:
#   skills/ingrain-security/scripts/validate-assessment
#
# Checks a written assessment file against the shape references/formatting/assessment-file.md
# specifies.
#
# The checking is STRUCTURAL: sections, table headers, tag sequences, enumerated values,
# numeric ranges, length caps and cross-references. It never reasons about which phase
# filled which column, so an unset (`—`) verification column is always acceptable.
#
# Written for bash 3.2 (the system bash on macOS): no associative arrays, no `mapfile`,
# no `${var,,}`.

# Values a column may hold when it has not been filled yet. The reference file spells an
# unset cell as the em dash; an empty cell means the same thing.
VLD_UNSET_DASH='—'

# The file is still being written: waive the checks that can only hold once it is
# complete — a missing required section, a required field not filled in yet, a section
# whose table has not been written, non-contiguous tags and rows not yet sorted by risk.
# That set is what the minter's seeded skeleton consists of: an empty skeleton is
# lenient-valid and strictly invalid, by design.
# Everything already on the page is still checked in full, so leniency is never a blanket
# pass. The caller sets it from `--lenient`; it is initialized here so every check reads a
# defined value under `set -u`.
VLD_LENIENT="false"

# --- error collection -------------------------------------------------------------

# Errors accumulate in two parallel arrays rather than aborting at the first one: a
# writer fixing an artifact wants the whole list, not one violation per run.
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

# Check one enumerated cell, reporting a violation naming the column and the allowed
# values. $1 line, $2 column name, $3 value, then the allowed values. An unset cell is
# accepted only when $4.. includes the unset marker via vld_check_enum_optional.
vld_check_enum() {
    local line="$1" column="$2" value="$3"
    shift 3
    vld_in_list "${value}" "$@" && return 0
    vld_error "${line}" "${column}: \"${value}\" is not one of: $*"
    return 1
}

# As vld_check_enum, but an unset cell (empty or `—`) also passes — for the columns the
# schema marks optional until a gate or the verification pass fills them.
vld_check_enum_optional() {
    local line="$1" column="$2" value="$3"
    shift 3
    vld_is_unset "${value}" && return 0
    vld_check_enum "${line}" "${column}" "${value}" "$@"
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

# The index of the section whose heading starts with $1 (case-insensitive), or -1.
# Prefix matching is what lets `## Maintenance (for the implementing agent)` answer to
# `Maintenance`.
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
# file as a whole; a section that appears out of order is reported on its heading line.
#
# In-progress files are missing sections by construction — at Step 0 the assessment holds
# only `## Task` and `## Triage` — so `--lenient` waives the missing-section report while
# still holding the sections that ARE present to their order and their contents.
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

# Look up a `Name: value` field within the line range $1..$2, returning 0 when found.
# The result lands in globals rather than on stdout: a `$(…)` capture would run the
# lookup in a subshell, and any violation recorded there would die with it.
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

# Require a `Name: value` field, leaving its value in VLD_VALUE and the line it sits on
# in VLD_FIELD_LINE. Returns 1 (and reports) when the field is missing or empty — under
# `--lenient` it still returns 1, so the caller skips the value check, but reports nothing:
# mid-run a section is routinely on the page with its fields not filled in yet, which is
# exactly the shape the minter seeds.
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

# --- table parsing ----------------------------------------------------------------

# Split a markdown table row into ROW_CELLS, trimmed, with the leading and trailing
# pipes dropped. Split by hand rather than with `read -ra`, which silently drops a
# trailing empty field — exactly the case a cell-count check must catch.
ROW_CELLS=()

vld_split_row() {
    local raw cell
    raw="$(vld_trim "$1")"
    raw="${raw#|}"
    raw="${raw%|}"
    ROW_CELLS=()
    while :; do
        if [[ "${raw}" == *"|"* ]]; then
            cell="${raw%%|*}"
            raw="${raw#*|}"
            ROW_CELLS+=("$(vld_trim "${cell}")")
        else
            ROW_CELLS+=("$(vld_trim "${raw}")")
            break
        fi
    done
}

# True when the row is a header separator (`|---|:--:|…`).
vld_is_separator_row() {
    local raw
    raw="$(vld_trim "$1")"
    [[ "${raw}" =~ ^\|[[:space:]:|-]+\|?$ ]]
}

# Locate the table in the line range $1..$2 and check its header against the expected
# columns ($4.. ). Returns 0 when a header was found and leaves the row span in
# TBL_FIRST_ROW / TBL_LAST_ROW; returns 1 (reporting) when the section
# holds no table. Results go to globals, not stdout, so the violations this records
# survive — a `$(…)` capture would run it in a subshell and lose them.
#
# Data rows are the pipe rows following the separator, stopping at the first line that
# is not one. TBL_LAST_ROW < TBL_FIRST_ROW means the table has no data rows, which is
# legitimate: a `minor` triage can leave the Threats table empty.
TBL_FIRST_ROW=0
TBL_LAST_ROW=0

vld_table_header() {
    local start="$1" end="$2" heading_line="$3"
    shift 3
    local expected=("$@")
    local i header_line=0 line first_data last_data

    for ((i = start; i <= end && i <= DOC_COUNT; i++)); do
        line="$(vld_trim "${DOC[i]}")"
        case "${line}" in
            '|'*)
                header_line="${i}"
                break
                ;;
        esac
    done
    if [ "${header_line}" -eq 0 ]; then
        # Mid-run the heading routinely lands before the rows it will hold: the
        # orchestrator opens the file, and the worker that fills this table has not been
        # dispatched yet.
        [ "${VLD_LENIENT}" = "true" ] || vld_error "${heading_line}" "section holds no table"
        return 1
    fi

    vld_split_row "${DOC[header_line]}"
    local actual=("${ROW_CELLS[@]}")
    if [ "${#actual[@]}" -ne "${#expected[@]}" ]; then
        vld_error "${header_line}" \
            "table header has ${#actual[@]} columns, expected ${#expected[@]}: ${expected[*]}"
    else
        for ((i = 0; i < ${#expected[@]}; i++)); do
            if ! vld_in_list "${actual[i]}" "${expected[i]}"; then
                vld_error "${header_line}" \
                    "table header column $((i + 1)) is \"${actual[i]}\", expected \"${expected[i]}\""
            fi
        done
    fi

    if [ $((header_line + 1)) -gt "${end}" ] || ! vld_is_separator_row "${DOC[header_line + 1]}"; then
        vld_error "${header_line}" "table header is not followed by a separator row"
        TBL_FIRST_ROW=$((header_line + 1))
        TBL_LAST_ROW="${header_line}"
        return 0
    fi

    first_data=$((header_line + 2))
    last_data=$((first_data - 1))
    for ((i = first_data; i <= end && i <= DOC_COUNT; i++)); do
        line="$(vld_trim "${DOC[i]}")"
        case "${line}" in
            '|'*) last_data="${i}" ;;
            *) break ;;
        esac
    done

    TBL_FIRST_ROW="${first_data}"
    TBL_LAST_ROW="${last_data}"
    return 0
}

# Check a tag column: the right prefix ($3 = T|M), no duplicates, and — unless lenient —
# contiguous from 1. $1 the ordinal position (0-based), $2 the line, $4 the value.
# The seen tags accumulate in VLD_SEEN_TAGS (space delimited).
VLD_SEEN_TAGS=""

vld_check_tag() {
    local index="$1" line="$2" prefix="$3" value="$4" number
    if ! [[ "${value}" =~ ^${prefix}[0-9]+$ ]]; then
        vld_error "${line}" "Tag: \"${value}\" is not of the form ${prefix}<n>"
        return 1
    fi
    case " ${VLD_SEEN_TAGS} " in
        *" ${value} "*)
            vld_error "${line}" "Tag: \"${value}\" is a duplicate"
            return 1
            ;;
    esac
    VLD_SEEN_TAGS="${VLD_SEEN_TAGS} ${value}"
    number="${value#"${prefix}"}"
    if [ "${VLD_LENIENT}" != "true" ] && [ "${number}" -ne $((index + 1)) ]; then
        vld_error "${line}" \
            "Tag: \"${value}\" breaks the contiguous sequence — expected ${prefix}$((index + 1))"
    fi
    return 0
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

# The threat tags this file declares, space delimited — the set a mitigation's
# **Threat tags** column must draw from.
VLD_THREAT_TAGS=""

vld_check_threats_section() {
    local idx range start end heading first last i row_index=0
    local expected=(
        Tag Title Asset Vector Description Assumptions Justification
        Impact Likelihood "Risk score" Criticality Selection Robustness
    )
    local previous_score=101 score

    VLD_THREAT_TAGS=""
    idx="$(vld_section_index "Threats")"
    [ "${idx}" -lt 0 ] && return 0
    range="$(vld_section_range "${idx}")"
    start="${range%% *}"
    end="${range##* }"
    heading="${SEC_STARTS[idx]}"

    vld_table_header "${start}" "${end}" "${heading}" "${expected[@]}" || return 0
    first="${TBL_FIRST_ROW}"
    last="${TBL_LAST_ROW}"

    VLD_SEEN_TAGS=""
    for ((i = first; i <= last; i++)); do
        vld_split_row "${DOC[i]}"
        if [ "${#ROW_CELLS[@]}" -ne "${#expected[@]}" ]; then
            vld_error "${i}" \
                "row has ${#ROW_CELLS[@]} cells, expected ${#expected[@]}"
            row_index=$((row_index + 1))
            continue
        fi

        if vld_check_tag "${row_index}" "${i}" T "${ROW_CELLS[0]}"; then
            VLD_THREAT_TAGS="${VLD_THREAT_TAGS} ${ROW_CELLS[0]}"
        fi
        vld_check_justification "${i}" "Justification" "${ROW_CELLS[6]}"
        vld_check_enum "${i}" "Impact" "${ROW_CELLS[7]}" critical high medium low
        vld_check_enum "${i}" "Likelihood" "${ROW_CELLS[8]}" "very high" high medium low

        score="${ROW_CELLS[9]}"
        if vld_is_int_in_range "${score}" 0 100; then
            if [ "${VLD_LENIENT}" != "true" ] && [ "${score}" -gt "${previous_score}" ]; then
                vld_error "${i}" \
                    "Risk score: ${score} is higher than the preceding row's ${previous_score} — rows must descend by risk"
            fi
            previous_score="${score}"
        else
            vld_error "${i}" "Risk score: \"${score}\" is not an integer in 0–100"
        fi

        vld_check_enum "${i}" "Criticality" "${ROW_CELLS[10]}" low medium high critical
        vld_check_enum_optional "${i}" "Selection" "${ROW_CELLS[11]}" selected excluded undecided
        vld_check_enum_optional "${i}" "Robustness" "${ROW_CELLS[12]}" weak adequate strong

        row_index=$((row_index + 1))
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

    if vld_require_field "${start}" "${end}" "Score" "${heading}"; then
        vld_is_int_in_range "${VLD_VALUE}" 0 100 \
            || vld_error "${VLD_FIELD_LINE}" "Score: \"${VLD_VALUE}\" is not an integer in 0–100"
    fi
    if vld_require_field "${start}" "${end}" "Criticality" "${heading}"; then
        vld_check_enum "${VLD_FIELD_LINE}" "Criticality" "${VLD_VALUE}" low medium high critical
    fi
}

# Check a mitigation's **Threat tags** cell: `—` for a general implementation
# instruction, else a comma-separated list of tags this file's Threats table declares.
vld_check_threat_tags() {
    local line="$1" value="$2" tag rest
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
        if ! [[ "${tag}" =~ ^T[0-9]+$ ]]; then
            vld_error "${line}" "Threat tags: \"${tag}\" is not of the form T<n>"
            continue
        fi
        case " ${VLD_THREAT_TAGS} " in
            *" ${tag} "*) ;;
            *) vld_error "${line}" "Threat tags: \"${tag}\" is not a threat in this file" ;;
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
    local idx range start end heading first last i row_index=0
    local expected=(
        Tag Title Description Yield Effort "Threat tags" "Rule refs"
        Selection Justification Robustness
    )

    idx="$(vld_section_index "Mitigations")"
    [ "${idx}" -lt 0 ] && return 0
    range="$(vld_section_range "${idx}")"
    start="${range%% *}"
    end="${range##* }"
    heading="${SEC_STARTS[idx]}"

    vld_table_header "${start}" "${end}" "${heading}" "${expected[@]}" || return 0
    first="${TBL_FIRST_ROW}"
    last="${TBL_LAST_ROW}"

    VLD_SEEN_TAGS=""
    for ((i = first; i <= last; i++)); do
        vld_split_row "${DOC[i]}"
        if [ "${#ROW_CELLS[@]}" -ne "${#expected[@]}" ]; then
            vld_error "${i}" "row has ${#ROW_CELLS[@]} cells, expected ${#expected[@]}"
            row_index=$((row_index + 1))
            continue
        fi

        vld_check_tag "${row_index}" "${i}" M "${ROW_CELLS[0]}"
        vld_check_enum "${i}" "Yield" "${ROW_CELLS[3]}" high medium low
        vld_check_enum "${i}" "Effort" "${ROW_CELLS[4]}" high medium low
        vld_check_threat_tags "${i}" "${ROW_CELLS[5]}"
        vld_check_rule_refs "${i}" "${ROW_CELLS[6]}"
        vld_check_enum_optional "${i}" "Selection" "${ROW_CELLS[7]}" selected excluded undecided
        vld_check_justification "${i}" "Justification" "${ROW_CELLS[8]}"
        vld_check_enum_optional "${i}" "Robustness" "${ROW_CELLS[9]}" weak adequate strong

        row_index=$((row_index + 1))
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

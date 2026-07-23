# The assessment file's schema, expressed against the parsing layers below it: which sections
# must be present and in what order, which fields each entry carries, the enumerated values,
# numeric ranges, length caps and cross-references, against the shape
# references/formatting/assessment-file.md specifies. Never which phase filled which field.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by run/validate-assessment. Sets no shell options; needs, sourced first:
#   lib/md-primitives.sh   vld_error, vld_trim, vld_lower, vld_is_unset, vld_is_int_in_range,
#                          vld_check_enum, vld_check_justification, VLD_LENIENT
#   lib/md-document.sh     DOC, DOC_COUNT, SEC_STARTS, vld_index_sections, vld_section_index,
#                          vld_section_range, vld_check_unknown_sections,
#                          vld_check_required_sections
#   lib/md-fields.sh       ENTRY_IDS, ENTRY_STARTS, ENTRY_ENDS, VLD_FIELD_LINE, VLD_VALUE,
#                          vld_index_entries, vld_require_field, vld_reset_ids, vld_check_id,
#                          vld_check_entry_field, vld_check_entry_field_optional
#
# Written for bash 3.2: no associative arrays, no `mapfile`, no `${var,,}`.

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
    local idx
    idx="$(vld_section_index "Task")"
    [ "${idx}" -lt 0 ] && return 0

    local range
    range="$(vld_section_range "${idx}")"
    local start="${range%% *}" end="${range##* }" heading="${SEC_STARTS[idx]}"

    vld_require_field "${start}" "${end}" "Title" "${heading}"
    if vld_require_field "${start}" "${end}" "Latest stage" "${heading}"; then
        vld_check_enum "${VLD_FIELD_LINE}" "Latest stage" "${VLD_VALUE}" development testing
    fi
}

vld_check_triage_section() {
    local idx
    idx="$(vld_section_index "Triage")"
    [ "${idx}" -lt 0 ] && return 0

    local range
    range="$(vld_section_range "${idx}")"
    local start="${range%% *}" end="${range##* }" heading="${SEC_STARTS[idx]}"

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
    VLD_THREAT_TAGS=""

    local idx
    idx="$(vld_section_index "Threats")"
    [ "${idx}" -lt 0 ] && return 0

    local range
    range="$(vld_section_range "${idx}")"
    local start="${range%% *}" end="${range##* }"

    # No entries is legitimate in either mode: a `minor` triage has no threats, and mid-run
    # the heading lands before the worker that fills it.
    vld_index_entries "${start}" "${end}"
    [ "${#ENTRY_STARTS[@]}" -eq 0 ] && return 0

    vld_reset_ids
    local i entry_start entry_end entry_head
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
    local idx
    idx="$(vld_section_index "Risk score")"
    [ "${idx}" -lt 0 ] && return 0

    local range
    range="$(vld_section_range "${idx}")"
    local start="${range%% *}" end="${range##* }" heading="${SEC_STARTS[idx]}"

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
    local line="$1" value="$2"
    vld_is_unset "${value}" && return 0

    local rest="${value}"
    local tag folded
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
    local line="$1" value="$2"
    vld_is_unset "${value}" && return 0

    local rest="${value}"
    local ref
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
    local idx
    idx="$(vld_section_index "Mitigations")"
    [ "${idx}" -lt 0 ] && return 0

    local range
    range="$(vld_section_range "${idx}")"
    local start="${range%% *}" end="${range##* }"

    # As in Threats: an empty section is not a defect in either mode.
    vld_index_entries "${start}" "${end}"
    [ "${#ENTRY_STARTS[@]}" -eq 0 ] && return 0

    vld_reset_ids
    local i entry_start entry_end entry_head
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

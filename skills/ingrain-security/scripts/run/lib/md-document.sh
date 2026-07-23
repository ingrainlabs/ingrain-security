# The document layer: loads the file into an addressable array of lines and indexes its
# `## ` headings, so every later check can ask for a section by name and get back the line
# range its body occupies. Knows the shape of a markdown document, not the assessment schema.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by run/validate-assessment. Sets no shell options; needs, sourced first:
#   lib/md-primitives.sh   vld_trim, vld_lower, vld_error, VLD_LENIENT
#
# Written for bash 3.2: no associative arrays, no `mapfile`, no `${var,,}`.

# --- document loading -------------------------------------------------------------

# The file as a 1-based array of lines: DOC[1] is line 1, so an index doubles as the
# line number carried in every error.
DOC=()
DOC_COUNT=0

vld_load() {
    local path="$1"
    DOC=("")

    local line
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
    SEC_TITLES=()
    SEC_STARTS=()

    local i title
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
    local want
    want="$(vld_lower "$1")"

    local i lower
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
    local idx="$1"
    local start=$((SEC_STARTS[idx] + 1))
    local next=$((idx + 1))

    local end
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

    local i lower matched
    for ((i = 0; i < ${#SEC_TITLES[@]}; i++)); do
        lower="$(vld_lower "${SEC_TITLES[i]}")"
        matched="false"

        local j known
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
    # Carried across iterations — each section is checked against the one before it.
    local previous=-1 previous_name=""

    local name idx
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

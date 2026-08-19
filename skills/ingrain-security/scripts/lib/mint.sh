# Phase select's own decision, for the ingrain-security plugin.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose (git lookups on a non-git or detached-HEAD checkout must degrade
# to an empty result, not abort), and sourcing must not change that.
#
# Flat: every function is pure over its arguments, so this file requires no sibling lib.
# It used to require FOUR — project-root, assessment-dir, artifact-template and fork-point
# — because it held the whole mint. That composition now lives in `assessment-mint`, which
# is the one place that has all four in scope and is the program being composed.
#
# Sourced by:
#   skills/ingrain-security/scripts/assessment-mint
#
# The route is decided here rather than by the caller because it is a RULE, not a step: the
# order the states are tested in is the whole of Phase select's meaning, and a router that
# re-derived it from the same facts would be a second copy free to disagree.

# Count `Selection: selected` lines inside one `## ` section of an assessment.
# $1 file, $2 section heading (e.g. `## Threats`). Prints an integer.
#
# Section-scoped because both driver axes use the same field name, so a whole-file count
# would report a threat's decision as a rule's. Line-anchored because the field cards inside
# each section spell the allowed values out — `Selection (selected|excluded)` — and a looser
# match would read the card itself as a decision, making every skeleton look gated.
count_selected_in_section() {
    awk -v want="$2" '
        /^## / { in_section = ($0 == want); next }
        in_section && /^Selection: selected[[:space:]]*$/ { n++ }
        END { print n + 0 }
    ' "$1" 2>/dev/null || printf '0'
}

# Slugify: lowercase, reduce every disallowed char to `-`, collapse `-` runs, trim.
# So `feature/foo` -> `feature-foo`, `Feature/Foo Bar` -> `feature-foo-bar`.
slugify() {
    local slug
    slug="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-')"
    while [[ "${slug}" == *--* ]]; do slug="${slug//--/-}"; done
    slug="${slug#-}"
    slug="${slug%-}"
    printf '%s' "${slug}"
}

# Resolve Phase select's verdict from state the caller has already gathered.
# $1 has_content, $2 selected total, $3 siblings (JSON body, empty when none),
# $4 delta_empty, $5 delta_unreliable — the last two as "true"/"false".
#
# The delta arrives as ARGUMENTS, not as fork-point.sh's `DELTA_*` globals it used to read
# behind the caller's back. Reading another lib's globals is a dependency that no signature
# declares and no reader can see; passing them makes this function pure and the coupling
# visible at the one call site that has both.
#
# Sets `phase` and `phase_reason` in the CALLER's scope — lowercase because they are the
# caller's locals, not globals.
#
# The two names ARE this function's return value, read by `assessment-mint`. ShellCheck sees
# only this file, so once the composer moved out it began reporting both as written-never-read
# — the same report fork-point.sh's `DELTA_*` draws, for the same reason, and the disable is
# scoped to this function rather than the file so a genuinely unused local still warns.
#
# Three values, because two of them would force a lie. `development` and `testing` are
# mechanical — every input is measured, so the router reads them and goes. The third,
# `requires_judgement`, is emitted ONLY where a mechanical answer would be confidently
# wrong, and it names which judgement is owed. Everything else the router used to weigh by
# hand is decided here.
# shellcheck disable=SC2034
resolve_phase() {
    local has_content="$1" selected="$2" siblings="$3" delta_empty="$4" delta_unreliable="$5"

    # Checked FIRST, because mechanically this state is indistinguishable from a fresh task
    # — and that is exactly the misroute it exists to stop. A paraphrased title mints a new
    # path, so `has_content` is false and the count is 0, while the real analysis (possibly
    # already implemented) sits in the file beside it. Only reading the recorded Titles can
    # tell the two apart, and a wrong guess writes into another task's assessment.
    if [ "${has_content}" = "false" ] && [ -n "${siblings}" ]; then
        phase="requires_judgement" phase_reason="siblings_present"; return 0
    fi
    if [ "${has_content}" = "false" ]; then
        phase="development" phase_reason="fresh_task"; return 0
    fi
    if [ "${selected}" -eq 0 ]; then
        phase="development" phase_reason="resume_analysis"; return 0
    fi
    if [ "${delta_empty}" = "false" ]; then
        phase="testing" phase_reason="verify_now"; return 0
    fi
    # Drivers are gated and the tree looks empty — normally "implementation still ahead".
    # But where no fork point resolved, committed work is invisible and `delta_empty` is
    # measuring only the working tree, so the same reading could be hiding a finished
    # implementation. Narrow on purpose: with 0 drivers or a real delta the route is the
    # same either way, so this is the one combination where the doubt changes anything.
    if [ "${delta_unreliable}" = "true" ]; then
        phase="requires_judgement" phase_reason="delta_unreliable"; return 0
    fi
    phase="development" phase_reason="implementation_ahead"
}


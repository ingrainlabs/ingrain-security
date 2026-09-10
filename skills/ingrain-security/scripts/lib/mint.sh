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
#   hooks/scripts/require-review-before-write   (slugify only — the gate matches a branch's
#                                                assessments by the same slug the mint names them with)
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
#
# Bash builtins only. This was one `awk` call, and the last one in the repository — dropping it
# retires a whole runtime dependency that had a single caller, rather than declaring one. The
# scan is the twin of `branch_review_recorded` in hooks/scripts/lib/review-state.sh, which
# cannot use awk at all: it runs inside a hook where a missing binary would read as "no verdict
# recorded" and block every write. Same shape in both places, so neither reads as the odd one.
#
# The `\r` strip is what lets a CRLF assessment — ordinary under Git for Windows, a supported
# platform — match at all; `$` after the carriage return never would.
count_selected_in_section() {
    local file="$1" want="$2" line n=0 in_section=0
    local selected_re='^Selection: selected[[:space:]]*$'

    [ -r "${file}" ] || { printf '0'; return 0; }

    # `|| [ -n "${line}" ]` so a final line with no trailing newline is still read.
    while IFS= read -r line || [ -n "${line}" ]; do
        line="${line%$'\r'}"

        # Quoted, so a heading is matched literally rather than as a glob. Ordered as awk's
        # `in_section = ($0 == want)` was: the wanted heading opens the section, any other
        # `## ` heading closes it.
        case "${line}" in
            "${want}") in_section=1 ; continue ;;
            '## '*) in_section=0 ; continue ;;
        esac
        [ "${in_section}" -eq 1 ] || continue

        [[ "${line}" =~ ${selected_re} ]] && n=$((n + 1))
    done < "${file}"

    printf '%s' "${n}"
}

# Slugify: lowercase, reduce every disallowed char to `-`, collapse `-` runs, trim.
# So `feature/foo` -> `feature-foo`, `Feature/Foo Bar` -> `feature-foo-bar`.
#
# Returns EMPTY for a string with no ASCII alphanumerics, and the branch caller depends on
# that: an empty branch slug is how `branch_known` detects a detached HEAD. Titles must not
# use this directly — see `title_slug`.
slugify() {
    local slug
    slug="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-')"
    while [[ "${slug}" == *--* ]]; do slug="${slug//--/-}"; done
    slug="${slug#-}"
    slug="${slug%-}"
    printf '%s' "${slug}"
}

# The TITLE half of the filename, which must never be empty for a non-empty title.
#
# `slugify` reduces a title with no ASCII alphanumerics — CJK, Cyrillic, Greek, emoji, pure
# punctuation — to "", and the caller then drops the task component entirely, so every such
# task on one branch collapses onto `assessment-<branch>.md` and the second is handed the
# first's analysis as a resumption. `siblings` cannot catch it: that list is only populated
# when `has_content` is false, and here it is true.
#
# The fallback is a checksum of the raw bytes, so it is stable across runs and machines —
# a re-mint of the same title still resolves to the same file, which is what the mint's
# branch+title key promises. An EMPTY title still slugs to "": that is the deliberate
# branch-only path, not a title that failed to slugify.
title_slug() {
    local slug sum
    slug="$(slugify "$1")"
    if [ -z "${slug}" ] && [ -n "$1" ]; then
        sum="$(printf '%s' "$1" | cksum)"
        slug="t${sum%% *}"
    fi
    printf '%s' "${slug}"
}

# Resolve whether this run has a human in it, and which mode it runs in.
# $1 the raw value of INGRAIN_SECURITY_UNATTENDED (empty when unset).
#
# Sets `unattended` and `run_mode` in the CALLER's scope, alongside `resolve_phase`'s two —
# lowercase because they are the caller's locals, and pure over the argument for the same
# reason the delta arrives as one: a function reading the environment behind the caller's
# back is a dependency no signature declares.
#
# WHY THE MINT REPORTS THIS AT ALL. Unattended-ness is needed at Step 0 — the review question
# has no window to open — so it has to be known before the first turn of the review, and Phase
# select is the only thing that runs there. The alternative is prose telling the orchestrator to
# go and read its own environment, which costs a turn and a shell call to learn a fact the
# script it already ran could simply have told it.
#
# ONE VARIABLE CARRIES BOTH FACTS, and the second is not inferable. Standalone must skip
# `context security_rules` and both `record` calls, and the skill otherwise infers
# connectedness from the CLI being present — which in CI it always is, baked into the image.
# So presence answers "is anyone watching" and the value answers "is there a platform".
#
# AN UNRECOGNISED VALUE RESOLVES TO CONNECTED, which is the safe direction rather than the
# lenient one. Guessing connected when the truth is standalone makes a `record` fail against a
# platform with no token — best-effort, one visible line, recoverable. Guessing standalone when
# the truth is connected silently records nothing, which is the exact silent degradation
# `ingrain assert-synced` exists to catch. `mode_note` names the offending value so a typo is
# visible rather than merely survivable.
# shellcheck disable=SC2034
resolve_run_mode() {
    local raw="$1"

    if [ -z "${raw}" ]; then
        unattended="false" run_mode="attended" mode_note=""
        return 0
    fi
    case "${raw}" in
        connected)  unattended="true" run_mode="connected"  mode_note="" ;;
        standalone) unattended="true" run_mode="standalone" mode_note="" ;;
        *)          unattended="true" run_mode="connected"
                    # QUOTED, NEVER ECHOED. `mode_note` is appended to `instruction`, which is
                    # prose the model acts on, and a `pull_request` runs the workflow file from
                    # the PR head — the same reach that makes `resolve_gating_band` refuse a
                    # caller-supplied band. Stripping to an identifier class and capping the
                    # length leaves a typo legible while bounding the value to something that
                    # cannot carry a sentence.
                    local shown="${raw//[^A-Za-z0-9_-]/}"
                    mode_note="INGRAIN_SECURITY_UNATTENDED is set to \"${shown:0:24}\", which is neither connected nor standalone; treating this run as connected. Say so in the closing verdict." ;;
    esac
}

# Resolve the gating band the caller supplied, for a run with no platform to ask.
# $1 the raw value of INGRAIN_SECURITY_BAND (empty when unset), $2 the resolved run mode.
# Sets `caller_band` in the CALLER's scope — EMPTY whenever the caller is not the authority.
#
# EMPTY OUTSIDE STANDALONE, and that is the control rather than a tidiness choice. BR-8 says
# "customers change what CI enforces in the product, not in a workflow file". A connected run's
# band is the org's own, resolved server-side from the buckets covering the change and returned
# on the rule-retrieval call. If this reported a workflow-supplied band there too, the value
# would sit in the agent's context beside the org's with only prose to say which wins — and a
# `pull_request` runs the workflow file FROM THE PR HEAD, so the author of the change under
# review could set it. Refusing to report it is what makes the precedence unforgeable instead of
# model-enforced. Attended runs get nothing for the same reason: a person decides there.
#
# WITHIN STANDALONE, ANYTHING UNRECOGNISED — including unset — RESOLVES TO `high`, the STRICTEST
# band. SR-6 applied to a value rather than a step: a gate that cannot resolve its threshold
# would either select everything or nothing, and both are worse than holding the change to the
# strictest bar the org's own vocabulary has. Note the direction reads backwards on first
# encounter: higher maturity means a LOWER score threshold.
# shellcheck disable=SC2034
resolve_gating_band() {
    if [ "$2" != "standalone" ]; then
        caller_band=""
        return 0
    fi
    case "$1" in
        low|medium|high) caller_band="$1" ;;
        *)               caller_band="high" ;;
    esac
}

# Resolve the risk score a threat must EXCEED to be selected, from a gating band.
# $1 the band. Sets `threshold` in the CALLER's scope, always to a number.
#
# ARITHMETIC BELONGS HERE, NOT IN PROSE. The band decides what a customer's CI enforces, and
# until this existed the comparison was the model's: the skill stated the table and the gate was
# asked to apply it, so the one safety-critical constant in the product was the only one nothing
# could unit-test. A number the run is handed cannot be misread, and Phase 5 quotes it into a
# pull-request comment — "gated at `high`: threats scoring above 25" is a claim about the bar
# the customer's own code was held to.
#
# HIGHER MATURITY MEANS A LOWER BAR, which reads backwards on first encounter: an org holding an
# area to a stricter standard wants MORE of what it finds treated as required work.
#
# ANYTHING UNRECOGNISED RESOLVES TO 25, the strictest bar, matching `resolve_gating_band`'s own
# degrade so the two cannot disagree about what an unknown means (SR-6).
# shellcheck disable=SC2034
resolve_gating_threshold() {
    case "$1" in
        low)    threshold="75" ;;
        medium) threshold="50" ;;
        high)   threshold="25" ;;
        # Unrecognised, including empty: the strictest bar. Equal to `high` by consequence,
        # not by definition — the arm above is the band, this one is the degrade.
        *)      threshold="25" ;;
    esac
}

# Resolve Phase select's verdict from state the caller has already gathered.
# $1 has_content, $2 selected total, $3 siblings (JSON body, empty when none),
# $4 delta_empty, $5 delta_unreliable, $6 scope_verdict — the last three as "true"/"false".
# $6 is the ANSWER to `changed-files.sh`'s `changed_outside_footprint`, never a call to it: this file stays
# flat, so the script that has both composes them.
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
    local scope_verdict="${6:-false}"

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
    # Checked BEFORE the delta route, because it is the same delta seen against a different
    # question: not "is there code to verify" but "is the code still the code this analysis
    # was built for". Every run after the first has a delta, so without this a branch that
    # acquires work elsewhere is checked forever against the first push's threats — the
    # review keeps passing while coverage falls behind, which is the failure that looks like
    # success. The verdict is false whenever no footprint was supplied, so a caller that
    # cannot resolve one routes exactly as it always did.
    if [ "${scope_verdict}" = "true" ]; then
        phase="development" phase_reason="scope_moved"; return 0
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


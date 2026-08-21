# Has the user been asked about this branch yet? — for the ingrain-security review gate.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: the caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose, and sourcing must not change that.
#
# Flat: the one function is pure over its arguments, so this file requires no sibling lib.
# Composing it — resolving the project root, naming the folder, slugifying the branch —
# belongs to the hook that has all three in scope.
#
# Sourced by:
#   hooks/scripts/require-review-before-write   (PreToolUse, both hosts)

# True when some assessment on this branch records the user's answer to the review question.
# $1 assessment folder (absolute), $2 branch slug (non-empty — see below).
#
# Reads `## Triage` → `Verdict:`, which that section's field card defines as the record of
# "the user's answer to the review question that opens the run". That is precisely the fact
# the gate enforces — the user was ASKED before any code existed — and nothing else in the
# artifact carries it. `has_content` flips true the moment any stage writes a byte, and
# `Latest stage` says how far the analysis got; neither says whether the question was put.
# Both `minor` and `major` count, because both are answers: `minor` is the user declining a
# review, which is a decision the gate must honour, not a gap it should keep blocking on.
#
# Section-scoped and line-anchored, for exactly the reason `count_selected_in_section` in
# mint.sh is: the field card under `## Triage` spells out `Verdict (minor|major)` in its own
# prose, so a loose match would read the card as a decision and report every untouched
# skeleton as reviewed — inverting the gate this feeds. A skeleton must read as "not asked".
#
# USES NO EXTERNAL COMMAND — not even awk, which the equivalent parse in mint.sh does use.
# The asymmetry is deliberate and it is about blast radius. mint.sh runs when the skill is
# invoked, and a missing awk there is a visible error on one command. This runs on EVERY file
# write, and a failure here is read by the caller as "no verdict recorded" — so a missing awk
# turned into a DENY on every write, with no way out, because the in-band escape (answer the
# review question, get `Verdict: minor` written) was already recorded and still could not be
# read. A fail-open guardrail must not have a dependency whose absence makes it fail shut, so
# the whole scan is bash builtins: `read`, `case`, and `[[ =~ ]]`.
#
# The `\r` strip is why Git for Windows can carry a CRLF assessment without every Verdict line
# silently failing to match — the same guard `collect_patch_paths` applies for the same reason.
#
# Branch-scoped rather than task-scoped because the mint keys a path on branch + task TITLE,
# and a PreToolUse hook has no title: it sees a file write, not a task. Branch is the finest
# identity available here, and it is the same one the mint's own `siblings` lookup accepts.
#
# The caller must already have deferred on an empty slug — an unresolvable branch (detached
# HEAD, non-git tree) is "we cannot tell", never "no review", and this returning non-zero
# there would turn that doubt into a block.
branch_review_recorded() {
    local dir="$1" slug="$2" file line in_triage

    [ -n "${dir}" ] || return 1
    [ -n "${slug}" ] || return 1
    [ -d "${dir}" ] || return 1

    for file in "${dir}"/assessment-"${slug}"*.md; do
        [ -f "${file}" ] || continue

        in_triage=0
        # `|| [ -n "${line}" ]` so a final line with no trailing newline is still read.
        while IFS= read -r line || [ -n "${line}" ]; do
            line="${line%$'\r'}"

            case "${line}" in
                '## Triage') in_triage=1 ; continue ;;
                '## '*) in_triage=0 ; continue ;;
            esac
            [ "${in_triage}" -eq 1 ] || continue

            [[ "${line}" =~ ^Verdict:[[:space:]]*(minor|major)[[:space:]]*$ ]] && return 0
        done < "${file}"
    done

    return 1
}

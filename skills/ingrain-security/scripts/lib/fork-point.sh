# Fork-point resolution for the ingrain-security plugin — where this branch was cut from,
# and whether anything has changed since.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: callers run `set -uo pipefail` WITHOUT
# `-e` on purpose (git lookups on a non-git or detached-HEAD checkout must degrade to an
# empty result, not abort), and sourcing must not change that.
# Self-contained: every function takes the project root and branch as arguments, so this
# file requires nothing from its siblings — a caller resolves those two however it likes.
#
# Sourced by:
#   skills/ingrain-security/scripts/branch-delta    (serves the delta: refs, files, diff)
#   skills/ingrain-security/scripts/assessment-mint (sources it so mint.sh, which calls
#                                                    resolve_delta_facts, can resolve `phase`)
#
# Two consumers, one resolution: the delta is what separates "the implementation is still
# ahead" from "there is code to verify", so the minter's `phase` and branch-delta's refs must
# never disagree about it. They would drift the moment each computed it for itself.

# Every local and remote ref EXCEPT the branch we are on — under every name it goes by.
# Emitting the current branch here would make a single-branch repo look like it had a
# candidate it merely failed to diverge from, which is what separates `no-fork-point` from
# `no-divergence`.
#
# Its REMOTE-TRACKING copies are excluded alongside its local ref, and that is load-bearing
# rather than tidy: `origin/<branch>` is not a parent, it is this same branch as the server
# last saw it. Its merge-base with HEAD is therefore the last push — not a branch point — so
# left in the candidate set it wins the most-recent contest on any branch carrying unpushed
# commits, and the review silently narrows to the unpushed tail while reporting a fork point
# as though it had resolved one.
other_refs() {
    local root="$1" branch="$2" ref remote self

    # The current branch's own names, one per line: its local ref plus <remote>/<branch>
    # for every configured remote. Empty when HEAD is detached, where no ref is "ours".
    self=""
    if [ -n "${branch}" ]; then
        self="${branch}"
        while IFS= read -r remote; do
            [ -n "${remote}" ] && self="${self}
${remote}/${branch}"
        done <<EOF
$(git -C "${root}" remote 2>/dev/null)
EOF
    fi

    # `--exclude` rather than another name test: `refs/remotes/origin/HEAD` renders as the bare
    # remote name under `%(refname:short)`, so it matches neither `<branch>` nor
    # `<remote>/<branch>` and slipped through the exclusion below. It is a symbolic alias for a
    # branch already in this list, and counting it once picked the last push as the fork point —
    # silently hiding every pushed commit from the review, which is the exact failure the
    # exclusion exists to prevent. No name-based test can catch it; it has to go at the source.
    git -C "${root}" for-each-ref --format='%(refname:short)' \
        --exclude='refs/remotes/*/HEAD' refs/heads refs/remotes \
        | while IFS= read -r ref; do
            printf '%s\n' "${self}" | grep -qxF -- "${ref}" && continue
            printf '%s\n' "${ref}"
          done
}

# Resolve the nearest branch point as a single TAB-separated line: <ct>\t<ref>\t<merge-base>.
# Echoes empty when nothing qualifies, which is the caller's fallback signal.
#
# The result is CAPTURED and tested for emptiness rather than checked by exit status: under
# `pipefail`, `head -1` closing the pipe SIGPIPEs the upstream loop and the pipeline reports
# 141 on a perfectly successful resolve.
resolve_fork_point() {
    local root="$1" branch="$2" head_sha="$3"
    other_refs "${root}" "${branch}" \
        | while IFS= read -r ref; do
            local mb
            mb="$(git -C "${root}" merge-base HEAD "${ref}" 2>/dev/null)" || continue
            { [ -z "${mb}" ] || [ "${mb}" = "${head_sha}" ]; } && continue
            printf '%s\t%s\t%s\n' \
                "$(git -C "${root}" show -s --format=%ct "${mb}" 2>/dev/null)" "${ref}" "${mb}"
          done \
        | sort -s -k1,1rn | head -1
}

# Resolve this branch's delta against its fork point. $1 project_root, $2 branch (empty when
# HEAD is detached). Sets the DELTA_* globals below and returns 0; every degraded case is a
# populated result, never a failure — a non-git tree and an empty repo are ordinary states.
#
# Globals rather than a printed record: the caller wants nine fields, and threading those
# through a delimiter would put a parse between two files that already share a process.
#
#   DELTA_BASE_REF       the parent branch, or "" when none resolved
#   DELTA_DIFF_REF       what to diff against — the merge-base, or HEAD on fallback
#   DELTA_FALLBACK       true when no fork point resolved
#   DELTA_REASON         why, when fallback: not-a-git-repository|no-commits|no-divergence|no-fork-point
#   DELTA_SHALLOW        true on a shallow clone
#   DELTA_COMMITS_AHEAD  commits since DELTA_DIFF_REF
#   DELTA_UNCOMMITTED    true when the working tree is dirty
#   DELTA_EMPTY          true when there is nothing on this branch to review
#
# The DELTA_* names are this function's return value, read by callers in OTHER files —
# branch-delta builds its JSON from them, mint.sh resolves `phase`. ShellCheck sees only
# this file, so it reports every one of them as written-never-read; the disable is scoped to
# the function that sets them rather than the file, so a genuinely unused local still warns.
# shellcheck disable=SC2034
resolve_delta_facts() {
    local root="$1" branch="$2" head_sha best status_out

    DELTA_BASE_REF=""
    DELTA_DIFF_REF="HEAD"
    DELTA_FALLBACK="true"
    DELTA_REASON=""
    DELTA_SHALLOW="false"
    DELTA_COMMITS_AHEAD=0
    DELTA_UNCOMMITTED="false"

    # `status --porcelain` answers on any git checkout, including one with no commits at
    # all (untracked files still show), so it is read before the HEAD guard below.
    if git -C "${root}" rev-parse --git-dir >/dev/null 2>&1; then
        status_out="$(git -C "${root}" status --porcelain 2>/dev/null)"
        [ -n "${status_out}" ] && DELTA_UNCOMMITTED="true"
        [ "$(git -C "${root}" rev-parse --is-shallow-repository 2>/dev/null)" = "true" ] \
            && DELTA_SHALLOW="true"
    else
        DELTA_REASON="not-a-git-repository"
    fi

    if [ -z "${DELTA_REASON}" ]; then
        # An empty repo fails rev-parse/show/rev-list alike; guard once here rather than
        # letting three calls degrade separately into a half-populated result.
        if ! head_sha="$(git -C "${root}" rev-parse --verify HEAD 2>/dev/null)" \
            || [ -z "${head_sha}" ]; then
            DELTA_REASON="no-commits"
        else
            best="$(resolve_fork_point "${root}" "${branch}" "${head_sha}")"
            if [ -n "${best}" ]; then
                DELTA_BASE_REF="$(printf '%s' "${best}" | cut -f2)"
                DELTA_DIFF_REF="$(printf '%s' "${best}" | cut -f3)"
                DELTA_FALLBACK="false"
                DELTA_COMMITS_AHEAD="$(git -C "${root}" rev-list --count "${DELTA_DIFF_REF}..HEAD" 2>/dev/null)"
                [ -n "${DELTA_COMMITS_AHEAD}" ] || DELTA_COMMITS_AHEAD=0
            elif [ "${DELTA_SHALLOW}" = "true" ]; then
                # Tested BEFORE no-divergence, which it would otherwise be mistaken for. When
                # the clone is shallow, `merge-base` failing says the history is truncated, not
                # that this branch never diverged — the opposite conclusion, and the one that
                # reports a finished implementation as "no code yet".
                DELTA_REASON="shallow-history"
            elif [ -n "$(other_refs "${root}" "${branch}")" ]; then
                # Other refs exist, but every merge-base was HEAD itself: this branch was
                # cut and nothing has been committed on it yet. HEAD still captures ALL of
                # the work, so this fallback is NOT a narrowed review.
                DELTA_REASON="no-divergence"
            else
                DELTA_REASON="no-fork-point"
            fi
        fi
    fi

    if [ "${DELTA_COMMITS_AHEAD}" -eq 0 ] && [ "${DELTA_UNCOMMITTED}" = "false" ]; then
        DELTA_EMPTY="true"
    else
        DELTA_EMPTY="false"
    fi
}

# True when DELTA_EMPTY cannot be trusted to mean "no implementation yet".
#
# `no-fork-point` and `shallow-history` qualify. The others are reliable for opposite reasons:
# `no-divergence` HAS other refs and merely never diverged, so nothing is committed; and
# `no-commits` / `not-a-git-repository` have no commits to hide. The two that qualify are the
# ones where commits exist and nothing can measure them — no ref to compare against, or a
# history too truncated to find one — so commits_ahead stays 0 and a clean tree reports empty
# while a finished implementation sits in the log. `shallow-history` is also what finally gives
# the `shallow` field a consumer; before it, nothing read it.
is_delta_unreliable() {
    [ "${DELTA_FALLBACK}" = "true" ] &&
        { [ "${DELTA_REASON}" = "no-fork-point" ] || [ "${DELTA_REASON}" = "shallow-history" ]; }
}

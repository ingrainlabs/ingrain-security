# The changed-file set for the ingrain-security plugin — resolved once, read two ways.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose (a git query on a non-git or detached-HEAD checkout must degrade
# to an empty result, not abort), and sourcing must not change that.
#
# Flat: every function is pure over its arguments and this file requires no sibling lib.
# That is why the JSON rendering of this set lives in `branch-delta` rather than here — it
# needs `escape_for_json` from lib/json.sh, and composing two libs is a script's job.
#
# Sourced by:
#   skills/ingrain-security/scripts/branch-delta      (the JSON array it reports)
#   skills/ingrain-security/scripts/assessment-mint   (the scope-change routing test)
#
# WHY THIS IS A LIB AND NOT branch-delta's PRIVATE BUSINESS. Two scripts now need the same
# answer to "what did this branch touch", and they run in the SAME block at Phase select. A
# second implementation would be free to disagree with the first, and the disagreement would
# surface as a route — the mint sending a run to Development while branch-delta reported a
# delta the run does not have. `resolve_delta_facts` in fork-point.sh is shared for exactly
# this reason and states it in the same words.

# git's one-letter status, as a word the agent reads without knowing git's table.
status_word() {
    case "$1" in
        A) printf 'added' ;;
        M) printf 'modified' ;;
        D) printf 'deleted' ;;
        T) printf 'type-changed' ;;
        *) printf '%s' "$1" ;;
    esac
}

# The COMPLETE changed-file set as NUL-delimited `status\0path\0` pairs on stdout: committed,
# staged, unstaged and untracked. No single git command covers all four, and the merge is
# deterministic — which makes it this file's job rather than something every caller re-derives.
#
# The two queries ALMOST partition the set — `diff` reports tracked paths, `ls-files --others`
# untracked ones — and git emits each in path order, which is what retires the `sort -u` this
# used to need and with it every failure around a path containing a newline.
#
# They are NOT disjoint, though, and an earlier comment claimed they were. `git rm --cached
# creds.env` — the standard way to untrack a wrongly-committed secret — leaves the path in BOTH:
# `D` against the fork point, and untracked on disk. Emitting both entries told the reviewer
# "deleted" about a file still sitting there, on exactly the question a security review asks.
# So the untracked pass wins on a collision: it is the disk truth, and the disk is what a
# reviewer opens. `seen` is what enforces that.
#
# `-z` throughout, because git octal-escapes a non-ASCII path under core.quotePath and a
# caller handed the raw text has no way to undo it. `--no-renames` on purpose: a rename lands
# as a delete plus an add, which names BOTH paths — for a security review the old location is
# as interesting as the new one, and it costs the R-parsing branch nothing to keep.
# `--exclude-standard` honours .gitignore, so the self-ignoring assessment folder drops out.
#
# NUL-delimited rather than an array, because a path may contain anything but NUL — the one
# separator no path can forge — and because a bash function cannot return an array anyway.
#
# The trailing `--` on the diff is load-bearing, not tidiness. Without it a ref that is also a
# path on disk is ambiguous — a repo holding a file called `HEAD` makes `git diff HEAD` fatal —
# and the `2>/dev/null` here turns that into an EMPTY read: no entries, `delta_empty: true`, a
# verification that judges nothing and reports success. `render_diff` survives the same input
# only because it checks the exit status; this loop cannot, so it must not be ambiguous.
changed_entries() {
    local root="$1" ref="$2" st path candidate
    # Untracked first, so the tracked pass can defer to it on a collision.
    #
    # AN ARRAY AND AN EXACT COMPARISON, because the obvious alternative is impossible here.
    # This was a NUL-delimited membership string, described as "the one separator no path can
    # forge" — but **bash cannot hold a NUL in a variable at all**: `$'\0'` expands to nothing,
    # so the string was undelimited and the test was a bare substring match. Deleting root
    # `config.ts` while adding untracked `src/config.ts` found `config.ts` inside
    # `src/config.ts` and dropped the deletion — from `branch-delta`'s "every file this change
    # touched", and from the scope-change routing, where it answers "still in scope" for a path
    # that has left it. A bash-4 associative array would also do it; `threat-retag`'s `lower()`
    # records why that is out (macOS ships bash 3.2 as /bin/bash).
    local -a untracked=()
    while IFS= read -r -d '' path; do
        untracked+=("${path}")
        printf 'untracked\0%s\0' "${path}"
    done < <(git -C "${root}" ls-files --others --exclude-standard -z 2>/dev/null)

    while IFS= read -r -d '' st && IFS= read -r -d '' path; do
        # `${untracked+…}` guards the empty-array expansion, which is an error under the
        # `set -u` every caller runs, on the bash 3.2 this file has to keep working on.
        for candidate in ${untracked+"${untracked[@]}"}; do
            [ "${candidate}" = "${path}" ] && continue 2
        done
        printf '%s\0%s\0' "$(status_word "${st:0:1}")" "${path}"
    done < <(git --no-pager -C "${root}" diff --no-color --no-ext-diff --name-status --no-renames -z "${ref}" -- 2>/dev/null)
}

# True when some changed path lies OUTSIDE every folder in the recorded footprint.
# $1 root, $2 diff ref, $3 footprint file (one path per line; blank lines ignored).
#
# WHAT THIS DECIDES. An analysis is built for a particular part of the tree, and a branch that
# later acquires work elsewhere is checked forever against the first push's threats while
# coverage silently falls behind. That is the failure worth routing on, because it looks like
# success: the review keeps passing. Outside the footprint -> re-analyse; inside -> verify.
#
# PREFIX MATCH ON A FOLDER BOUNDARY, never a bare string prefix. `backend/` must not match
# `backend-legacy/notes.ts`, which a `case` on `${entry}*` would happily accept — and matching
# it would report a change as covered by an analysis that never looked at it. A footprint entry
# is normalised to exactly one trailing slash so the boundary is part of the comparison.
#
# ABSENT OR EMPTY FOOTPRINT MEANS NO TEST. Locally nothing records one — the footprint lives on
# the platform and reaches the mint only when a caller pulled it — so the honest answer there is
# "unknown", and an unknown must not invent a promotion. Returning false preserves the routing
# every run had before this existed.
#
# A DELETED PATH STILL COUNTS. It was touched, and removing a file outside the analysed area is
# as much a scope change as adding one.
changed_outside_footprint() {
    local root="$1" ref="$2" footprint_file="$3" st path entry whole_repo="false"
    local -a prefixes=()

    [ -n "${footprint_file}" ] || return 1
    if [ ! -r "${footprint_file}" ]; then
        # A flag was passed, so the caller ASSERTED it had a footprint. Silently reading that
        # as "unknown" would route to Testing on a broken CI invariant — the failure that looks
        # like success. Loud on stderr, and the caller still degrades rather than aborting.
        printf 'changed-files: --scope-paths %s is not readable; scope-change test skipped\n' \
            "${footprint_file}" >&2
        return 1
    fi

    while IFS= read -r entry || [ -n "${entry}" ]; do
        entry="${entry%$'\r'}"
        # Trimmed before the emptiness test, or a whitespace-only line survives it as a
        # prefix of "  /" that nothing can match — which reads as "every path moved".
        entry="${entry#"${entry%%[![:space:]]*}"}"
        entry="${entry%"${entry##*[![:space:]]}"}"
        # ONE PATH PER LINE, not JSON. The platform's footprint reaches a caller inside a JSON
        # document (`ingrain retrieve` writes `{ "taskScopePaths": [...] }`), so handing that
        # file here directly is the obvious mistake — and a silent one, because every line of
        # JSON syntax becomes a prefix that matches nothing and the run reports `scope_moved`
        # forever. Extracting the paths is the caller's job; saying so is this refusal's.
        case "${entry}" in
            '{'*|'['*|'"'*)
                printf 'changed-files: --scope-paths %s looks like JSON; pass one path per line (extract them first)\n' \
                    "${footprint_file}" >&2
                return 1
                ;;
            # Repository-RELATIVE, like every path this compares against. An absolute entry can
            # never match one, so it would read as "everything moved" on every run forever —
            # the same silent, permanent misroute the JSON refusal above exists to prevent.
            /*)
                printf 'changed-files: --scope-paths %s holds an absolute path (%s); entries are repository-relative\n' \
                    "${footprint_file}" "${entry}" >&2
                return 1
                ;;
            # The repository root, however it is spelled. Left to the prefix logic below, `.`
            # becomes the prefix "./" and matches nothing — a footprint covering the WHOLE tree
            # would promote every run to Development, which is the opposite of what it says.
            # `./` normalises to empty and would simply vanish, so the two spellings of one
            # intent had opposite outcomes.
            .|./)
                whole_repo="true"
                continue
                ;;
        esac
        entry="${entry#./}"
        [ -n "${entry}" ] || continue
        # Exactly one trailing slash, however the entry was written.
        while [ "${entry}" != "${entry%/}" ]; do entry="${entry%/}"; done
        [ -n "${entry}" ] || continue
        prefixes+=("${entry}/")
    done < "${footprint_file}"

    # A footprint naming the repository root covers everything, so nothing can lie outside it.
    [ "${whole_repo}" = "true" ] && return 1

    # A footprint file that held only blanks is the same "unknown" as no file at all.
    [ "${#prefixes[@]}" -gt 0 ] || return 1

    while IFS= read -r -d '' st && IFS= read -r -d '' path; do
        for entry in "${prefixes[@]}"; do
            # UNDER the folder, and nothing else. The path is not given a trailing slash of
            # its own: comparing `${path}/` made a root FILE named `backend` match the folder
            # entry `backend/`, and a file sitting where an analysed folder used to be is
            # precisely a change the analysis never looked at. Re-analysing there is the safe
            # direction, and entries are folders — `--scope-paths` says one folder per line.
            case "${path}" in "${entry}"*) continue 2 ;; esac
        done
        return 0
    done < <(changed_entries "${root}" "${ref}")

    return 1
}

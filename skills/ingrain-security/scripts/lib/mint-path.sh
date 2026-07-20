# Shared path-minter for the ingrain-security plugin.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose (git lookups on a non-git or detached-HEAD checkout must degrade
# to an empty result, not abort), and sourcing must not change that. Requires the sibling
# project-root.sh to be sourced first (resolve_project_root, resolve_branch, seed_gitignore,
# escape_for_json).
#
# Sourced by:
#   skills/ingrain-security/scripts/assessment-path   (label: assessment)
#   skills/ingrain-security/scripts/rules-path        (label: rules)
#
# The two minters differ ONLY in their `label` (assessment | rules), which drives the
# filename lead, the JSON field prefix, the diagnostic program token, and the `instruction`
# string. Both write a deterministic `.ingrain-security/<label>-<branch-slug>-<task-slug>.md`
# path — twin sidecars in one folder — so the logic lives here and cannot drift.

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

# Mint one sidecar path. $1 host (selects project-root resolution only), $2 label
# (assessment | rules), then the mint flags. Emits ONE JSON object on stdout; diagnostics
# go to stderr. `<label>_abs` (absolute) is the CANONICAL write target; `<label>_path` is a
# display-only relative form. Returns 2 on a usage error, 1 on a runtime error, 0 on ok.
mint_path() {
    local host="$1" label="$2" host_slug title="" slug_flag="" have_slug="false" project_root
    local branch branch_slug branch_known task_slug name basename
    local target_dir path_rel path_abs file_exists instruction
    shift 2

    while [ $# -gt 0 ]; do
        case "$1" in
            --title)
                [ $# -ge 2 ] || { printf '%s-path: --title needs a value\n' "${label}" >&2; return 2; }
                title="$2"
                shift 2
                ;;
            --branch-slug)
                [ $# -ge 2 ] || { printf '%s-path: --branch-slug needs a value\n' "${label}" >&2; return 2; }
                slug_flag="$2"
                have_slug="true"
                shift 2
                ;;
            *)
                printf '%s-path: unknown mint flag "%s"\n' "${label}" "$1" >&2
                return 2
                ;;
        esac
    done

    project_root="$(resolve_project_root "${host}")"
    [ -n "${project_root}" ] || { printf '%s-path: could not resolve project root\n' "${label}" >&2; return 1; }

    host_slug="$(slugify "${host}")"
    [ -n "${host_slug}" ] || { printf '%s-path: invalid host token "%s"\n' "${label}" "${host}" >&2; return 2; }

    # Reuse the caller's already-resolved slug when given; otherwise resolve from git.
    if [ "${have_slug}" = "true" ]; then
        branch_slug="$(slugify "${slug_flag}")"
        branch=""
    else
        branch="$(resolve_branch "${project_root}")"
        branch_slug="$(slugify "${branch}")"
    fi
    if [ -n "${branch_slug}" ]; then branch_known="true"; else branch_known="false"; fi

    task_slug="$(slugify "${title}")"

    target_dir=".ingrain-security"

    # Never write into a symlinked target — a crafted repo could redirect it outside
    # the tree (same guard as ensure-assessment-dir). Then ensure the folder and its
    # self-ignoring .gitignore exist before the agent writes the file.
    if [ -L "${project_root}/${target_dir}" ]; then
        printf '%s-path: %s is a symlink; refusing\n' "${label}" "${target_dir}" >&2
        return 1
    fi
    mkdir -p "${project_root}/${target_dir}" 2>/dev/null \
        || { printf '%s-path: could not create %s\n' "${label}" "${target_dir}" >&2; return 1; }
    seed_gitignore "${project_root}/${target_dir}"

    name="${label}"
    [ "${branch_known}" = "true" ] && name="${name}-${branch_slug}"
    [ -n "${task_slug}" ] && name="${name}-${task_slug}"
    basename="${name}.md"
    path_rel="${target_dir}/${basename}"
    path_abs="${project_root}/${path_rel}"

    if [ -f "${path_abs}" ]; then file_exists="true"; else file_exists="false"; fi

    # Carried in the JSON so the absolute path and the rule governing it arrive together,
    # in the same tool result, at the moment the agent is about to write. A static sentence
    # in SKILL.md is read thousands of tokens earlier and gets lost; this one is unmissable
    # and already has the path substituted in.
    case "${label}" in
        rules)
            instruction="Write the retrieved org rules ONLY to rules_abs (${path_abs}). That folder is this repository's single .ingrain-security/ directory and it already exists — never create an .ingrain-security/ folder anywhere else, and never resolve the path against the file you happen to be editing. Pass rules_abs verbatim to every Write/Edit call; rules_path is a display-only form for prose and links."
            ;;
        *)
            instruction="Write the assessment ONLY to assessment_abs (${path_abs}). That folder is this repository's single .ingrain-security/ directory and it already exists — never create an .ingrain-security/ folder anywhere else, and never resolve the path against the file you happen to be editing. Pass assessment_abs verbatim to every worker dispatch and to every Write/Edit call; assessment_path is a display-only form for prose and links."
            ;;
    esac

    printf '{"host":"%s","project_root":"%s","branch":"%s","branch_slug":"%s","branch_known":%s,"task_slug":"%s","%s_dir":"%s","%s_path":"%s","%s_abs":"%s","basename":"%s","file_exists":%s,"instruction":"%s"}\n' \
        "$(escape_for_json "${host_slug}")" \
        "$(escape_for_json "${project_root}")" \
        "$(escape_for_json "${branch}")" \
        "${branch_slug}" \
        "${branch_known}" \
        "${task_slug}" \
        "${label}" "${target_dir}" \
        "${label}" "$(escape_for_json "${path_rel}")" \
        "${label}" "$(escape_for_json "${path_abs}")" \
        "${basename}" \
        "${file_exists}" \
        "$(escape_for_json "${instruction}")"
}

# Dispatch for a minter script. $1 label, $2 the caller's usage-function name, then argv.
# Byte-identical stderr/exit behavior to the pre-refactor per-script `main`.
mint_dispatch() {
    local label="$1" usage_fn="$2"
    shift 2

    case "${1:-}" in
        -h|--help)
            "${usage_fn}"
            return 0
            ;;
        "")
            printf '%s-path: missing <host>. Try --help.\n' "${label}" >&2
            return 2
            ;;
    esac

    local host="$1" subcommand="${2:-}"
    case "${subcommand}" in
        mint) shift 2; mint_path "${host}" "${label}" "$@" ;;
        "")
            printf '%s-path: missing subcommand (mint). Try --help.\n' "${label}" >&2
            return 2
            ;;
        *)
            printf '%s-path: unknown subcommand "%s" (mint). Try --help.\n' "${label}" "${subcommand}" >&2
            return 2
            ;;
    esac
}

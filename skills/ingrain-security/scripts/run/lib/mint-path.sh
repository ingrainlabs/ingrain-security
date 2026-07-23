# The path-minting shared by run/mint-assessment-path (label: assessment) and
# run/mint-rules-path (label: rules). They differ ONLY in that label, which drives the filename
# lead, the JSON field prefix, the diagnostic token and the `instruction` string — so the logic
# lives here and cannot drift.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sets no shell options; needs ../../lib/project-root.sh sourced first (resolve_project_root,
# resolve_branch, seed_gitignore, escape_for_json).

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

# Mint one sidecar path, seeding the artifact's empty skeleton when the file is absent.
# $1 host (selects project-root resolution only), $2 label (assessment | rules), then the
# mint flags. Emits ONE JSON object on stdout; diagnostics go to stderr. `<label>_abs`
# (absolute) is the CANONICAL write target; `<label>_path` is a display-only relative form.
# `file_exists` reports whether the artifact already holds WRITTEN CONTENT — an untouched
# skeleton reads as absent, and `template_seeded` / `template_only` say which of the two
# empty cases this is. Returns 2 on a usage error, 1 on a runtime error, 0 on ok.
mint_path() {
    local host="$1" label="$2"
    shift 2

    local title="" slug_flag="" have_slug="false"
    while [ $# -gt 0 ]; do
        case "$1" in
            --title)
                [ $# -ge 2 ] || { printf 'mint-%s-path: --title needs a value\n' "${label}" >&2; return 2; }
                title="$2"
                shift 2
                ;;
            --branch-slug)
                [ $# -ge 2 ] || { printf 'mint-%s-path: --branch-slug needs a value\n' "${label}" >&2; return 2; }
                slug_flag="$2"
                have_slug="true"
                shift 2
                ;;
            *)
                printf 'mint-%s-path: unknown mint flag "%s"\n' "${label}" "$1" >&2
                return 2
                ;;
        esac
    done

    local project_root
    project_root="$(resolve_project_root "${host}")"
    [ -n "${project_root}" ] || { printf 'mint-%s-path: could not resolve project root\n' "${label}" >&2; return 1; }

    local host_slug
    host_slug="$(slugify "${host}")"
    [ -n "${host_slug}" ] || { printf 'mint-%s-path: invalid host token "%s"\n' "${label}" "${host}" >&2; return 2; }

    # Reuse the caller's already-resolved slug when given; otherwise resolve from git.
    local branch branch_slug
    if [ "${have_slug}" = "true" ]; then
        branch_slug="$(slugify "${slug_flag}")"
        branch=""
    else
        branch="$(resolve_branch "${project_root}")"
        branch_slug="$(slugify "${branch}")"
    fi
    local branch_known
    if [ -n "${branch_slug}" ]; then branch_known="true"; else branch_known="false"; fi

    local task_slug
    task_slug="$(slugify "${title}")"

    local target_dir=".ingrain-security"

    # Never write into a symlinked target — a crafted repo could redirect it outside
    # the tree (same guard as ensure-assessment-dir). Then ensure the folder and its
    # self-ignoring .gitignore exist before the agent writes the file.
    if [ -L "${project_root}/${target_dir}" ]; then
        printf 'mint-%s-path: %s is a symlink; refusing\n' "${label}" "${target_dir}" >&2
        return 1
    fi
    mkdir -p "${project_root}/${target_dir}" 2>/dev/null \
        || { printf 'mint-%s-path: could not create %s\n' "${label}" "${target_dir}" >&2; return 1; }
    seed_gitignore "${project_root}/${target_dir}"

    local name="${label}"
    [ "${branch_known}" = "true" ] && name="${name}-${branch_slug}"
    [ -n "${task_slug}" ] && name="${name}-${task_slug}"
    local basename="${name}.md"
    local path_rel="${target_dir}/${basename}"
    local path_abs="${project_root}/${path_rel}"

    # Seed the empty skeleton so no writer starts from a blank page, and read back what the
    # file actually holds. `file_exists` reports CONTENT, not the inode: an untouched
    # skeleton is reported as absent, so every reader of this field — Phase select, the
    # resume check, the "were org rules retrieved" check — keeps its meaning now that a
    # mint always leaves a file behind.
    # `local` on its own line: folding the substitution into it would replace the exit
    # status of seed_artifact_template with `local`'s own, swallowing a failed write.
    local seed_state
    seed_state="$(seed_artifact_template "${label}" "${title}" "${path_abs}")" \
        || { printf '%s-path: could not write %s\n' "${label}" "${path_abs}" >&2; return 1; }
    local file_exists template_seeded template_only
    case "${seed_state}" in
        seeded)        file_exists="false" template_seeded="true"  template_only="true"  ;;
        template_only) file_exists="false" template_seeded="false" template_only="true"  ;;
        *)             file_exists="true"  template_seeded="false" template_only="false" ;;
    esac

    # Carried in the JSON so the absolute path and the rule governing it arrive together,
    # in the same tool result, at the moment the agent is about to write. A static sentence
    # in SKILL.md is read thousands of tokens earlier and gets lost; this one is unmissable
    # and already has the path substituted in.
    local instruction
    case "${label}" in
        rules)
            instruction="Write the retrieved org rules ONLY to rules_abs (${path_abs}). That folder is this repository's single .ingrain-security/ directory and it already exists — never create an .ingrain-security/ folder anywhere else, and never resolve the path against the file you happen to be editing. Pass rules_abs verbatim to every Write/Edit call; rules_path is a display-only form for prose and links. The file already holds the correct empty skeleton — fill its sections in place rather than re-creating the page."
            ;;
        *)
            instruction="Write the assessment ONLY to assessment_abs (${path_abs}). That folder is this repository's single .ingrain-security/ directory and it already exists — never create an .ingrain-security/ folder anywhere else, and never resolve the path against the file you happen to be editing. Pass assessment_abs verbatim to every worker dispatch and to every Write/Edit call; assessment_path is a display-only form for prose and links. The file already holds the correct empty skeleton — fill its sections in place rather than re-creating the page or restating its table headers."
            ;;
    esac

    printf '{"host":"%s","project_root":"%s","branch":"%s","branch_slug":"%s","branch_known":%s,"task_slug":"%s","%s_dir":"%s","%s_path":"%s","%s_abs":"%s","basename":"%s","file_exists":%s,"template_seeded":%s,"template_only":%s,"instruction":"%s"}\n' \
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
        "${template_seeded}" \
        "${template_only}" \
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
            printf 'mint-%s-path: missing <host>. Try --help.\n' "${label}" >&2
            return 2
            ;;
    esac

    local host="$1" subcommand="${2:-}"
    case "${subcommand}" in
        mint) shift 2; mint_path "${host}" "${label}" "$@" ;;
        "")
            printf 'mint-%s-path: missing subcommand (mint). Try --help.\n' "${label}" >&2
            return 2
            ;;
        *)
            printf 'mint-%s-path: unknown subcommand "%s" (mint). Try --help.\n' "${label}" "${subcommand}" >&2
            return 2
            ;;
    esac
}

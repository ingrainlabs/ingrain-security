#!/usr/bin/env bash
# Pre-merge version bump for a pull request targeting the default branch.
#
# Run by .github/workflows/version-bump.yml. Picks a bump size from the PR's
# release:* labels, computes the next version from main's current version (so the
# result is idempotent across re-runs and label changes), writes it across the
# config files via release.sh, and commits the change back to the PR branch.
#
# Inputs (environment):
#   LABELS    JSON array of the PR's label names, e.g. '["release:minor"]'
#   HEAD_REF  The PR branch to push the bump commit to
#
# Requires: jq, git, and .github/release.sh (its deps: jq, perl)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RELEASE_SH="${SCRIPT_DIR}/release.sh"
cd "${REPO_ROOT}"

: "${LABELS:?LABELS env var is required}"
: "${HEAD_REF:?HEAD_REF env var is required}"

# The exact set of files release.sh manages. The workflow runs this script with
# the PR checkout's .github/ scripts replaced by the trusted base-branch copies,
# so the commit below is scoped to these paths (never `git commit -a`) to keep
# that overlay — and any other file a PR may have tampered with — out of the
# bump commit. Read with a bash-3.2-portable loop (no mapfile).
VERSION_FILES=()
while IFS= read -r file; do VERSION_FILES+=("${file}"); done < <("${RELEASE_SH}" --files)

# release:skip opts the PR out of versioning entirely, but still verify the
# existing version locations agree so drift can't slip through pre-merge.
if printf '%s' "${LABELS}" | jq -e 'index("release:skip")' >/dev/null; then
    echo "release:skip label present; not bumping the version."
    "${RELEASE_SH}" --check
    exit 0
fi

# Highest matching label wins; default to patch when none is set.
if printf '%s' "${LABELS}" | jq -e 'index("release:major")' >/dev/null; then
    kind=major
elif printf '%s' "${LABELS}" | jq -e 'index("release:minor")' >/dev/null; then
    kind=minor
else
    kind=patch
fi

# Always bump from main's current version so the result is idempotent:
# re-runs and label changes recompute cleanly instead of compounding.
git fetch origin main --quiet
base="$(git show origin/main:.claude-plugin/plugin.json | jq -r .version)"
next="$("${RELEASE_SH}" --bump "${kind}" "${base}")"
echo "Bumping to v${next} (${kind} from v${base})."

"${RELEASE_SH}" "${next}"
"${RELEASE_SH}" --check

if git diff --quiet -- "${VERSION_FILES[@]}"; then
    echo "Version already at v${next}; nothing to commit."
    exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git commit -m "Set release version to v${next}" -- "${VERSION_FILES[@]}"
git push origin "HEAD:${HEAD_REF}"

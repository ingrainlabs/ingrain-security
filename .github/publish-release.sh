#!/usr/bin/env bash
# Tags the merged release on the default branch and pins both catalogs to it.
#
# Run by .github/workflows/release.yml after a PR merges into main. Verifies the
# config files agree on a version and — unless that version is already tagged —
# creates and pushes the v<version> tag at the merged commit. It then records
# that commit in both marketplace catalogs' source.sha and pushes a single
# follow-up "Pin v<version>…" commit to main, so the tag and the pinned sha refer
# to the same commit. (A commit can't contain its own hash, so the pin must be a
# separate commit; with rebase merging main stays linear and one commit ahead of
# the tag.) Emits two GitHub Actions step outputs:
#   version  the resolved version (without the leading v)
#   release  "true" when a new tag was pushed, "false" when already released
# The workflow uses `release` to decide whether to publish the GitHub Release.
#
# Pushing the pin commit to main requires the workflow's actor to bypass the main
# branch rulesets.
#
# Requires: git and .github/release.sh (its deps: jq, perl)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RELEASE_SH="${SCRIPT_DIR}/release.sh"
cd "${REPO_ROOT}"

# Emit a key=value GitHub Actions step output; falls back to stdout for local runs.
emit() { echo "$1=$2" >>"${GITHUB_OUTPUT:-/dev/stdout}"; }

git fetch --tags --quiet
"${RELEASE_SH}" --check
version="$("${RELEASE_SH}" --current)"
emit version "${version}"

# An existing tag means the merge didn't change the version (e.g. a release:skip
# PR), so there is nothing to release.
if git rev-parse "v${version}" >/dev/null 2>&1; then
    echo "v${version} already exists; no version change to release."
    emit release false
    exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# Tag the merged commit, then pin both catalogs to it so the tag and source.sha
# refer to the same commit.
git tag "v${version}"
git push origin "v${version}"

sha="$(git rev-parse "v${version}^{commit}")"
"${RELEASE_SH}" --set-sha "${sha}"
"${RELEASE_SH}" --check
if ! git diff --quiet; then
    git commit -am "Pin v${version} plugin source to ${sha}"
    git push origin HEAD:main
fi
emit release true

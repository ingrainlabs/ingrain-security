#!/usr/bin/env bash
# Release version manager for the ingrain-security plugin.
#
# The plugin version is duplicated across three config files that must stay in
# lockstep. This script is the single source of truth for reading, bumping, and
# verifying that version. It only edits files — committing and tagging are left
# to the caller (or the release GitHub Action that wraps this script).
#
# Version locations (canonical source listed first):
#   .claude-plugin/plugin.json       .version
#   .claude-plugin/marketplace.json  .plugins[0].version
#   .codex-plugin/plugin.json        .version
#
# The marketplace also pins the plugin's git source to the release tag so that
# tags — not the default branch — drive the content users receive. This ref is
# kept in lockstep too, as "v<version>":
#   .claude-plugin/marketplace.json  .plugins[0].source.ref
#
# Usage:
#   .github/release.sh <x.y.z>             Set an explicit version everywhere
#   .github/release.sh patch|minor|major   Bump the current version
#   .github/release.sh --check             Verify all files agree (exit 1 on drift)
#   .github/release.sh --current           Print the canonical current version
#
# Requires: jq, perl

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Canonical source is listed first; --check validates the rest against it.
CANONICAL_FILE="${REPO_ROOT}/.claude-plugin/plugin.json"
CANONICAL_PATH=".version"

# Each target is "file<TAB>jq-path". The canonical file is in this list too so a
# single loop writes every location.
TARGETS=(
    "${REPO_ROOT}/.claude-plugin/plugin.json	.version"
    "${REPO_ROOT}/.claude-plugin/marketplace.json	.plugins[0].version"
    "${REPO_ROOT}/.codex-plugin/plugin.json	.version"
)

# The marketplace pins the plugin source to the release tag ("v<version>") so
# git tags determine the content users install. Kept in lockstep with the
# version above.
MARKETPLACE_FILE="${REPO_ROOT}/.claude-plugin/marketplace.json"
REF_PATH=".plugins[0].source.ref"

die() {
    echo "release: $*" >&2
    exit 1
}

command -v jq >/dev/null || die "jq is required but not found on PATH"

# Read a version from a file at a jq path.
read_version() {
    local file="$1" path="$2"
    jq -r "${path} // empty" "${file}"
}

current_version() {
    local v
    v="$(read_version "${CANONICAL_FILE}" "${CANONICAL_PATH}")"
    [ -n "${v}" ] || die "no version found at ${CANONICAL_PATH} in ${CANONICAL_FILE}"
    echo "${v}"
}

# Validate a semver MAJOR.MINOR.PATCH (no pre-release/build suffixes).
assert_semver() {
    [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "not a valid x.y.z version: '$1'"
}

# Compute the next version from a bump keyword.
bump_version() {
    local current="$1" kind="$2"
    assert_semver "${current}"
    local major minor patch
    IFS=. read -r major minor patch <<<"${current}"
    case "${kind}" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
        *) die "unknown bump kind: ${kind}" ;;
    esac
    echo "${major}.${minor}.${patch}"
}

# Write a version into a single file at a jq path.
#
# jq would reformat the whole file (exploding inline objects/arrays), so writing
# is done as a surgical replacement of just the version value: read the file's
# current value at the path, then swap that exact string on its "version" line.
# This preserves all other formatting byte-for-byte. \Q..\E keeps the old value
# literal so its dots are not treated as regex metacharacters.
write_version() {
    local file="$1" path="$2" version="$3"
    local old
    old="$(read_version "${file}" "${path}")"
    [ -n "${old}" ] || die "no version found at ${path} in ${file}"
    [ "${old}" = "${version}" ] && return 0
    perl -i -pe 's/("version"\s*:\s*")\Q'"${old}"'\E(")/${1}'"${version}"'${2}/' "${file}"
}

# Read the pinned source ref from the marketplace file.
read_ref() {
    jq -r "${REF_PATH} // empty" "${MARKETPLACE_FILE}"
}

# Pin the plugin source ref to "v<version>". Like write_version, this swaps only
# the ref value so all other JSON formatting is preserved byte-for-byte.
write_ref() {
    local tag="v$1" old
    old="$(read_ref)"
    [ -n "${old}" ] || die "no source ref found at ${REF_PATH} in ${MARKETPLACE_FILE}"
    [ "${old}" = "${tag}" ] && return 0
    perl -i -pe 's/("ref"\s*:\s*")\Q'"${old}"'\E(")/${1}'"${tag}"'${2}/' "${MARKETPLACE_FILE}"
}

# Set the version across every target file, and pin the source ref to the tag.
set_all() {
    local version="$1"
    assert_semver "${version}"
    local entry file path
    for entry in "${TARGETS[@]}"; do
        IFS=$'\t' read -r file path <<<"${entry}"
        write_version "${file}" "${path}" "${version}"
        echo "  ${file#"${REPO_ROOT}/"} -> ${version}"
    done
    write_ref "${version}"
    echo "  ${MARKETPLACE_FILE#"${REPO_ROOT}/"} source.ref -> v${version}"
}

# Verify every target file matches the canonical version. Exit 1 on any drift.
check_all() {
    local canonical entry file path actual ok=1
    canonical="$(current_version)"
    for entry in "${TARGETS[@]}"; do
        IFS=$'\t' read -r file path <<<"${entry}"
        actual="$(read_version "${file}" "${path}")"
        if [ "${actual}" != "${canonical}" ]; then
            echo "  DRIFT ${file#"${REPO_ROOT}/"}: '${actual}' != '${canonical}'" >&2
            ok=0
        fi
    done
    local expected_ref="v${canonical}" actual_ref
    actual_ref="$(read_ref)"
    if [ "${actual_ref}" != "${expected_ref}" ]; then
        echo "  DRIFT ${MARKETPLACE_FILE#"${REPO_ROOT}/"} source.ref: '${actual_ref}' != '${expected_ref}'" >&2
        ok=0
    fi
    if [ "${ok}" -ne 1 ]; then
        echo "release: version drift detected (expected ${canonical})" >&2
        return 1
    fi
    echo "release: all files agree on ${canonical}"
}

main() {
    [ $# -eq 1 ] || die "expected exactly one argument; run with --help"
    case "$1" in
        -h | --help)
            sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            ;;
        --current)
            current_version
            ;;
        --check)
            check_all
            ;;
        patch | minor | major)
            local cur next
            cur="$(current_version)"
            next="$(bump_version "${cur}" "$1")"
            echo "release: ${1} bump ${cur} -> ${next}"
            set_all "${next}"
            ;;
        *)
            assert_semver "$1"
            echo "release: setting version ${1}"
            set_all "$1"
            ;;
    esac
}

main "$@"

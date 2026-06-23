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
# Both marketplace catalogs also pin the plugin's git source to the release tag
# so that tags — not the default branch — drive the content users receive. These
# refs are kept in lockstep too, as "v<version>":
#   .claude-plugin/marketplace.json  .plugins[0].source.ref  (Claude Code)
#   .agents/plugins/marketplace.json .plugins[0].source.ref  (Codex)
#
# Each catalog also carries a source.sha — the immutable commit the release tag
# points to, so a moved tag can't change the content installers receive. The sha
# can only be known after the release commit lands on the default branch, so it
# is set by the release workflow (--set-sha), not by a version bump. --check only
# asserts both catalogs agree on a valid sha, not which commit it is.
#   .claude-plugin/marketplace.json  .plugins[0].source.sha  (Claude Code)
#   .agents/plugins/marketplace.json .plugins[0].source.sha  (Codex)
#
# Usage:
#   .github/release.sh <x.y.z>             Set an explicit version everywhere
#   .github/release.sh patch|minor|major   Bump the current version
#   .github/release.sh --bump <kind> <ver> Print <ver> bumped by kind (no writes)
#   .github/release.sh --set-sha <40hex>   Pin both catalogs' source.sha to a commit
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

# Each marketplace catalog pins the plugin source to the release tag ("v<version>")
# so git tags determine the content users install. Kept in lockstep with the
# version above. Each entry is "file<TAB>jq-path", mirroring TARGETS.
REF_TARGETS=(
    "${REPO_ROOT}/.claude-plugin/marketplace.json	.plugins[0].source.ref"
    "${REPO_ROOT}/.agents/plugins/marketplace.json	.plugins[0].source.ref"
)

# Each marketplace catalog also pins source.sha to the exact commit the release
# tag points to. Unlike the version and ref, the sha is not derived from the
# version — it is set after the release commit exists (see --set-sha). Each entry
# is "file<TAB>jq-path", mirroring REF_TARGETS.
SHA_TARGETS=(
    "${REPO_ROOT}/.claude-plugin/marketplace.json	.plugins[0].source.sha"
    "${REPO_ROOT}/.agents/plugins/marketplace.json	.plugins[0].source.sha"
)

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

# Validate a full 40-character git commit SHA (lowercase hex).
assert_sha() {
    [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die "not a valid 40-char commit sha: '$1'"
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

# Read a pinned source ref from a file at a jq path.
read_ref() {
    local file="$1" path="$2"
    jq -r "${path} // empty" "${file}"
}

# Pin a source ref to "v<version>". Like write_version, this swaps only the ref
# value so all other JSON formatting is preserved byte-for-byte.
write_ref() {
    local file="$1" path="$2" tag="v$3" old
    old="$(read_ref "${file}" "${path}")"
    [ -n "${old}" ] || die "no source ref found at ${path} in ${file}"
    [ "${old}" = "${tag}" ] && return 0
    perl -i -pe 's/("ref"\s*:\s*")\Q'"${old}"'\E(")/${1}'"${tag}"'${2}/' "${file}"
}

# Read a pinned source sha from a file at a jq path.
read_sha() {
    local file="$1" path="$2"
    jq -r "${path} // empty" "${file}"
}

# Pin a source sha to a commit. Like write_ref, this swaps only the sha value so
# all other JSON formatting is preserved byte-for-byte.
write_sha() {
    local file="$1" path="$2" sha="$3" old
    old="$(read_sha "${file}" "${path}")"
    [ -n "${old}" ] || die "no source sha found at ${path} in ${file}"
    [ "${old}" = "${sha}" ] && return 0
    perl -i -pe 's/("sha"\s*:\s*")\Q'"${old}"'\E(")/${1}'"${sha}"'${2}/' "${file}"
}

# Pin every catalog's source sha to a commit. Used by the release workflow once
# the release commit exists; not part of a version bump (the sha isn't known yet).
set_sha_all() {
    local sha="$1"
    assert_sha "${sha}"
    local entry file path
    for entry in "${SHA_TARGETS[@]}"; do
        IFS=$'\t' read -r file path <<<"${entry}"
        write_sha "${file}" "${path}" "${sha}"
        echo "  ${file#"${REPO_ROOT}/"} source.sha -> ${sha}"
    done
}

# Set the version across every target file, and pin every source ref to the tag.
set_all() {
    local version="$1"
    assert_semver "${version}"
    local entry file path
    for entry in "${TARGETS[@]}"; do
        IFS=$'\t' read -r file path <<<"${entry}"
        write_version "${file}" "${path}" "${version}"
        echo "  ${file#"${REPO_ROOT}/"} -> ${version}"
    done
    for entry in "${REF_TARGETS[@]}"; do
        IFS=$'\t' read -r file path <<<"${entry}"
        write_ref "${file}" "${path}" "${version}"
        echo "  ${file#"${REPO_ROOT}/"} source.ref -> v${version}"
    done
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
    for entry in "${REF_TARGETS[@]}"; do
        IFS=$'\t' read -r file path <<<"${entry}"
        actual_ref="$(read_ref "${file}" "${path}")"
        if [ "${actual_ref}" != "${expected_ref}" ]; then
            echo "  DRIFT ${file#"${REPO_ROOT}/"} source.ref: '${actual_ref}' != '${expected_ref}'" >&2
            ok=0
        fi
    done
    # The sha is set after a release commit exists, so --check can't know which
    # commit is correct. It only asserts every catalog carries the same valid sha.
    local first_sha="" actual_sha
    for entry in "${SHA_TARGETS[@]}"; do
        IFS=$'\t' read -r file path <<<"${entry}"
        actual_sha="$(read_sha "${file}" "${path}")"
        if ! [[ "${actual_sha}" =~ ^[0-9a-f]{40}$ ]]; then
            echo "  DRIFT ${file#"${REPO_ROOT}/"} source.sha: '${actual_sha}' is not a 40-char sha" >&2
            ok=0
        elif [ -z "${first_sha}" ]; then
            first_sha="${actual_sha}"
        elif [ "${actual_sha}" != "${first_sha}" ]; then
            echo "  DRIFT ${file#"${REPO_ROOT}/"} source.sha: '${actual_sha}' != '${first_sha}'" >&2
            ok=0
        fi
    done
    if [ "${ok}" -ne 1 ]; then
        echo "release: version drift detected (expected ${canonical})" >&2
        return 1
    fi
    echo "release: all files agree on ${canonical}"
}

main() {
    # --bump is the only mode that takes extra arguments; handle it first so the
    # single-argument guard below covers every other mode.
    if [ "${1:-}" = "--bump" ]; then
        [ $# -eq 3 ] || die "usage: --bump <patch|minor|major> <x.y.z>"
        bump_version "$3" "$2"
        return
    fi
    # --set-sha takes the commit sha as a second argument.
    if [ "${1:-}" = "--set-sha" ]; then
        [ $# -eq 2 ] || die "usage: --set-sha <40-char-commit-sha>"
        echo "release: pinning source.sha to $2"
        set_sha_all "$2"
        return
    fi
    [ $# -eq 1 ] || die "expected exactly one argument; run with --help"
    case "$1" in
        -h | --help)
            sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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

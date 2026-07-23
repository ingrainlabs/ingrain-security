# Canonicalizing a path — generic, and shared by both grants, whose tests are path EQUALITY
# comparisons: both sides have to be spelled the same way, and that spelling is what this file
# owns.
#
# Declares its dialect here because it is sourced, not executed.
# shellcheck shell=bash
#
# Sourced by all four allow hooks. Sets no shell options.

# Resolve a directory to its PHYSICAL path, every symlink component followed (`pwd -P`, not
# the logical `pwd` of normalize_dir).
#
# The logical form cannot give one spelling: macOS alone hands out both `/var/…` and
# `/private/var/…` for one directory. Physical resolution also stops a symlinked component
# smuggling a target out of a folder while still comparing equal.
#
# The `cd` runs in a subshell, so a bare call cannot move the caller — which matters because
# absolutize() resolves a relative path against $PWD.
physical_dir() {
    [ -n "${1:-}" ] || return 1
    (cd "$1" 2>/dev/null && pwd -P)
}

# True when the path is absolute: POSIX (`/…`) or a Windows drive (`C:\…`, `C:/…`), which
# is the form a Git Bash hook is handed on Windows.
is_absolute() {
    case "$1" in
        /*) return 0 ;;
        [A-Za-z]:[/\\]*) return 0 ;;
        *) return 1 ;;
    esac
}

# Make a tool-supplied path absolute and forward-slashed: a drive-letter path arrives with
# backslashes that dirname/cd cannot follow, and a relative path is relative to the cwd the
# host reported. Echoes the result; never fails.
absolutize() {
    local path="$1" cwd="${2:-}"
    if [[ "${path}" =~ ^[A-Za-z]:[/\\] ]]; then
        path="${path//\\//}"
    fi
    is_absolute "${path}" || path="${cwd:-$PWD}/${path}"
    printf '%s' "${path}"
}

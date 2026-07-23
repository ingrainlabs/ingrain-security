# Canonicalizing a path. Generic — nothing here knows what a hook is; it takes any path and any
# cwd. SHARED by both grants: `write/allow-write-check.sh` compares a write target against the
# assessment folder, `run/allow-run-check.sh` compares a command's script against the runnable
# folder, and both comparisons are equality tests, so both sides have to be spelled the same
# way. That spelling is what this file owns.
#
# Typically fed by `hook-input.sh`, which reads the raw path out of the host's payload first.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced by all four allow hooks (two grants × two hosts). Sets no shell options: every
# caller runs `set -uo pipefail` WITHOUT `-e` on purpose, and sourcing must not change that.

# Resolve a directory to its PHYSICAL path, with every symlink component followed
# (`pwd -P`, not the logical `pwd` of normalize_dir).
#
# Both grants compare two paths for equality, so both sides must be spelled the same way. The
# logical form cannot guarantee that: the two sides reach us from different places — one from
# the plugin's own layout, the other from the tool call — and macOS alone routinely hands out
# both `/var/…` and `/private/var/…` for one directory. Physical resolution also means a
# symlinked path component cannot smuggle a target out of the folder while still comparing equal.
#
# The `cd` runs in a subshell, so this resolves a path without ever moving the caller.
# Callers may invoke it bare, and neither comparison can be made order-dependent by a stray
# `cd` — which matters because absolutize() resolves a relative path against $PWD.
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

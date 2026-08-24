# JSON string escaping for the ingrain-security plugin.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options, for the reason project-root.sh states.
#
# Flat: one pure function over its argument, so this file requires no sibling lib.
#
# Split out of project-root.sh, which resolves locations and had no business owning a string
# escaper — session-start was sourcing a git-location lib for this one function and nothing
# else. Every emitter of JSON sources this directly instead.
#
# Sourced by:
#   hooks/scripts/session-start                          (the injected context block)
#   skills/ingrain-security/scripts/assessment-mint    (the mint's JSON)
#   skills/ingrain-security/scripts/branch-delta        (the delta's JSON)
#   skills/ingrain-security/scripts/threat-retag       (the re-tag's JSON)
#   hooks/scripts/require-review-before-write            (the review gate's denial JSON)

# Single-pass JSON string escape. Orders of magnitude faster than a char-by-char loop.
#
# A per-character mapping, so it distributes over concatenation: escaping an assembled
# string is identical to escaping each part and joining. That is what lets a caller build
# its text plainly — real newlines, real quotes — and escape exactly once at the end.
#
# ACCEPTED LIMITATION — the five escapes below are the whole set. JSON also requires `\u00XX`
# for every other C0 control byte (0x00-0x1F), and assumes valid UTF-8; neither is handled, so a
# filename carrying a raw control byte or an invalid UTF-8 sequence emits a document no strict
# parser accepts. It fails whole rather than per-field: one such path in `changed_files` and the
# entire object is unparseable.
#
# Accepted deliberately, on two grounds. The consumer is an LLM reading a tool result as text,
# not a `JSON.parse` in a harness — it still reads `diff_ref` and `delta_empty` off a malformed
# object, so the realistic outcome is a degraded read rather than a dead run. And a repository
# actually containing such a path has a problem this script is not the right place to solve.
#
# The residual, stated so nobody rediscovers it as a surprise: a path containing ESC (0x1B) puts
# live terminal escapes into the agent's context. Still accepted — it needs a filename that is
# already hostile — but it is the one case whose blast radius is not just this script's output.
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "${s}"
}

# Skeleton templates for the ingrain-security markdown artifacts.
#
# The dialect is declared here rather than by a shebang, because this file is sourced,
# not executed — ShellCheck has no other way to know it is bash.
# shellcheck shell=bash
#
# Sourced — never executed. Sets no shell options: every caller runs `set -uo pipefail`
# WITHOUT `-e` on purpose, and sourcing must not change that.
#
# Sourced by:
#   skills/ingrain-security/scripts/assessment-mint   (label: assessment)
#
# One artifact carries the whole analysis. The org rules used to live in a `rules-<…>.md`
# sidecar; they now ride in the assessment's own `## Org rules` section, which is why this
# file renders one skeleton rather than two.
#
# A mint seeds this skeleton into the artifact when the file does not exist yet, so no
# writer ever starts from a blank page. The skeleton carries structure and a FIELD CARD per
# section — never content: no example entries and no placeholder values that could survive
# into the finalized file. `## Threats`, `## Org rules` and `## Implementation guidance` hold
# no entries; the worker that fills each writes its `### <id> — <title>` entries under the card.
#
# The cards below RENDER the schema that `references/lib/assessment-file.md` owns —
# see its § The field cards carry the shape for what they are for and why they are PERMANENT.
# What that leaves to this file is the rendering itself, under three invariants: a field or
# value changed in the reference is changed here in the same edit; no line of a card may begin
# with `###`, so an untouched skeleton still holds no entry by any test of it; and a card is
# static text, so the skeleton stays deterministic.
#
# Sections present but unfilled is the skeleton's whole point: an unfilled skeleton is not a
# finished assessment, and nothing in it should read as one.
#
# Because the skeleton is deterministic in (label, title), a caller can tell an untouched
# artifact from a written one by comparing the file against a freshly rendered skeleton —
# that comparison is what the minters report as `template_only`, and what `has_content` is
# derived from.

# Render one artifact's skeleton on stdout, WITHOUT a trailing newline so it compares
# byte for byte against `$(cat <file>)`, which strips trailing newlines.
# $1 the task title ("" when none was resolved).
render_artifact_template() {
    # An unresolved title leaves both the heading suffix and the field value off entirely,
    # rather than trailing a separator or a space behind.
    local title="$1" heading_suffix="" title_field="Title:"
    if [ -n "${title}" ]; then
        heading_suffix=" — ${title}"
        title_field="Title: ${title}"
    fi

    printf '%s' "# Security assessment${heading_suffix}

> Local working artifact produced by ingrain-security — keep in sync as the
> implementation evolves (see Maintenance below). Git-ignored.
>
> Skeleton seeded by \`assessment-mint\` — fill the sections below; do not
> re-create the page. Each is empty until the stage that owns it writes it. The comment
> under each heading is that section's field card — write from it.

## Task
<!-- Title: the task's title. Latest stage: development|testing — development while the plan
     review and the implementation are in progress; testing once the verification pass has
     run. Description: one line on what this change does, written at Development.
     Schema version: the revision of this schema the file follows — leave it as seeded. -->
${title_field}
Latest stage: development
Description:
Schema version: 2

## Affected paths
<!-- A bullet list of repository-relative FOLDERS this change is expected to touch, written
     at Development beside Description. A prediction, not a measurement: the code does not
     exist yet, so state where the plan says the change will land. Folders, not files
     (\"backend/services/sync/\"). No leading /, no ../, no absolute paths. Prefer the
     shallowest folder that still describes the change; the repository root says \"everywhere\"
     and switches off the narrowing this section exists for. \"—\" until written. -->
—

## Triage
<!-- Fields in file order: Verdict (minor|major), Security relevant (true|false), Surfaces,
     then Prior analysis — optional, a pointer to a prior analysis of this task, or none.
     All four are the ORCHESTRATOR's: Verdict and Security relevant record the user's answer to
     the review question that opens the run, Prior analysis comes from its own lookup, and
     Surfaces is a bullet list naming the security-relevant aspects the change touches, present
     when major — it feeds both the threat generator and the org-rule retrieval. -->
Verdict:
Security relevant:
Surfaces:

## Threats
<!-- Each threat is a \"### T<nn> — <title>\" heading, then FOUR PHASE BLOCKS in this
     order, each a \"#### <name>\" line with its own fields beneath it, one per line:

     #### gen      — threat generator:  Asset, Vector, Description, Assumptions
     #### score    — risk scorer:       Justification (≤256 chars),
                     Impact (critical|high|medium|low),
                     Likelihood (very high|high|medium|low), Risk score (0-100),
                     Criticality (low|medium|high|critical)
     #### usergate — threat gate:       Selection (selected|excluded|undecided)
     #### test     — verification pass: Robustness justification (≤256 chars — the
                     reasoning behind Robustness; the risk-scoring rationale is a
                     separate field, over in #### score),
                     Robustness (weak|adequate|strong),
                     Residual path (for a weak verdict: the route still open and the
                     change that would close it; — otherwise),
                     Evidence (optional — file:line)

     THE BLOCK IS THE OWNERSHIP RECORD — this file carries who writes what. The generator
     seeds all four markers when it creates the entry; every later stage writes ONLY
     between its own marker and the next, and carries every other block across byte for
     byte.

     An unrun stage leaves its marker with NO field lines under it — leave an empty block
     as it stands, marker only. That emptiness IS the signal its stage has not run yet.
     Inside a block whose stage HAS run, \"—\" keeps its usual meaning: a field that does
     not apply (Residual path on a non-weak verdict, Evidence nobody cited).
     Missing marker? Append your fields at the end of the entry.

     Ids start in discovery order; the risk scorer re-tags them once into descending-risk
     order (T01 = highest risk) and they are permanent after that. Entries sit in id
     order. -->

## Risk score
<!-- Score: 0-100. Criticality: low|medium|high|critical. The plan-level residual risk. -->
Score:
Criticality:

## Org rules
<!-- The second driver axis. Written by the broad retrieval pass, which runs in PARALLEL with
     the threat chain: one entry per retrieved rule, a \"### <id> — <title>\" heading, then
     Selection (selected|excluded), then the rule body underneath — verbatim and in full,
     exactly as the ingrain CLI returned it. Ids are machine-facing and must match the
     Rule refs in Implementation guidance; the user sees titles.
     Selection reads \"—\" until the RULE GATE decides applicability: selected means it governs
     this change (and is what adherence is judged over), excluded means deemed inapplicable
     here — a recorded decision, never a verdict. At finalize a selected entry keeps its body
     (it is Testing's specification) and an excluded one keeps its heading and Selection line
     with the body dropped. Untouched, this section means no org rules were retrieved. -->

## Implementation guidance
<!-- How the goal a driver sets is reached — never itself a subject of verification, so it
     carries no verdict and no Selection. Each entry is a \"### M<nn> — <title>\" heading, then
     these fields, one per line, in this order: Description, Yield (high|medium|low),
     Effort (high|medium|low), Threats (the T-ids it closes, or —),
     Rule refs (the org rule ids it implements, FULL and verbatim from Org rules — never
     abbreviated; or —).
     Every entry names AT LEAST ONE driver across the two: guidance anchored to neither a
     threat nor a rule cannot be attributed, verified or governed, and BOTH the CLI and the
     platform refuse the file — so an unanchored entry does not sync, it blocks the sync. A Rule refs id may only
     name a SELECTED Org rules entry. One entry may serve several threats AND several rules at
     once — write it ONCE naming them all, never a copy per driver.
     A field whose stage has not run yet reads \"—\". Ids are permanent. -->

## Rule adherence
<!-- Written by the verification pass: were the org rules we accepted actually followed?
     One entry per rule SELECTED at the rule gate — including one no guidance implements,
     which is exactly what a security owner needs judged. An excluded rule was deemed
     inapplicable and gets NO entry. Each entry is a \"### <rule-id> — <title>\" heading (the
     full id and title, verbatim from Org rules), then: Adherence (followed|not-followed),
     Justification (≤256 chars). Both read \"—\" until the verification pass runs.
     One verdict per rule, judged against the code — not per driving entry, and never derived
     from a threat's Robustness or from what became of the guidance that drives it. -->

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis — a new
surface, a threat's acceptance changes, or a guidance entry is added, dropped, or
altered. Keep the Selection fields on both driver axes honest against the code you
write, and keep every enumerated field within the values its section's field card
names — the comment under each heading. The scoring pass already re-tagged the
threats into risk order, so ids are permanent from here: add a new threat with the
next free \`T<n>\` and keep the existing ones as they are.

To locate this file, re-run the \`assessment-mint\` command from your
INGRAIN-ASSESSMENT-PATHS session context and write to the absolute \`assessment_abs\`
it returns — it resolves back to this same file. Do not resolve a relative path
against the file you are editing, and do not create an \`.ingrain-security/\` folder."
}

# Seed the skeleton into $3 when that file does not exist, and report what the caller is
# looking at: `seeded` (it was absent and now holds a fresh skeleton), `template_only` (it
# existed and is still an untouched skeleton) or `written` (it holds real content). An
# existing file is never rewritten. $1 title, $2 absolute path.
# Returns 1 when the write fails.
seed_artifact_template() {
    local title="$1" path="$2" template
    template="$(render_artifact_template "${title}")"

    if [ ! -f "${path}" ]; then
        printf '%s\n' "${template}" > "${path}" 2>/dev/null || return 1
        printf 'seeded'
        return 0
    fi

    if [ "$(cat "${path}" 2>/dev/null)" = "${template}" ]; then
        printf 'template_only'
    else
        printf 'written'
    fi
    return 0
}

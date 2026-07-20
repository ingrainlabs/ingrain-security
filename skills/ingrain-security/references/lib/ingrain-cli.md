# Ingrain CLI reference

The org's security rules are ingested knowledge — how *this* team implements auth, validation,
secrets, crypto — reached by semantic search over the `ingrain` CLI. This file owns **how to
drive that CLI**: the availability probe, the retrieval command, the shape of what comes back,
and how to classify a failure.

This file owns the mechanics; the caller owns what to *do* about a given outcome — SKILL.md
§5 for the orchestrator's first pass, `references/development/ingrain-rule-expander.md` for
the second.

## Availability probe

```bash
ingrain --version
```

A purely local check, so it isolates "is the binary present?" from every failure that turns on
config or the network. Probe before querying.

## Retrieval

```bash
ingrain context security_rules "<query>" --json
```

- **Queries are matched on meaning** — phrase them as questions ("how do we authenticate
  service-to-service calls").
- **One query per distinct question.** Run several, each covering one topic.
- **`--limit N`** — default 10, accepted range 1–50. Raise it when a topic is broad.

`security_rules` is **the** subcommand. Treat an unknown-subcommand error as an unsupported
build and degrade gracefully.

## Output shape

`--json` returns a JSON array of rule objects:

```json
[{ "id": "...", "title": "...", "body": "..." }]
```

`body` is the org's authoritative guidance on *how to implement* the control. Keep it
**verbatim** wherever it is written down — never summarize it, and never invent a rule, an id,
a title, or a body that the CLI did not return.

## Failure taxonomy

| Symptom | Classification |
| --- | --- |
| `command not found` | **Not installed** — no org rules store is wired up in this repo |
| Config error; no search runs (missing `INGRAIN_SYNC_URL` / API token) | **Unconfigured** |
| Unknown-subcommand error | **Unsupported build** |
| Query succeeds, returns an empty array | **No matches** |
| "operation not permitted" / sandbox-denied / permission-required | **Access denied** |

The first four all **degrade gracefully** — a permission grant would leave them unchanged, so
retrieve no rules, note why in one line, and carry on. Rule retrieval is always best-effort.

**Access denied is recoverable.** The binary and config are fine and the rules *are*
reachable; the host has yet to grant this command exec. The caller owns the recovery — re-run
so the host's native "allow this command?" prompt reaches the user, and fall back only if the
user declines.

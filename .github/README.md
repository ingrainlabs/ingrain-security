# `.github/` — release automation

This directory is **committed** and holds the release tooling — the source of truth for the plugin
version, plus the workflows that enforce and ship it.


## How users get a version: git tags drive installs

Both marketplace catalogs pin the plugin's `source` to a git **tag** plus the exact commit **sha**,
not the default branch:

```json
// .claude-plugin/marketplace.json  (Claude Code)
"source": { "source": "github", "repo": "ingrainlabs/ingrain-security", "ref": "v0.1.0", "sha": "<40hex>" }

// .agents/plugins/marketplace.json  (Codex)
"source": { "source": "url", "url": "https://github.com/ingrainlabs/ingrain-security.git", "ref": "v0.1.0", "sha": "<40hex>" }
```

Each host fetches its catalog from the default branch, but the catalog tells it to pull the plugin's
files from tag `v<version>`, pinned to that commit `sha`. When both are set, `sha` is the effective
pin — so even a moved tag can't change the content users receive. A user only ever receives the
content of a tagged release; commits that land on `main` between releases never reach them until a new
tag is cut. The `version` field (below) is what tells an installed user a newer release is available.

Install commands:

```bash
# Claude Code
/plugin marketplace add ingrainlabs/ingrain-security
# Codex
codex plugin marketplace add ingrainlabs/ingrain-security
```

## Release versioning

The version is duplicated across three config files **plus** two source refs (one per host), all of
which must stay in lockstep (each ref is the version prefixed with `v`). Each catalog also carries a
`source.sha` — the immutable commit the release tag points to:

| File | JSON path | Value |
|------|-----------|-------|
| `.claude-plugin/plugin.json` | `.version` | `x.y.z` |
| `.claude-plugin/marketplace.json` | `.plugins[0].version` | `x.y.z` |
| `.codex-plugin/plugin.json` | `.version` | `x.y.z` |
| `.claude-plugin/marketplace.json` | `.plugins[0].source.ref` | `vx.y.z` |
| `.agents/plugins/marketplace.json` | `.plugins[0].source.ref` | `vx.y.z` |
| `.claude-plugin/marketplace.json` | `.plugins[0].source.sha` | 40-char commit sha |
| `.agents/plugins/marketplace.json` | `.plugins[0].source.sha` | 40-char commit sha |

`release.sh` is the single tool for managing them (edits files only — never commits or tags):

```bash
.github/release.sh 1.2.0           # set an explicit version everywhere
.github/release.sh patch|minor|major  # semver-bump the current version
.github/release.sh --set-sha <40hex>  # pin both catalogs' source.sha to a commit
.github/release.sh --check         # assert all locations agree (exit 1 on drift)
.github/release.sh --current       # print the canonical current version
```

Setting a version also re-pins `source.ref` to `v<version>`. It edits **only** the version and ref
values, leaving all other JSON formatting byte-for-byte intact. The `sha` is **not** derived from the
version — it is the commit the release tag points to and is only known after the release commit lands
on `main`, so it is set separately by the release workflow via `--set-sha`. `--check` only asserts
that both catalogs carry the same valid 40-char sha, not which commit it is.

### Release flow

The version moves through two workflows, both keyed off a PR into `main`:

1. **`workflows/version-bump.yml`** runs on the PR branch and bumps the version (size from a
   `release:*` label, default `patch`; `release:skip` opts out), committing the change into the
   reviewed PR diff. See `.github/version-bump.sh`.
2. **`workflows/release.yml`** runs after the PR merges: it tags `v<version>` at the merged commit,
   pins both catalogs' `source.sha` to that commit, and pushes a single follow-up
   `Pin v<version>…` commit to `main`. See `.github/publish-release.sh`.

This yields the invariant **`git rev-parse v<version>` equals the `source.sha` in both catalogs**, so
a moved tag cannot change the content installers receive (`sha` is the effective pin on both hosts).

Because a commit cannot contain its own hash, the sha is recorded in a follow-up commit; with **rebase
merging** `main` stays linear and simply sits one commit ahead of the tag. Pushing that pin commit
requires `github-actions[bot]` to be a **bypass actor** on the `main` branch rulesets (including
`check-source-branch`).
# `.github/` — release automation

This directory is **committed** and holds the release tooling — the source of truth for the plugin
version, plus the workflows that enforce and ship it.


## How users get a version: git tags drive installs

Both marketplace catalogs pin the plugin's `source` to a git **tag**, not the default branch:

```json
// .claude-plugin/marketplace.json  (Claude Code)
"source": { "source": "github", "repo": "ingrainlabs/ingrain-security", "ref": "v0.1.0" }

// .agents/plugins/marketplace.json  (Codex)
"source": { "source": "url", "url": "https://github.com/ingrainlabs/ingrain-security.git", "ref": "v0.1.0" }
```

Each host fetches its catalog from the default branch, but the catalog tells it to pull the plugin's
files from tag `v<version>`. So a user only ever receives the content of a tagged release — commits
that land on `main` between releases never reach them until a new tag is cut. The `version` field
(below) is what tells an installed user a newer release is available.

Install commands:

```bash
# Claude Code
/plugin marketplace add ingrainlabs/ingrain-security
# Codex
codex plugin marketplace add ingrainlabs/ingrain-security
```

## Release versioning

The version is duplicated across three config files **plus** two source refs (one per host), all of
which must stay in lockstep (each ref is the version prefixed with `v`):

| File | JSON path | Value |
|------|-----------|-------|
| `.claude-plugin/plugin.json` | `.version` | `x.y.z` |
| `.claude-plugin/marketplace.json` | `.plugins[0].version` | `x.y.z` |
| `.codex-plugin/plugin.json` | `.version` | `x.y.z` |
| `.claude-plugin/marketplace.json` | `.plugins[0].source.ref` | `vx.y.z` |
| `.agents/plugins/marketplace.json` | `.plugins[0].source.ref` | `vx.y.z` |

`release.sh` is the single tool for managing them (edits files only — never commits or tags):

```bash
.github/release.sh 1.2.0           # set an explicit version everywhere
.github/release.sh patch|minor|major  # semver-bump the current version
.github/release.sh --check         # assert all five locations agree (exit 1 on drift)
.github/release.sh --current       # print the canonical current version
```

Setting a version also re-pins `source.ref` to `v<version>`. It edits **only** the version and ref
values, leaving all other JSON formatting byte-for-byte intact.

**`workflows/release.yml`** is a manual (`workflow_dispatch`) release that must run on the default
branch: it runs `release.sh` with the version you supply, asserts all locations agree (`--check`),
then commits the bump and pushes a `v<version>` tag. Because every version change goes through this
workflow, the version and ref can only ever move together — there's no separate drift check on
normal commits.

To cut a release: Actions → **release** → Run workflow → enter `patch`/`minor`/`major` or an
explicit `x.y.z`.

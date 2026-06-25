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
.github/release.sh --files         # list the files it manages
```

Setting a version also re-pins `source.ref` to `v<version>`. It edits **only** the version and ref
values, leaving all other JSON formatting byte-for-byte intact.

The release flow is automated across two workflows — you never run `release.sh` by hand to cut a
release:

- **`workflows/version-bump.yml`** runs on each PR into the default branch. It reads the PR's
  `release:*` label (defaults to `patch`; `release:skip` opts out), bumps from the version currently
  on the default branch via `release.sh`, asserts all locations agree (`--check`), and commits the
  result back to the PR branch — so the version change is part of the reviewed diff.
- **`workflows/release.yml`** runs automatically when a PR merges into the default branch. The merged
  files already carry the new version, so it does not bump; it asserts the locations agree, then tags
  `v<version>` and publishes the GitHub Release.

Because every version change flows through the PR bump, the version and ref can only ever move
together — there's no separate drift check on normal commits.

To cut a release: open a PR into the default branch, add the `release:*` label for the bump size you
want (or `release:skip` to leave the version untouched), and merge!
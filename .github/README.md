# `.github/` — release automation

This directory is **committed** and holds the release tooling — the source of truth for the plugin
version, plus the workflows that enforce and ship it.

> The per-developer local sync hook lives in the gitignored `.helpers/` directory — see
> `.helpers/README.md`.

## Release versioning

The plugin version is duplicated across three config files that must stay in lockstep:

| File | JSON path |
|------|-----------|
| `.claude-plugin/plugin.json` | `.version` |
| `.claude-plugin/marketplace.json` | `.plugins[0].version` |
| `.codex-plugin/plugin.json` | `.version` |

`release.sh` is the single tool for managing them (edits files only — never commits or tags):

```bash
.github/release.sh 1.2.0           # set an explicit version everywhere
.github/release.sh patch|minor|major  # semver-bump the current version
.github/release.sh --check         # assert all three agree (exit 1 on drift)
.github/release.sh --current       # print the canonical current version
```

It edits **only** the version value, leaving all other JSON formatting byte-for-byte intact.

- **`workflows/version-check.yml`** runs `release.sh --check` on every push/PR so the three files
  can never drift on `main`. The local `.helpers/pre-commit` runs the same check before each commit.
- **`workflows/release.yml`** is a manual (`workflow_dispatch`) release: it runs `release.sh` with
  the version you supply, then commits the bump and pushes a `v<version>` tag.

To cut a release: Actions → **release** → Run workflow → enter `patch`/`minor`/`major` or an
explicit `x.y.z`.

# RepoMap

RepoMap is a CLI tool for generating a stable, reproducible map of large repositories.
It targets massive monorepos where AI or humans need a fast structural overview
before making changes.

## Status

Core build/update/query flows are implemented. See the quickstart below.

## Quickstart (30 seconds)

```bash
pnpm install
pnpm -r build
node packages/cli/dist/index.js build --out .repomap
node packages/cli/dist/index.js query "refresh token" --out .repomap
```

## CLI Commands

- `repomap build`: build a fresh RepoMap
- `repomap update`: incremental update (reuses stable outputs)
- `repomap query "<text>"`: search modules by name/path/keywords/entry paths

Global options:

- `--out <path>` output directory (default `.repomap`)
- `--format <name>` output format (`json` or `human`)
- `--ignore <pattern>` ignore pattern (repeatable)
- `--limit <count>` max query results
- `--min-score <score>` minimum query score

## Outputs

`repomap build` produces:

- `meta.json`: run metadata (version, repoRoot, commit)
- `file_index.json`: stable file list + content hashes
- `module_index.json`: modules with keywords and file counts
- `entry_map.json`: entry files by module
- `summary.md`: AI-friendly summary

`repomap update` refreshes outputs and writes `file_changes.json`.

Sample outputs live under `examples/`.

## AI Usage Tips

1. Start with `summary.md` for the high-level layout.
2. Use `repomap query` to narrow to 1-3 modules.
3. Inspect `entry_map.json` for likely entry points.
4. Drill into files with `rg` or your editor.

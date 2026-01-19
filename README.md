# RepoMap

RepoMap is a CLI tool for generating a stable, reproducible map of large repositories.
It targets massive monorepos where AI or humans need a fast structural overview
before making changes.

## Status

Core build/update/query flows are implemented. See the quickstart below.

## Install (npm)

```bash
npm i -g @repo-map/repomap
repomap build --out .repomap
repomap query "refresh token" --out .repomap
```

## Quickstart (from source)

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

## Manual Verification (No CI)

```bash
pnpm -r build
node packages/cli/dist/index.js build --out .repomap
node packages/cli/dist/index.js query "auth token" --out .repomap

cd examples/medium-repo
GIT_DIR=/dev/null GIT_CEILING_DIRECTORIES="$(pwd)" \
  node ../../packages/cli/dist/index.js build --out output-tmp \
  --ignore "output/**" --ignore "output-tmp/**"
diff -u output/module_index.json output-tmp/module_index.json
diff -u output/entry_map.json output-tmp/entry_map.json
diff -u output/summary.md output-tmp/summary.md

cd ../monorepo
GIT_DIR=/dev/null GIT_CEILING_DIRECTORIES="$(pwd)" \
  node ../../packages/cli/dist/index.js build --out output-tmp \
  --ignore "output/**" --ignore "output-tmp/**"
diff -u output/module_index.json output-tmp/module_index.json
diff -u output/entry_map.json output-tmp/entry_map.json
diff -u output/summary.md output-tmp/summary.md
```

Expected: the `diff` commands produce no output.

## Publish (Maintainers)

```bash
# ensure versions are updated in packages/core and packages/cli
pnpm -r build

cd packages/core
npm publish --access public

cd ../cli
npm publish --access public
```

## AI Usage Tips

1. Start with `summary.md` for the high-level layout.
2. Use `repomap query` to narrow to 1-3 modules.
3. Inspect `entry_map.json` for likely entry points.
4. Drill into files with `rg` or your editor.

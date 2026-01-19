# Examples

This folder contains fixture repos plus their RepoMap outputs.

## medium-repo (single module)

- Source: `examples/medium-repo`
- Output: `examples/medium-repo/output`
- Highlights: web routes, controller, CLI entry, job files
- Output files: `module_index.json`, `entry_map.json`, `summary.md`

## monorepo (workspaces)

- Source: `examples/monorepo`
- Output: `examples/monorepo/output`
- Highlights: workspace modules under `packages/*`
- Output files: `module_index.json`, `entry_map.json`, `summary.md`

## Regenerate outputs

Meta and file index outputs are omitted from tracked outputs to avoid
machine-specific paths and mtimes.

```bash
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

# RepoMap

[English](README.md) | [中文](README.zh.md)

RepoMap is a CLI tool that generates a stable, reproducible structural map of large repositories.
It helps AI or humans quickly understand codebases before making changes.

## Overview

Large repositories (100k-1M+ LOC) expose bottlenecks for AI and developers:

- Hard to grasp overall structure quickly
- Change localization depends on guessing keywords
- Vector RAG alone over-generalizes and misses entry points
- Repo layouts vary widely, lacking stable priors
- Full rescans are costly and not reproducible

RepoMap provides an engineering-grade, incremental "repo map" as baseline infrastructure
before code modification.

## Goals

- Generate a structured map for large repositories
- Serve as a baseline for AI/agents before code changes
- Support incremental updates for evolving repos
- Produce outputs readable by humans and consumable by AI

## Non-Goals

- No automatic code changes
- No automatic PRs/commits
- No full semantic understanding (RepoMap is not an LLM)
- Not a replacement for IDE/LSP
- No built-in full vector RAG system (can integrate externally)

## Target Users

1. Engineers using Codex / Claude Code / AI agents
2. Teams maintaining mid-to-large monorepos
3. Platform developers building prd2code / agent workflows
4. CI or automation systems (read-only runs)

## Features

- Stable output ordering to avoid diff noise
- Incremental update with file change tracking
- Module detection with keywords
- Entry detection (routes, controllers, services, CLI, jobs/workers)
- Human-friendly outputs for query/show/explain, plus JSON format
- Gitignore + default ignore rules + CLI ignore patterns
- POSIX-style paths for consistent output

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

## Commands

- `repomap build`: build a fresh RepoMap
- `repomap update`: incremental update (reuses stable outputs)
- `repomap query "<text>"`: search modules by name/path/keywords/entry paths
- `repomap show`: list modules with entries and keywords
- `repomap explain "<text>"`: query with expanded module details

Global options:

- `--out <path>` output directory (default `.repomap`)
- `--format <name>` output format (`json` or `human`, query/show/explain default to `human`)
- `--ignore <pattern>` ignore pattern (repeatable)
- `--limit <count>` max query results
- `--min-score <score>` minimum query score
- `--max-keywords <count>` max keywords per module in human output
- `--max-entries <count>` max entry paths per entry type in human output

Show options:

- `--module <path>` filter by module path (repeatable)
- `--path-prefix <prefix>` filter by module path prefix

## Outputs

`repomap build` produces:

- `meta.json`: run metadata (version, repoRoot, commit)
- `file_index.json`: stable file list + content hashes
- `module_index.json`: modules with keywords and file counts
- `entry_map.json`: entry files by module
- `summary.md`: AI-friendly summary

Output directory:

```text
.repomap/
├── meta.json
├── file_index.json
├── module_index.json
├── entry_map.json
└── summary.md
```

`repomap update` refreshes outputs and writes `file_changes.json`.

## Example Workflow

```bash
repomap build --out .repomap
repomap show --out .repomap --path-prefix packages/
repomap query "refresh token" --out .repomap
repomap explain "refresh token" --out .repomap --format json
```

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

## Performance (Example)

Repo: microsoft/vscode @ e08522417da0fb5500b053f45a67ee4825f63de4
Files: 8,694 (`rg --files | wc -l`)
Machine: macOS 14.3 (Darwin 24.3.0, arm64)
Node: v22.17.1
RepoMap: 0.1.0

Command:
```
/usr/bin/time -p repomap build --out .repomap
```

Result:
```
real 1.16
user 0.92
sys  0.62
```

Output hashes (SHA-256):
- module_index.json: d267fb6274947538a26460a927670bc4bce62ad923f4dbdd8c3f67fa45a52a54
- entry_map.json: 0cfaf7396087a5e2a3aea8b57ff14cf49f619fcd7f0002d87ac011ff08711ce9
- summary.md: 29ebca4c364470e56fa53ea9560bc1e79dcab95b38d1d15be5478faa9475054a

Note: timings vary by hardware and repo size; hashes demonstrate stable output for this run.

## Roadmap

- Improve entry heuristics and data model hints
- Add more query affordances for humans and agents
- Document larger real-world examples and comparisons
- Optional CI workflow for reproducible runs

## Publish (Maintainers)

```bash
# ensure versions are updated in packages/core and packages/cli
pnpm -r build

cd packages/core
npm publish --access public

cd ../cli
npm publish --access public
```

## Contributing

Issues and PRs are welcome. Please include:

- A short description of the change
- Repro steps or tests when applicable
- Updated docs if behavior changes

## License

MIT. See `LICENSE`.

## AI Usage Tips

1. Start with `summary.md` for the high-level layout
2. Use `repomap query` to narrow to 1-3 modules
3. Inspect `entry_map.json` for likely entry points
4. Drill into files with `rg` or your editor

---
name: repomap
description: Guide for using RepoMap outputs and CLI to locate modules, entry files, and keywords. This skill should be used when users ask to navigate a large repository, find relevant modules/files, or run RepoMap build/update/query.
---

# RepoMap

## Purpose

- Use RepoMap outputs to locate relevant modules, entry points, and keywords in large repositories.
- Provide a repeatable workflow for building/updating `.repomap/` and querying it.

## When To Use

- Locate modules or entry files for a feature or bugfix.
- Summarize repo structure or entry points.
- Refresh RepoMap outputs before analysis.

## Workflow

1. Confirm `.repomap/` exists; if missing or stale, build/update.
   - Build: `repomap build --out .repomap`
   - Update: `repomap update --out .repomap`
   - If the CLI is not installed, run `pnpm -r build` first and use:
     `node packages/cli/dist/index.js build --out .repomap`
2. Read `.repomap/summary.md` for the high-level layout.
3. Query candidates by keywords:
   - `repomap query "refresh token" --out .repomap`
   - Use `--format json` when structured output is required.
4. Inspect `.repomap/module_index.json` and `.repomap/entry_map.json` to locate
   modules and entry files; join on `path`.
5. Broaden keywords or rerun `update` after changes if results are empty.
6. Report top modules with paths and entry files; include tokens and matches
   when returning JSON results.

## Notes

- Treat output paths as POSIX; resolve against repo root if needed.
- Ignore output directories when rebuilding examples (use `--ignore "output/**"`).
- Include ignored paths by using negate patterns (example:
  `--ignore '!node_modules/**'`).

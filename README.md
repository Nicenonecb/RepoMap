# RepoMap

RepoMap is a CLI tool for generating a stable, reproducible map of large repositories.
It targets massive monorepos where AI or humans need a fast structural overview
before making changes.

## Status

M0 scaffold is in place: monorepo layout, CLI commands, and meta schema.

## Development

```bash
pnpm install
pnpm dev -- --help
```

## CLI Commands

- `repomap build`
- `repomap update`
- `repomap query`

Global options:

- `--out <path>`
- `--format <name>`
- `--ignore <pattern>`

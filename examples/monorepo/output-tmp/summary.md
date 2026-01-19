# Repo Summary

## Repository Overview
- Name: monorepo
- Modules: 3
- Files: 11
- Languages: node(3)

## Top Modules
- packages/auth (node, 5 files) keywords: auth, authservice, login, refresh, issuetoken, ...
- packages/billing (node, 4 files) keywords: invoice, billingworker, invoiceservice, index, package, ...
- . (node, 2 files) keywords: package, pnpm, workspace

## Common Entries
- web-route: packages/auth/src/routes.ts
- controller: (none)
- cli-entry: (none)
- worker: packages/billing/src/worker.ts
- job: (none)
- unknown-entry: .

## Suggested Reading Order
- Start with web-route: packages/auth/src/routes.ts
- Start with worker: packages/billing/src/worker.ts

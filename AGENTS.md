# Agent guide

[README.md](README.md) describes the product. This file says where to look and what to update.

## Follow a command through the code

A command passes through these layers in order. The test beside each layer covers it.

| Layer | Source | Test |
| --- | --- | --- |
| Contracts | `packages/contracts/src/index.ts` | |
| Store | `packages/artifacts/src/index.ts`, `access.ts` | `tests/artifacts.test.ts` |
| REST | `packages/rest/src` | `tests/rest.test.ts` |
| MCP | `apps/mcp/src/http.ts` | `tests/artifacts.test.ts` |
| Client | `packages/client/src` | `tests/cli-client*.test.ts` |
| CLI | `apps/cli/src` | `tests/cli-client*.test.ts` |
| Database | `packages/db/src`, `packages/db/migrations` | `tests/database.test.ts` |

Decisions live in `docs/decisions/`. Put reproduction scripts and scratch databases in `.test-artifacts/`, which git ignores.

`packages/artifacts/src/index.ts` (38 KB) and `docs/decisions/wiki-pages.md` overflow one read. List the sections first, then read one range:

```sh
grep -n '^    async ' packages/artifacts/src/index.ts
grep -n '^## ' docs/decisions/wiki-pages.md
```

## Prepare a worktree

A new worktree has no `node_modules` and no native libsql build. Copy `.native` from the main checkout instead of rebuilding it:

```sh
cp -R <main checkout>/.native .
node scripts/prepare-native.mjs --check && pnpm install --frozen-lockfile
```

## Run checks

- `pnpm check` type-checks the workspace and the panel.
- `pnpm test` runs `tests/*.test.ts`.
- `pnpm test:rest-cli` runs the REST and CLI tests.
- `pnpm test:cli-skills` builds the packages and checks the skills that the CLI ships.
- `pnpm test:browser` builds the panel and runs 15 Chrome proofs.

pnpm 12 rejects `-s`. To shorten output, pipe it to `tail`, for example `pnpm check 2>&1 | tail -5`.

Run the local CLI as `pnpm artifacts …`. A global `artifacts` binary can be an older beta, so check it with `which -a artifacts`.

## Update everything a change touches

- A command or operation contract: the contracts, the MCP tool in `apps/mcp/src/http.ts` and its schema list in `tests/artifacts.test.ts`, `tests/rest.test.ts`, the CLI help in `apps/cli/src/index.ts`, `README.md`, `apps/cli/README.md`, `packages/*/README.md`, `skills/artifacts*/` with `tests/cli-skills.proof.ts`, and `.agents/skills/verify-artifacts/features/`.
- A new table or virtual table: `scripts/migrate-identity.ts` and `tests/identity-migration.test.ts`.
- A new migration in `packages/db/migrations`: apply it to production before the merge.

To find the rest, run `git grep -l` on an old literal, such as `git grep -l -e 'op: .create.'`.

## Operate production

- [Production operations](docs/deployment.md#production-operations) covers the Workers, the Turso database, the `cf` CLI, Workers Paid, and the search reindex.
- [Migrate the production database before merge](docs/ci-cd.md#migrate-the-production-database-before-merge).
- [Diagnose a failed run](docs/ci-cd.md#diagnose-a-failed-run) covers background CI watches and failed proof logs.
- [Release the public npm beta](docs/npm-release.md) lists the files that carry the version.

To prove a change in the real panel, publication page, MCP, and CLI, use the `verify-artifacts` skill in `.agents/skills/verify-artifacts/`.

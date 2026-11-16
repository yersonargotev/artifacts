# Agent guide

[README.md](README.md) describes the product. This file says where to look, what to run, and which check enforces each rule.

## Follow a command through the code

A command passes through these layers. The test beside each layer covers it.

| Layer | Source | Test |
| --- | --- | --- |
| Contracts | `packages/contracts/src/index.ts` | |
| Store | `packages/artifacts/src/index.ts`, `access.ts` | `tests/artifacts.test.ts` |
| REST | `packages/rest/src` | `tests/rest.test.ts` |
| MCP | `apps/mcp/src/http.ts` | `tests/artifacts.test.ts` |
| Client and CLI | `packages/client/src`, `apps/cli/src` | `tests/cli-client*.test.ts` |
| Panel | `apps/dashboard/src` | `tests/panel*.test.ts`, `tests/panel-*.browser.proof.ts` |
| Publication page | `apps/publication/src` | `tests/publication.test.ts` |
| Error monitoring | `packages/monitoring/src` | `tests/monitoring.test.ts`, `tests/error-reporting.test.ts` |
| Database | `packages/db/src`, `packages/db/migrations` | `tests/database.test.ts` |

Packy installs the skills in `.claude/skills/` and `.agents/skills/` from `packy.json` and `packy.lock.json`. Don't edit them. The project owns only `verify-artifacts` and `verify-batch-concurrency`, which live in `.agents/skills/` and are symlinked from `.claude/skills/`. To prove a change in the real panel, publication page, MCP, and CLI, use `verify-artifacts`.

Decisions live in `docs/decisions/`. [docs/state-machines.md](docs/state-machines.md) lists every state machine with its invariants, transitions, and known findings; update it when you change a transition. Put reproduction scripts and scratch databases in `.test-artifacts/`, which git ignores. `packages/artifacts/src/index.ts` and `docs/decisions/wiki-pages.md` overflow one read. List the sections first, then read one range:

```sh
grep -n '^    async ' packages/artifacts/src/index.ts
grep -n '^## ' docs/decisions/wiki-pages.md
```

## Prepare a worktree

A new worktree has no `node_modules` and no native libsql build. Run `cp -R <main checkout>/.native .` instead of rebuilding it, then `node scripts/prepare-native.mjs --check && pnpm install --frozen-lockfile`.

## Run checks

- `pnpm check` type-checks the workspace and the panel.
- `pnpm lint` runs `oxlint --deny-warnings` with Oxlint's default rules and the anti-slop rules in `tools/oxlint/anti-slop/`. Any warning or error fails it, locally and in CI. It skips the Packy skills in `.agents/skills/` except `verify-artifacts` and `verify-batch-concurrency`. For a justified exception, put `// oxlint-disable-next-line <rule> -- <reason>` on the line above.
- `pnpm test` runs `tests/*.test.ts`. `pnpm test:rest-cli` runs the REST and CLI tests. `pnpm test:cli-skills` builds the packages and checks the skills that the CLI ships.
- `pnpm test:browser` builds the panel and runs the Chrome proofs listed in `scripts/browser-proofs.ts`.
- `pnpm verify <feature...>` builds the panel, runs each verify-artifacts drive in a fresh instance, and cleans up. CI runs every drive except `screens`. Run it after a panel UI or copy change.
- `pnpm test:panel-monitoring` builds the panel Worker and runs it in workerd to prove that it reports an error to Sentry without user data. Run it after a change to `packages/monitoring` or the panel's Worker entry.
- `node .agents/skills/verify-batch-concurrency/scripts/check.ts` model-checks the batch command with TLA+. Run it after a change to the batch command or its tables.

pnpm 12 rejects `-s`. To shorten output, pipe it to `tail`, for example `pnpm check 2>&1 | tail -5`. Run the local CLI as `pnpm artifacts …`. A global `artifacts` binary can be an older beta, so check it with `which -a artifacts`.

## Rules and their enforcers

| Rule | Enforcer | How it fails |
| --- | --- | --- |
| Import contracts only from `@yargote/artifacts-contracts`. | `pnpm check` | TS2307 or TS2459 on the old import. |
| Leave no Oxlint warning. | `pnpm lint` | Exit 1 on any warning or error. |
| No chained `as` casts, `Reflect.get`, or `Reflect.apply`. | `tools/oxlint/anti-slop/` in `pnpm lint` | An error that names the rule. |
| Document each MCP tool, CLI command, and option. | `tests/contract-surfaces.test.ts` | Names the doc and the missing item. |
| Keep the MCP tool list current. | The schema list in `tests/artifacts.test.ts` | `tools/list` differs from the list. |
| Map every verify-artifacts drive and Chrome proof. | `tests/verification-map.test.ts` | Names the file and the line to add. |
| Keep the drives passing after a panel change. | The CI job `Verify drives` | Prints the assertion and the evidence path. |
| Copy every table in the identity migration. | `tests/identity-migration.test.ts` | The copied rows differ from the source. |
| Migrate production before the merge. | None. It needs production credentials, so the operator decides. See [Migrate the production database before merge](docs/ci-cd.md#migrate-the-production-database-before-merge). | Nothing fails. |
| Don't pass `-s` to pnpm. | None. This file only. | pnpm 12 rejects it. |

`tests/contract-surfaces.test.ts` checks names only. A contract change also needs its schemas, enums, and prose updated in `README.md`, `apps/cli/README.md`, `packages/*/README.md`, `skills/artifacts*/` with `tests/cli-skills.proof.ts`, and `.agents/skills/verify-artifacts/features/`. To find them, run `git grep -l` on an old literal, such as `git grep -l -e 'op: .create.'`.

## Operate production

- [Production operations](docs/deployment.md#production-operations) covers the Workers, the Turso database, the `cf` CLI, Workers Paid, and the search reindex.
- [Diagnose a failed run](docs/ci-cd.md#diagnose-a-failed-run) covers background CI watches and failed proof logs.
- [Release the public npm beta](docs/npm-release.md) lists the files that carry the version.

<!-- packy:project:instruction:matty-codex-project:start -->
Packy manages the Matty skill trees in .agents/skills.
<!-- packy:project:instruction:matty-codex-project:end -->

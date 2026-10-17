# Standalone CLI over REST

A terminal user runs the `artifacts` CLI against an Artifacts resource. The CLI calls REST under `${MCP_URL}/v1`, which shares the store and bearer policy with MCP. It prints JSON to stdout, diagnostics and retained request IDs to stderr, and exits `1` on errors.

## Sub-features

- `cli-whoami` returns the canonical user for the supplied access token.
- `cli-create` creates an artifact from a complete `--snapshot` file.
- `cli-edit` merges partial `--changes` into the current head and preserves omitted metadata and attachments.
- `cli-update-conflict` rejects a stale `--expected-revision` with exit `1` and a `conflict` 409 error on stderr.
- `cli-history` lists both revisions newest first with `--summary`.
- `cli-publish` selects a retained revision with `--expected-version 0`.
- `cli-export` writes the exact ZIP for an older revision and reports its SHA-256.
- `cli-login` performs browser OAuth with PKCE and stores private credentials. The local drive does not cover it.
- `cli-retry` replays a retained operation after a lost response. The local drive does not cover it.
- `cli-skills` lists, prints, and installs bundled skills offline. `pnpm test:cli-skills` covers it from the packed tarball.

## How to get to it (user POV)

- Install `@yargote/artifacts-cli` or run `pnpm artifacts` from this checkout.
- Set `ARTIFACTS_SERVER` to the complete resource, including `/mcp`, then run `artifacts login` and `artifacts whoami`.
- Run `artifacts create`, `edit`, `update`, `history`, `publish`, and `export` as documented in [apps/cli/README.md](../../../../apps/cli/README.md).

## Driving it with control.ts (source CLI + REST)

```sh
R=.test-artifacts/verify-artifacts/cli-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive cli --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

The drive spawns `node --import tsx apps/cli/src/index.ts` with `ARTIFACTS_SERVER` set to the run's MCP URL, `ARTIFACTS_ACCESS_TOKEN` set to the disposable token, and a private `ARTIFACTS_STATE_DIR` under `runtime/`. It runs `whoami`, `create --snapshot`, `edit --changes`, a stale `update`, `history --summary`, `publish`, and `export --revision <r1> --out`.

Expected end state:

- `whoami.userId` equals the run's disposable owner.
- The edited revision's parent is revision 1, and its snapshot keeps the title, description, and `notes.txt` attachment.
- The stale update exits `1`, and its stderr contains `"code":"conflict"` with status `409`.
- `cli-revision-1.zip` hashes to the CLI-reported SHA-256 and equals the MCP `artifacts_export` bytes for revision 1.
- An independent MCP `artifacts_read` shows the edited revision as head and published.

Evidence under `<run>/cli/` includes `actions.jsonl`, which records every CLI argv, exit code, stdout, and stderr without the token. The directory also contains `snapshot-1.json`, `changes.json`, `cli-revision-1.zip`, and `result.json`.

## Gotchas

- The supervisor serves the combined MCP+REST resource app, as `apps/mcp` does in production. A run started by an older helper serves MCP only, and every CLI command gets a 404 `invalid_response`.
- Node prints an `ExperimentalWarning` for SQLite on stderr. This warning is expected and does not indicate a failure.
- The drive uses the source CLI, not the packed npm tarball. Use `pnpm test:cli-first-use` or `pnpm test:packages` to prove the published package shape.
- The token from the access-token environment variable bypasses `login`. Interactive OAuth consent remains covered only by `pnpm test:rest-cli:browser` and live acceptance.

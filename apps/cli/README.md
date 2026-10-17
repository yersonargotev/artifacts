# Artifacts CLI reference

The `artifacts` Node CLI reads and writes retained artifacts through REST. It prints JSON results to stdout and diagnostics to stderr. Offline skills commands print plain text. Node 24 or later is required. Its private credential database uses Node's experimental built-in SQLite API.

The `@yargote/artifacts-cli` package exposes the `artifacts` binary as compiled ESM JavaScript. Its client and contracts dependencies install automatically. Repository development uses `pnpm artifacts` with the same command syntax.

## Install the beta

Use Node 24 or later. The beta targets macOS and Linux. Windows has not been verified.

Choose one persistent installation:

```sh
npm install --global @yargote/artifacts-cli@0.1.0-beta.2
# Or, with pnpm and an existing global bin directory on PATH:
pnpm add --global @yargote/artifacts-cli@0.1.0-beta.2
artifacts --version
```

If pnpm reports that no global bin directory exists, run `pnpm setup` and reopen your shell before installation.

For one-off execution, pin the same version:

```sh
npx --yes @yargote/artifacts-cli@0.1.0-beta.2 --help
pnpm dlx @yargote/artifacts-cli@0.1.0-beta.2 --help
```

`@beta` follows future prereleases. Exact versions remain reproducible. No stable `latest` release is part of this beta. An organization's pnpm minimum release age or trust policy can delay a new release. Follow that policy rather than disabling it globally.

## Complete first use

An existing Artifacts account is required. Select the complete OAuth resource, including `/mcp`:

```sh
export ARTIFACTS_SERVER='https://artifacts-mcp.yersonargotev.workers.dev/mcp'
artifacts login
artifacts whoami
```

Login opens browser authorization. After you approve access, `whoami` prints JSON with your user ID and scopes. Use `artifacts login --no-browser` to open the printed authorization URL yourself on the same machine.

Create `snapshot.json`:

```json
{
	"metadata": { "title": "My first CLI artifact", "description": "Created through REST" },
	"content": { "kind": "text", "text": "Hello from the Artifacts CLI." },
	"files": []
}
```

```sh
artifacts create --snapshot snapshot.json
artifacts list --limit 5
```

The create result contains `artifactId` and `headRevisionId`. Use those values to read, publish, and export the exact revision:

```sh
artifacts read ARTIFACT_ID
artifacts publish ARTIFACT_ID --revision REVISION_ID --expected-version 0
artifacts export ARTIFACT_ID --revision REVISION_ID --out artifact.zip
artifacts logout
```

Publication URLs require authenticated owner access. A retained request ID appears on stderr before each mutation. If the response is lost, run `artifacts retry REQUEST_ID` with the same server and state directory. Keep that state directory when upgrading, reinstalling, or switching between global and one-off execution.

## Upgrade or uninstall

Install another exact version with the same package manager to change the executable version. Credentials and retained operation files live outside the package installation and remain available.

```sh
npm uninstall --global @yargote/artifacts-cli
# Or:
pnpm remove --global @yargote/artifacts-cli
```

Run `artifacts logout` before uninstalling if you want to clear credentials. Uninstalling does not delete retained operations.

## Server and local state

Skills, help, and version commands work without a server or login. Skills commands do not read credentials or create private state. They accept and ignore global `--server` and `--state-dir` values, including their environment defaults.

`--server RESOURCE` selects the exact canonical OAuth resource. `ARTIFACTS_SERVER` supplies the same value. A resource ending in `/mcp` uses REST under `/mcp/v1`. The CLI has no production default.

`--state-dir DIR` overrides `ARTIFACTS_STATE_DIR`. The default is `~/.local/state/artifacts`. The state directory must be private and owned by the current user. Credentials are separate from operation files. Profiles bind credentials to the exact resource. Retained operation paths hash the resource and request ID, so request IDs cannot select filesystem paths.

HTTPS is required except for HTTP on the exact loopback hosts `localhost`, `127.0.0.1`, and `[::1]`. Server URLs cannot contain credentials, a query, or a fragment.

## Authentication

`artifacts login --server RESOURCE` verifies protected-resource metadata, registers a public native OAuth client, and opens browser authorization with PKCE. `--no-browser` prints the authorization URL for manual navigation. The loopback callback listener starts before browser navigation. Login requests read, write, and publication scopes. Client registration is reused for the profile.

`artifacts whoami` returns the verified user, session, OAuth client, and scopes.

`artifacts logout` clears local credentials and attempts to revoke the refresh token. Its JSON contains `signedOut: true` and `remoteRevocation` with `confirmed`, `unconfirmed`, or `not-needed`. Issued access JWTs can remain valid until expiry or central-session revocation.

`ARTIFACTS_ACCESS_TOKEN` supplies an access token for automation. It does not require local login. Tokens are never command arguments or retained operation fields.

The private `credentials.sqlite` file stores credentials. The separate `credentials-lock.sqlite` file contains no credentials and holds a SQLite write lock to serialize refresh and logout across processes. A committed uncertainty marker in the data file survives process death, while SQLite releases the lock. Login and logout generations prevent a late browser callback from restoring signed-out credentials. An uncertain refresh requires login.

## Command syntax

`artifacts --help` prints this command reference. `artifacts --version` prints the installed package version without requiring a server or login.

```text
artifacts login [--no-browser]
artifacts logout
artifacts whoami
artifacts create --snapshot FILE [--request-id ID] [--response full|compact]
artifacts create --command FILE
artifacts list [--limit N] [--cursor CURSOR]
artifacts read ID [--revision REV] [--response full|compact] [--out FILE [--quiet]]
artifacts update ID --snapshot FILE --expected-revision REV [--request-id ID]
                 [--response full|compact]
artifacts update [ID] --command FILE
artifacts edit ID --changes FILE [--request-id ID]
artifacts history ID [--limit N] [--before-sequence N] [--summary]
artifacts publish ID --revision REV --expected-version N [--request-id ID]
artifacts publish [ID] --command FILE
artifacts export ID --revision REV --out FILE
artifacts retry REQUEST_ID
artifacts skills [list]
artifacts skills get NAME [--full]
artifacts skills get --all [--full]
artifacts skills path [NAME]
artifacts skills install [NAME] [--agent claude] [--global] [--force]
```

Global `--server RESOURCE` and `--state-dir DIR` options can appear before or after the command. Options cannot be repeated. Unknown options and options for another command fail before submission.

## Bundled skills

Check `artifacts --help` for `skills` support. The published `0.1.0-beta.1` package predates this command group. These commands describe the current source and packages built from it.

`artifacts skills` and `artifacts skills list` print each bundled skill's name and description, separated by a tab. The initial catalog contains `artifacts-cli`. Its complete source directory is bundled with the CLI, so the instructions match the installed version and work offline.

`artifacts skills get artifacts-cli` prints the complete `SKILL.md` without headers or changes to its bytes. `--full` includes every bundled reference and template. Each file starts with a catalog-relative marker such as `=== artifacts-cli/references/commands.md ===`. `artifacts skills get --all` prints every `SKILL.md` with these markers. Add `--full` to include every skill's support files.

`artifacts skills path` prints the absolute bundled catalog directory. Add a skill name to print that skill's directory. These paths belong to the CLI package and do not depend on the current directory.

Install a discovery skill for an agent with one of these commands.

| Command | Destination |
| --- | --- |
| `artifacts skills install` | `./.agents/skills/artifacts-cli/SKILL.md` |
| `artifacts skills install --agent claude` | `./.claude/skills/artifacts-cli/SKILL.md` |
| `artifacts skills install --global` | `~/.agents/skills/artifacts-cli/SKILL.md` |
| `artifacts skills install --agent claude --global` | `~/.claude/skills/artifacts-cli/SKILL.md` |

The optional name defaults to `artifacts-cli`. The default destination always uses `.agents`, even if `.claude` already exists. Only explicit `--agent claude` selects `.claude`. Local paths resolve from the current directory. Global paths resolve from the user's home directory.

The command prints the absolute destination. It leaves identical files unchanged, including their modification time. A differing file requires `--force`. Forced installation replaces only `SKILL.md` and preserves neighboring files. A directory or symbolic link at `SKILL.md` is rejected.

The discovery file instructs the agent to run `artifacts skills get artifacts-cli --full` and follow the returned instructions. It contains no copied workflow or fixed package path. After a CLI upgrade, the same discovery command loads that installed version's skill.

## Artifact input and output

Create and update snapshot files contain the complete domain snapshot.

```json
{
	"metadata": { "title": "Example", "description": "A retained document", "custom": { "team": "design" } },
	"content": { "kind": "html", "text": "<h1>Example</h1>" },
	"files": [{ "path": "data.txt", "mediaType": "text/plain", "encoding": "utf8", "data": "retained attachment" }]
}
```

`read --out FILE` saves the returned artifact JSON and also prints it to stdout. Add `--quiet` to suppress successful stdout while saving the same bytes for the selected response mode. `--quiet` is available only for `read` and requires a nonempty `--out FILE`. Errors still go to stderr and exit with code `1`.

Check installed help for `--quiet` support. Version `0.1.0-beta.1` predates this option. With that version, `artifacts read ARTIFACT_ID --out saved.json > /dev/null` suppresses stdout while preserving stderr and the exit status.

A default full read contains the complete snapshot under `revision.snapshot`. `export --out FILE` saves the exact ZIP and prints its filename, local path, media type, SHA-256, and byte count. Output files use exclusive creation and never overwrite an existing path.

History defaults to complete revisions. `--summary` returns revision metadata and attachment summaries. `--before-sequence` continues a page. `list --cursor` continues an artifact list.

## Complete commands and edits

`--command FILE` accepts a complete create, update, or publish command. It cannot be combined with other mutation options. For update and publish, an optional positional artifact ID must equal the command's `artifactId`. Every field, including the omission of `response`, is retained.

A complete update command has this shape.

```json
{
	"requestId": "reviewed-update-001",
	"artifactId": "artifact-id",
	"expectedRevisionId": "reviewed-revision-id",
	"snapshot": {
		"metadata": { "title": "Reviewed title", "description": "Complete replacement" },
		"content": { "kind": "text", "text": "Reviewed text" },
		"files": []
	}
}
```

`edit ID --changes FILE` reads the current snapshot, merges partial `metadata` and `content` changes, and retains the resulting complete update. An explicit `files` array replaces the attachments. Omitted fields and attachments are preserved.

```json
{ "metadata": { "title": "Changed title" }, "content": { "text": "Changed text" } }
```

Publish always selects an immutable revision. `--expected-version 0` expects no existing publication. Later publication commands require the current publication version.

## Recovery

Each invocation resolves one access token for its reads, owner check, and submission. A concurrent login cannot change the command owner between these requests. Every mutation verifies the owner and retains an exclusive private operation file before submission. Missing request IDs default to random UUIDs. The operation stores its exact command, owner, and resource. It contains no credentials. Existing operation files require explicit `retry` and are never replaced by another preparation.

`retry REQUEST_ID` verifies the current resource and owner, then sends the unchanged command once. Retry does not read a new head, change expected versions, add a response projection, or rebase a conflict. Its diagnostic identifies the result as a retained receipt. A fresh `read` returns current state.

If a response is lost after commit, retry recovers the original receipt. If a conflict occurs, the retained operation remains available for inspection. A new read and a deliberate new command with a new request ID are required to incorporate another writer's changes.

Commands exit with code `1` on failure and print a JSON error to stderr. Server errors preserve their HTTP status, code, and conflict details. Successful JSON stdout contains no progress messages or credentials.

## License and support

This package is MIT licensed. The client and contracts packages have their own MIT licenses. This does not license the private Artifacts application repository. Contact your Artifacts service administrator with `artifacts --version`, Node and package-manager versions, and a redacted error. Never include credentials or the contents of `credentials.sqlite`.

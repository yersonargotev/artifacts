# Artifacts CLI reference

The `artifacts` Node CLI reads and writes retained artifacts through REST. It prints JSON results to stdout and diagnostics to stderr. Offline skills commands print plain text. Node 24 or later is required. Its private credential database uses Node's experimental built-in SQLite API.

The `@yargote/artifacts-cli` package exposes the `artifacts` binary as compiled ESM JavaScript. Its client and contracts dependencies install automatically. Repository development uses `pnpm artifacts` with the same command syntax.

## Install the beta

Use Node 24 or later. The beta targets macOS and Linux. Windows has not been verified.

Choose one persistent installation:

```sh
npm install --global @yargote/artifacts-cli@0.1.0-beta.6
# Or, with pnpm and an existing global bin directory on PATH:
pnpm add --global @yargote/artifacts-cli@0.1.0-beta.6
artifacts --version
```

If pnpm reports that no global bin directory exists, run `pnpm setup` and reopen your shell before installation.

For one-off execution, pin the same version:

```sh
npx --yes @yargote/artifacts-cli@0.1.0-beta.6 --help
pnpm dlx @yargote/artifacts-cli@0.1.0-beta.6 --help
```

`@beta` follows future prereleases. Exact versions remain reproducible. No stable `latest` release is part of this beta. An organization's pnpm minimum release age or trust policy can delay a new release. Follow that policy rather than disabling it globally.

## Complete first use

An existing Artifacts account is required. Select the REST OAuth resource, which is the API origin without `/mcp`. The address below is the configured hostname after the [API migration](../../docs/deployment.md#migrate-the-api-hostname). Its deployment is not yet verified.

```sh
export ARTIFACTS_SERVER='https://artifacts-api.yersonargotev.workers.dev'
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

A publication URL requires sign-in. It opens for the owner and for a user whose verified email equals an email share of the artifact. That user sees only the published revision and its attachments. A retained request ID appears on stderr before each mutation. If the response is lost, run `artifacts retry REQUEST_ID` with the same server and state directory. Keep that state directory when upgrading, reinstalling, or switching between global and one-off execution.

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

`--server RESOURCE` selects the exact canonical REST OAuth resource. `ARTIFACTS_SERVER` supplies the same value. Use the configured `API_URL` origin to call REST under `/v1`. The CLI has no production default and does not rewrite the supplied URL. Older deployments without `API_URL` still use their complete MCP resource and routes under `/mcp/v1`.

A hostname change requires a new `artifacts login --server RESOURCE`. Credentials and retained operations remain bound to their exact original resource. Do not move an old operation file to the new resource or redirect its bearer requests.

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
artifacts create --snapshot FILE [--project NAME] [--request-id ID]
                 [--response full|compact]
artifacts create --command FILE
artifacts list [--limit N] [--cursor CURSOR] [--project NAME]
artifacts projects
artifacts read ID [--revision REV] [--response full|compact] [--out FILE [--quiet]]
artifacts update ID --snapshot FILE --expected-revision REV [--request-id ID]
                 [--response full|compact]
artifacts update [ID] --command FILE
artifacts edit ID --changes FILE [--request-id ID]
artifacts history ID [--limit N] [--before-sequence N] [--summary]
artifacts publish ID --revision REV --expected-version N [--request-id ID]
artifacts publish [ID] --command FILE
artifacts export ID --revision REV --out FILE
artifacts move ID --project NAME [--request-id ID]
artifacts move ID --no-project [--request-id ID]
artifacts share ID --email EMAIL [--notify] [--request-id ID]
artifacts shares ID
artifacts unshare ID SHARE_ID [--request-id ID]
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

`artifacts skills` and `artifacts skills list` print each bundled skill's name and description, separated by a tab. The catalog contains `artifacts-cli` and `artifacts-design`, which owns HTML design, bundled fonts, and the font embedding script. Their complete source directories are bundled with the CLI, so the instructions match the installed version and work offline.

`artifacts skills get artifacts-cli` prints the complete `SKILL.md` without headers or changes to its bytes. `--full` includes every bundled reference and template. Binary files such as fonts appear as a marker with their size, for example `=== artifacts-design/fonts/public-sans.woff2 (binary, 26636 bytes) ===`; read them from `artifacts skills path artifacts-design`. Each file starts with a catalog-relative marker such as `=== artifacts-cli/references/commands.md ===`. `artifacts skills get --all` prints every `SKILL.md` with these markers. Add `--full` to include every skill's support files.

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

## Projects

A project groups artifacts by name. `create --snapshot FILE --project NAME` files the new artifact under that project. A name that matches an existing project regardless of letter case reuses its stored spelling, so `--project alpha` joins `Alpha`. Names are trimmed and NFC-normalized, contain 1 to 80 characters, and cannot contain control characters. A complete create command file can include the same optional `project` field.

```sh
artifacts create --snapshot snapshot.json --project Alpha
artifacts list --project alpha
artifacts projects
artifacts move ARTIFACT_ID --project Beta
artifacts move ARTIFACT_ID --no-project
```

Every artifact read and list item includes `project`, a name or null. `projects` prints `{ "items": [{ "name": "Alpha", "artifactCount": 1 }] }`, ordered by name without regard to letter case. A project exists only while it contains an artifact.

`move ID` requires exactly one of `--project NAME` or `--no-project`. It prints `{ "artifactId": "...", "project": "Beta" }` with the stored spelling, or `null` after `--no-project`. Move never creates a revision or changes the publication. Moving to the current project succeeds without change. Move is a retained mutation like the others, so `retry` recovers a lost response.

Version `0.1.0-beta.4` and earlier parse artifact responses strictly and fail with `invalid_response` against a server that returns `project`. Upgrade the CLI together with the server.

## Share publication access

These commands are available from `0.1.0-beta.6`. Check installed help for support.

```sh
artifacts share ARTIFACT_ID --email ana@example.com --request-id share-ana-001
artifacts shares ARTIFACT_ID
artifacts unshare ARTIFACT_ID SHARE_ID --request-id unshare-ana-001
artifacts retry share-ana-001
```

`share` trims and lowercases the email and prints one share as JSON with `shareId`, `artifactId`, `kind: "email"`, `value`, and `createdAt`. `shares` prints `{ "items": [...] }` with current grants and retains no operation. Take `SHARE_ID` from that output. `unshare` and a successful retry of an unshare exit zero with empty stdout. All three commands require the owner's `artifacts:publish` scope.

A signed-in user whose verified email matches a share can view the published revision and its attachments. History, export, edits, and project moves remain owner-only. Shares created before first publication remain stored, but the URL opens only after publication. Add `--notify` to request one invitation email. Invited people can sign in with an email code when the server enables email.

Share and unshare retain the complete normalized command before submission. Recover an uncertain result with `retry REQUEST_ID`. A replay confirms the original operation, so a historical share replay does not restore a revoked grant. An old unshare replay leaves a deliberate new share intact. Run `shares ARTIFACT_ID` to verify current grants.

Share with `--notify` to request one email attempt. Access succeeds when mail is disabled or the owner has used the daily allowance. The JSON result adds `notification.status` as `requested` or `skipped`, with `disabled` or `rate_limited` as the skip reason. `requested` does not confirm delivery. A crash after commit can lose the message. An exact retry preserves the captured flag and never sends a second email. Use a new deliberate command to request another attempt for existing access.

Owners can reserve 100 invitations per UTC day. Revoke, deletion, and failed delivery do not refund reservations. New access is limited to 100 people per artifact and 1000 grants per owner. Existing access remains listable and revocable.

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

`retry REQUEST_ID` verifies the current resource and owner, then sends the unchanged command once. Retry does not read a new head, change expected versions, add a response projection, or rebase a conflict. Its diagnostic identifies replay of the original operation and warns that replay does not establish current state. A fresh `read` or `shares` returns current state.

If a response is lost after commit, retry recovers the original receipt. If a conflict occurs, the retained operation remains available for inspection. A new read and a deliberate new command with a new request ID are required to incorporate another writer's changes.

Commands exit with code `1` on failure and print a JSON error to stderr. Server errors preserve their HTTP status, code, and conflict details. Successful JSON stdout contains no progress messages or credentials.

## License and support

This package is MIT licensed. The client and contracts packages have their own MIT licenses. This does not license the private Artifacts application repository. Contact your Artifacts service administrator with `artifacts --version`, Node and package-manager versions, and a redacted error. Never include credentials or the contents of `credentials.sqlite`.

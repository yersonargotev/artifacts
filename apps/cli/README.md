# Artifacts CLI reference

The `artifacts` Node CLI reads and writes retained artifacts through REST. It prints JSON results to stdout and diagnostics to stderr. Node 24 or later is required. Its private credential database uses Node's experimental built-in SQLite API.

The installed package exposes the `artifacts` binary as compiled ESM JavaScript. Repository development uses `pnpm artifacts`. The command syntax is identical. Run `pnpm build:packages` in the repository, then install the generated contracts, client, and CLI tarballs together. The [repository install instructions](https://github.com/yersonargotev/artifacts/blob/5ccb12e7cb9711c7919171602b3af7006e8bc6cc/README.md#use-the-standalone-cli-or-rest-client) show the exact command. The standalone [artifacts-cli skill](https://github.com/yersonargotev/artifacts/blob/5ccb12e7cb9711c7919171602b3af7006e8bc6cc/skills/artifacts-cli/SKILL.md) supplies authoring and retry guidance.

## Server and local state

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

`artifacts --help` prints this command reference.

```text
artifacts login [--no-browser]
artifacts logout
artifacts whoami
artifacts create --snapshot FILE [--request-id ID] [--response full|compact]
artifacts create --command FILE
artifacts list [--limit N] [--cursor CURSOR]
artifacts read ID [--revision REV] [--response full|compact] [--out FILE]
artifacts update ID --snapshot FILE --expected-revision REV [--request-id ID]
                 [--response full|compact]
artifacts update [ID] --command FILE
artifacts edit ID --changes FILE [--request-id ID]
artifacts history ID [--limit N] [--before-sequence N] [--summary]
artifacts publish ID --revision REV --expected-version N [--request-id ID]
artifacts publish [ID] --command FILE
artifacts export ID --revision REV --out FILE
artifacts retry REQUEST_ID
```

Global `--server RESOURCE` and `--state-dir DIR` options can appear before or after the command. Options cannot be repeated. Unknown options and options for another command fail before submission.

Create and update snapshot files contain the complete domain snapshot.

```json
{
	"metadata": { "title": "Example", "description": "A retained document", "custom": { "team": "design" } },
	"content": { "kind": "html", "text": "<h1>Example</h1>" },
	"files": [{ "path": "data.txt", "mediaType": "text/plain", "encoding": "utf8", "data": "retained attachment" }]
}
```

`read --out FILE` saves the returned artifact JSON and also prints it to stdout. A default full read contains the complete snapshot under `revision.snapshot`. `export --out FILE` saves the exact ZIP and prints its filename, local path, media type, SHA-256, and byte count. Output files use exclusive creation and never overwrite an existing path.

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

# Command workflow

Check the installed `artifacts --help` before use. These examples use the canonical resource selected for the task. `ARTIFACT_ID` and `REVISION_ID` stand for IDs observed in actual command output.

## Inspect and install bundled skills

When installed help lists `skills`, use these commands without a server or login.

```sh
artifacts skills
artifacts skills get artifacts-cli --full
artifacts skills get --all --full
artifacts skills path artifacts-cli
artifacts skills install
artifacts skills install --agent claude --global
```

`skills` and `skills list` list names and descriptions. Plain `skills get artifacts-cli` returns the complete `SKILL.md`. `--full` includes references and templates with relative file paths. `skills path` without a name returns the catalog directory.

Installation defaults to `artifacts-cli` in `.agents/skills` under the current directory. `--agent claude` selects `.claude/skills`. `--global` selects the user's home directory. Existing agent directories do not affect the default. The discovery file instructs the agent to load the installed CLI's complete instructions with `artifacts skills get artifacts-cli --full`. Installation reports the absolute path, leaves identical files unchanged, and requires `--force` to replace differing files.

The published `0.1.0-beta.1` package predates skills commands. Do not assume support without checking help.

## Authenticate

```sh
artifacts login --server https://artifacts.example.test/mcp
artifacts whoami
```

Replace the example with the selected resource before executing it. Service commands select `--server RESOURCE` before `ARTIFACTS_SERVER`, then the connection saved by a successful identity-verified login. Ordinary overrides do not replace the saved connection. A later successful login replaces it with the verified REST resource. A failed login to another server preserves the previous connection and its credentials. Check installed help for saved-connection support.

`--state-dir DIR` or `ARTIFACTS_STATE_DIR` selects an isolated private state directory. For automation, `ARTIFACTS_ACCESS_TOKEN` supplies an already authorized bearer token. Do not echo it or put it in an argument.

Use `--no-browser` when the environment cannot open a browser automatically. Open the printed authorization URL and keep the CLI running for its loopback callback. A remote machine's loopback callback must be reachable by the browser used for login. Do not replace the callback with an arbitrary public listener.

`logout` clears local credentials and attempts refresh-token revocation. It keeps the saved connection, so a later `artifacts login` can reuse it. Copied access JWTs can remain valid until expiry. The existing account page's global session revocation stops access across CLI, REST, MCP, and panel. Local logout does not claim to perform that global action.

## Create a complete snapshot

Save this JSON as `snapshot.json`, replacing its content with the requested artifact.

```json
{
  "metadata": {
    "title": "Project note",
    "description": "A retained note",
    "custom": { "source": "requested content" }
  },
  "content": {
    "kind": "html",
    "text": "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Project note</title><main><h1>Project note</h1><p>Retained content.</p></main></html>"
  },
  "files": [
    {
      "path": "notes.txt",
      "mediaType": "text/plain",
      "encoding": "utf8",
      "data": "Retained attachment.\n"
    }
  ]
}
```

`metadata.description` and `files` are required even when empty. Content kind is `html`, `markdown`, `text`, or `design`. Binary files use `encoding: "base64"` and canonical padded base64. Paths are unique normalized relative paths. Do not use empty, dot, parent, absolute, backslash, percent, or colon path segments. A file cannot also be another file's directory.

```sh
artifacts create --snapshot snapshot.json
artifacts list --limit 25
artifacts read ARTIFACT_ID --out saved.json --quiet
```

Keep the request ID printed for the mutation. Successful JSON goes to stdout; diagnostics and recovery instructions go to stderr. Exit zero indicates command success. A nonzero exit must be inspected before claiming completion.

For `read`, `--out FILE --quiet` saves the returned response without printing successful JSON. It requires a nonempty output path. It preserves the selected response mode, so use the default full response for snapshot verification. Errors still go to stderr and exit nonzero. Without `--quiet`, `read --out FILE` also prints the response to stdout.

Check installed help for `--quiet` support before running these examples. Older versions, including `0.1.0-beta.1`, can suppress stdout with `artifacts read ARTIFACT_ID --out saved.json > /dev/null`. This redirection preserves stderr and the command's exit status. Use the same fallback for the revision reads below.

## Prepare a design canvas

Read the design skill's `references/canvas.md` through `artifacts skills get artifacts-design --full`. Keep the index in `my-canvas/canvas.json` and complete UTF-8 board documents in `my-canvas/boards/*.html`.

```sh
artifacts skills path artifacts-cli
node <returned-skill-directory>/scripts/prepare-retained.mjs ./my-canvas > snapshot.json
artifacts create --snapshot snapshot.json
```

The positional form accepts exactly one directory. It preserves the index text and board HTML, sorts snapshot files by path, validates the complete `design` snapshot with the installed contracts, and rejects missing or orphan boards. It uses the directory basename as the title and an empty description. Edit the emitted metadata before saving when needed. Keep the script under the path returned by `skills path` so its package dependencies resolve. All board data, embedded fonts, index text, and metadata share the 1 MiB budget.

The existing named-option form of `prepare-retained.mjs` builds a private retained-verification config from saved receipts and an independent read. It does not prepare a content snapshot. The two input forms cannot be combined.

## Organize projects

Check that installed help lists `projects` and `move` before using them.

```sh
artifacts create --snapshot snapshot.json --project "Client onboarding"
artifacts projects
artifacts list --project "client onboarding"
artifacts move ARTIFACT_ID --project Archive
artifacts move ARTIFACT_ID --no-project
```

A project name contains 1 to 80 characters after trimming and NFC normalization, without control characters. A name that matches an existing project regardless of letter case joins it and keeps its stored spelling. Every read and list item includes `project`, a name or null. `projects` prints `{ "items": [{ "name": "Client onboarding", "artifactCount": 1 }] }`, ordered by name without regard to letter case. A project exists only while it contains an artifact.

`move` takes at least one of `--project NAME`, `--no-project`, `--slug SLUG`, or `--no-slug`, and at most one from each pair. It prints `{ "artifactId": "...", "project": "Archive" }`, or `null` for the project after `--no-project`. An option left out keeps that value. It creates no revision and leaves the publication unchanged. Moving to the current project succeeds without change. A lost move response is recovered with `retry REQUEST_ID` like any other retained mutation.

## Name pages with slugs

Check that installed help lists `--slug` before using it.

```sh
artifacts create --snapshot snapshot.json --project "Mi wiki" --slug concepts/rag
artifacts read --project "mi wiki" --slug concepts/rag
artifacts read --slug index
artifacts move ARTIFACT_ID --slug concepts/retrieval
artifacts move ARTIFACT_ID --no-slug
```

A slug contains 1 to 160 characters of lowercase ASCII kebab-case segments separated by `/`, such as `concepts/rag` or `index`. It is never normalized, and a trailing `.md` is rejected with a hint to remove it. A slug is unique within the owner's project, matched by the project's stored spelling. Artifacts without a project share one unfiled namespace, which `read --slug` without `--project` reads. Every read and list item includes `slug`, a name or null.

`read` takes exactly one of an ID or `--slug`. `--project` applies only with `--slug`. A used slug fails `create` with `slug_conflict`, status 409, and the holder's `artifactId` in `details`. A locator with no artifact fails with `not_found`. `move ID --slug SLUG` renames a page in its project, and `move ID --no-slug` clears the slug. A move to another project keeps the slug unless `--slug` or `--no-slug` changes it. A move fails with `slug_conflict` and changes nothing when the target project already uses the target slug. A slug change creates no revision.

## Search pages

Check that installed help lists `search` before using it.

```sh
artifacts search envigado
artifacts search "tarde envigado" --project "mi wiki"
artifacts search envigado --limit 5 --cursor 5
```

`search QUERY` finds owned Markdown and text artifacts whose title, description, or content at the head revision contains every term. Quote a query with spaces. The query is plain text of 1 to 256 characters. Every whitespace-separated term must match, letter case and accents are ignored, and operators or punctuation in the query are treated as text, so input such as `"foo" OR NEAR(` never fails with a syntax error. HTML and design artifacts, older revisions, and artifacts shared with the caller are not searched. `--project` matches regardless of letter case. `--limit` is 1 to 25 and defaults to 10. Items are `{ artifactId, project, slug, title, snippet, rank }`, ordered by `rank` and then `artifactId`. `rank` is the FTS5 `bm25` score, where lower is more relevant, and `snippet` is an excerpt with each match wrapped in `**`. Pass `nextCursor` as `--cursor` for the next page; `null` means there are no more results.

## Edit without losing retained data

For a title change, save `changes.json` with only the requested field.

```json
{ "metadata": { "title": "Reviewed project note" } }
```

```sh
artifacts edit ARTIFACT_ID --changes changes.json
artifacts read ARTIFACT_ID --out current.json --quiet
```

For a complete replacement, read the current head, preserve untouched data in `next-snapshot.json`, and use that observed revision.

```sh
artifacts update ARTIFACT_ID --snapshot next-snapshot.json --expected-revision REVISION_ID
```

A complete command file can preserve a caller-owned request ID, snapshot, and expected revision. Use `artifacts create --command create.json`, `artifacts update --command update.json`, or `artifacts publish --command publish.json`. Do not add `response: "full"` to an existing command that omitted it. Optional response modes affect exact mutation identity.

Command files contain the command itself, without the CLI's retained-operation wrapper.

| Command | Required JSON fields |
| --- | --- |
| `create` | `requestId`, `snapshot` |
| `update` | `requestId`, `artifactId`, `expectedRevisionId`, `snapshot` |
| `publish` | `requestId`, `artifactId`, `revisionId`, `expectedPublicationVersion` |

`requestId` is a caller-chosen string of 8 to 128 characters. Create and update also accept optional `response` with value `full` or `compact`. Create also accepts an optional `project` name and an optional `slug`. This complete update example replaces a snapshot. Substitute the observed IDs and preserve all required content and attachments in its `snapshot`.

```json
{
  "requestId": "reviewed-update-001",
  "artifactId": "OBSERVED_ARTIFACT_ID",
  "expectedRevisionId": "OBSERVED_HEAD_REVISION_ID",
  "snapshot": {
    "metadata": { "title": "Reviewed project note", "description": "A retained note" },
    "content": { "kind": "text", "text": "Reviewed content." },
    "files": []
  }
}
```

Create uses the same `requestId` and complete `snapshot` fields without artifact or expected-revision IDs. A complete publication command has this shape. Replace zero with the observed publication version when already published.

```json
{
  "requestId": "reviewed-publish-001",
  "artifactId": "OBSERVED_ARTIFACT_ID",
  "revisionId": "SELECTED_REVISION_ID",
  "expectedPublicationVersion": 0
}
```

## Inspect history and publish

```sh
artifacts history ARTIFACT_ID --summary
artifacts read ARTIFACT_ID --revision REVISION_ID --out historical.json --quiet
artifacts publish ARTIFACT_ID --revision REVISION_ID --expected-version 0
```

The publication example applies only to an unpublished artifact. For an existing publication, replace zero with the `publication.version` observed in a current read. After publishing, read again and compare current publication with the returned receipt.

History returns `nextBeforeSequence`; pass it as `--before-sequence N` to continue. List returns `nextCursor`; pass it as `--cursor CURSOR`. Do not substitute an offset or assume that one page contains everything.

## Share publication access

Check installed help for these commands. They are available from `0.1.0-beta.6`.

```sh
artifacts share ARTIFACT_ID --email ana@example.com --request-id share-ana-001
artifacts shares ARTIFACT_ID
artifacts unshare ARTIFACT_ID SHARE_ID --request-id unshare-ana-001
artifacts retry share-ana-001
```

Share requires the owner's `artifacts:publish` scope, trims and lowercases the email, and prints a share with `shareId`, `artifactId`, `kind: "email"`, `value`, and `createdAt`. `shares` requires the same scope and prints `{ "items": [...] }` with current grants without retaining a mutation. Use an observed `shareId` to unshare. Unshare requires the same scope. Unshare and its successful retry exit zero with empty stdout.

The publication admits the owner and signed-in users whose verified email matches a current share. Guests see the published revision and attachments. History, export, editing, and project moves remain owner-only. Shares before first publication wait for publication. Add `--notify` to request one invitation email. Invited people can sign in with an email code when the server enables email.

Share and unshare retain complete normalized commands. `retry REQUEST_ID` replays the original operation. A historical share replay does not regrant revoked access, and an old unshare replay leaves a deliberate new share intact. Verify current grants with `shares ARTIFACT_ID` after a replay.

Share with `--notify` to request one email attempt. Access succeeds when mail is disabled or the owner has used the daily allowance. The JSON result adds `notification.status` as `requested` or `skipped`, with `disabled` or `rate_limited` as the skip reason. `requested` does not confirm delivery. A crash after commit can lose the message. An exact retry preserves the captured flag and never sends a second email. Use a new deliberate command to request another attempt for existing access.

Owners can reserve 100 invitations per UTC day. Revoke, deletion, and failed delivery do not refund reservations. New access is limited to 100 people per artifact and 1000 grants per owner. Existing access remains listable and revocable.

## Verify the exact saved revision

Follow [the retained revision recipe](verify-retained.md) after successful authoring and requested publication. Retain each successful write stdout in a private receipt file. The recipe extracts its IDs, performs a full independent explicit-revision read, and prepares the existing verifier config without authoring or account mutations. It includes an installed-browser path and identifies the additional capabilities for complete verification.

## Retry and export

```sh
artifacts retry REQUEST_ID
artifacts export ARTIFACT_ID --revision REVISION_ID --out artifact.zip
```

`retry` loads the saved complete operation. It does not prepare a new edit or change expected versions. Keep the record after an uncertain result. The server checks current authority before replaying an original receipt.

`read --out` and `export --out` create files exclusively. Use a new destination if one already exists. Do not delete an existing output merely to rerun an example.

The archive contains `artifact.json`, `content.html`, `content.md`, or `content.txt`, and attachments under `files/`. Inspect the manifest's artifact and revision IDs, content, and required attachment bytes. Exporting the same retained revision through REST, MCP, or the panel must yield identical ZIP bytes.

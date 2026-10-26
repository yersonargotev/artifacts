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
export ARTIFACTS_SERVER=https://artifacts.example.test/mcp
artifacts login
artifacts whoami
```

Replace the example with the selected resource before executing it. Service commands read `ARTIFACTS_SERVER` or an explicit `--server RESOURCE`. Login does not save a default resource. `--state-dir DIR` or `ARTIFACTS_STATE_DIR` selects an isolated private state directory. For automation, `ARTIFACTS_ACCESS_TOKEN` supplies an already authorized bearer token. Do not echo it or put it in an argument.

Use `--no-browser` when the environment cannot open a browser automatically. Open the printed authorization URL and keep the CLI running for its loopback callback. A remote machine's loopback callback must be reachable by the browser used for login. Do not replace the callback with an arbitrary public listener.

`logout` clears local credentials and attempts refresh-token revocation. Copied access JWTs can remain valid until expiry. The existing account page's global session revocation stops access across CLI, REST, MCP, and panel. Local logout does not claim to perform that global action.

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

`metadata.description` and `files` are required even when empty. Content kind is `html`, `markdown`, or `text`. Binary files use `encoding: "base64"` and canonical padded base64. Paths are unique normalized relative paths. Do not use empty, dot, parent, absolute, backslash, percent, or colon path segments. A file cannot also be another file's directory.

```sh
artifacts create --snapshot snapshot.json
artifacts list --limit 25
artifacts read ARTIFACT_ID --out saved.json --quiet
```

Keep the request ID printed for the mutation. Successful JSON goes to stdout; diagnostics and recovery instructions go to stderr. Exit zero indicates command success. A nonzero exit must be inspected before claiming completion.

For `read`, `--out FILE --quiet` saves the returned response without printing successful JSON. It requires a nonempty output path. It preserves the selected response mode, so use the default full response for snapshot verification. Errors still go to stderr and exit nonzero. Without `--quiet`, `read --out FILE` also prints the response to stdout.

Check installed help for `--quiet` support before running these examples. Older versions, including `0.1.0-beta.1`, can suppress stdout with `artifacts read ARTIFACT_ID --out saved.json > /dev/null`. This redirection preserves stderr and the command's exit status. Use the same fallback for the revision reads below.

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

`move` takes exactly one of `--project NAME` or `--no-project` and prints `{ "artifactId": "...", "project": "Archive" }`, or `null` for the project after `--no-project`. It creates no revision and leaves the publication unchanged. Moving to the current project succeeds without change. A lost move response is recovered with `retry REQUEST_ID` like any other retained mutation.

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

`requestId` is a caller-chosen string of 8 to 128 characters. Create and update also accept optional `response` with value `full` or `compact`. Create also accepts an optional `project` name. This complete update example replaces a snapshot. Substitute the observed IDs and preserve all required content and attachments in its `snapshot`.

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

Check installed help for these commands. They describe current source and built packages, not the published `0.1.0-beta.5` release.

```sh
artifacts share ARTIFACT_ID --email ana@example.com --request-id share-ana-001
artifacts shares ARTIFACT_ID
artifacts unshare ARTIFACT_ID SHARE_ID --request-id unshare-ana-001
artifacts retry share-ana-001
```

Share requires the owner's `artifacts:publish` scope, trims and lowercases the email, and prints a share with `shareId`, `artifactId`, `kind: "email"`, `value`, and `createdAt`. `shares` requires the same scope and prints `{ "items": [...] }` with current grants without retaining a mutation. Use an observed `shareId` to unshare. Unshare requires the same scope. Unshare and its successful retry exit zero with empty stdout.

The publication admits the owner and signed-in users whose verified email matches a current share. Guests see the published revision and attachments. History, export, editing, and project moves remain owner-only. Shares before first publication wait for publication. These commands do not send invitation emails or provide email-code sign-in.

Share and unshare retain complete normalized commands. `retry REQUEST_ID` replays the original operation. A historical share replay does not regrant revoked access, and an old unshare replay leaves a deliberate new share intact. Verify current grants with `shares ARTIFACT_ID` after a replay.

## Retry and export

```sh
artifacts retry REQUEST_ID
artifacts export ARTIFACT_ID --revision REVISION_ID --out artifact.zip
```

`retry` loads the saved complete operation. It does not prepare a new edit or change expected versions. Keep the record after an uncertain result. The server checks current authority before replaying an original receipt.

`read --out` and `export --out` create files exclusively. Use a new destination if one already exists. Do not delete an existing output merely to rerun an example.

The archive contains `artifact.json`, `content.html`, `content.md`, or `content.txt`, and attachments under `files/`. Inspect the manifest's artifact and revision IDs, content, and required attachment bytes. Exporting the same retained revision through REST, MCP, or the panel must yield identical ZIP bytes.

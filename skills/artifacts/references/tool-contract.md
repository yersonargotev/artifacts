# Artifacts MCP contract

The connected tool schemas are authoritative. This reference reflects the current Artifacts snapshot contract.

## Snapshot

Create and update save a complete snapshot. Publication selects an existing revision. Unknown fields are rejected.

```json
{
  "metadata": {
    "title": "Example artifact",
    "description": "A retained document"
  },
  "content": {
    "kind": "html",
    "text": "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Example artifact</title><h1>Hello</h1></html>"
  },
  "files": [
    {
      "path": "notes.txt",
      "mediaType": "text/plain",
      "encoding": "utf8",
      "data": "Original attachment bytes."
    }
  ]
}
```

`metadata.title` is required and contains 1 to 256 characters. `metadata.description` is required and accepts up to 8192 characters. `metadata.custom` is optional JSON.

`content.kind` is `html`, `markdown`, or `text`. `content.text` is well-formed Unicode. `files` is required and accepts zero to 32 entries.

Every file requires `path`, `mediaType`, `encoding`, and `data`. Paths are unique NFC-normalized relative paths. Empty segments, traversal, backslashes, colons, percent signs, and control characters are rejected. A file path cannot be a parent of another file path. Media types use MIME syntax without parameters. `encoding` is `utf8` or `base64`. Binary data uses canonical padded base64.

The decoded total is at most 1,048,576 bytes. The total includes serialized metadata, UTF-8 content, UTF-8 paths and media types, and decoded attachment data.

## Tool inputs and results

The names below omit host-specific prefixes. Mutation `requestId` values contain 8 to 128 characters. A UUID is suitable.

| Tool | Input | Successful result |
| --- | --- | --- |
| `whoami` | `{}` | Verified account, central session, OAuth client, and scopes |
| `artifacts_create` | `requestId`, `snapshot`, optional `project` | Artifact with `artifactId`, `headRevisionId`, `project`, `publication`, and `revision` |
| `artifacts_read` | `artifactId`, optional `revisionId` | Artifact and selected complete revision |
| `artifacts_update` | `requestId`, `artifactId`, `expectedRevisionId`, `snapshot` | Artifact and new complete revision |
| `artifacts_publish` | `requestId`, `artifactId`, `revisionId`, `expectedPublicationVersion` | `artifactId`, `revisionId`, `version`, and `url` |
| `artifacts_list` | Optional `limit`, optional `cursor`, optional `project` | `items` and `nextCursor` |
| `artifacts_move` | `requestId`, `artifactId`, `project` name or null | `artifactId` and stored `project` |
| `projects_list` | `{}` | `items` with `name` and `artifactCount` |
| `artifacts_history` | `artifactId`, optional `limit`, optional `beforeSequence` | `items` and `nextBeforeSequence` |
| `artifacts_export` | `artifactId`, `revisionId` | `filename`, `mediaType`, `base64`, and `sha256` |
| `artifacts_share` | `requestId`, `artifactId`, `email` | Share with `shareId`, `artifactId`, `kind`, `value`, and `createdAt` |
| `artifacts_unshare` | `requestId`, `artifactId`, `shareId` | `artifactId` and `shareId` |
| `artifacts_shares_list` | `artifactId` | `items` with every share of the artifact |

`project` is the artifact's project name or null. Every list item also includes it. A project name contains 1 to 80 characters after trimming and NFC normalization, without control characters. Create and move reuse an existing project whose name matches regardless of letter case and return its stored spelling. Otherwise they create the project. The `artifacts_list` filter matches the same way. A move with `project: null` removes the artifact from its project. A move never creates a revision or changes the publication, and moving to the current project succeeds without change. `projects_list` returns only projects that contain artifacts, ordered by name without regard to letter case, without pagination.

`revision.id` identifies the saved revision. Other revision fields include `parentRevisionId`, `sequence`, `sha256`, and `snapshot`. `headRevisionId` identifies the draft head. `publication` is null or contains `revisionId`, `version`, and `url`.

Lists default to 25 items and allow at most 100 per page. History defaults to 5 revisions and allows at most 10 per page.

Create, update, and move require `artifacts:write`. Publication, share, unshare, and the share list require `artifacts:publish`. Reads, lists, projects, history, and export require `artifacts:read`. Ownership and live session checks apply to every operation.

Mutations return their original result for a retry with the same owner-scoped `requestId` and exact arguments. Reuse with different arguments fails. Stale expected revision or publication versions fail with `conflict`.

Export returns a ZIP, not a download URL. It contains `artifact.json`, a content document, and sorted `files/<path>` entries. Its SHA-256 covers the decoded archive bytes.

## Shares

A share lets one person view the published revision and its attachments. The person signs in with an account whose email is verified and equals the share `value`. `kind` is always `email`. `artifacts_share` trims `email` and stores it in lowercase as `value`. An invalid address, or one longer than 254 characters after trimming, fails input validation and writes nothing. Sharing an address that already has a share returns the existing share with its original `shareId` and `createdAt`. `createdAt` is an ISO 8601 timestamp.

`artifacts_unshare` removes the share with that `shareId` from that artifact. A new `requestId` for a share that is already removed fails with `not_found`. `artifacts_shares_list` returns `{ "items": [...] }` ordered by `value`, without pagination.

A non-owner gets `not_found` from all three tools, including a person the artifact is shared with. A token without `artifacts:publish` gets `forbidden` with `requiredScope: "artifacts:publish"`.

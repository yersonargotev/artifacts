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

`content.kind` is `html`, `markdown`, `text`, or `design`. `content.text` is well-formed Unicode. `files` is required and accepts zero to 32 entries.

Every file requires `path`, `mediaType`, `encoding`, and `data`. Paths are unique NFC-normalized relative paths. Empty segments, traversal, backslashes, colons, percent signs, and control characters are rejected. A file path cannot be a parent of another file path. Media types use MIME syntax without parameters. `encoding` is `utf8` or `base64`. Binary data uses canonical padded base64.

The decoded total is at most 1,048,576 bytes. The total includes serialized metadata, UTF-8 content, UTF-8 paths and media types, and decoded attachment data.

For `design`, `content.text` is a JSON canvas index with `v: 1`, `boards`, and `order`. Optional `pages` and `notes` group the boards and annotate the canvas. Each indexed board names a matching `text/html` file with `utf8` encoding. All boards share the same 32-file and 1 MiB revision limits. Read `artifacts-design/references/canvas.md` from the design skill for the complete index shape and authoring rules before creating a design. The tool receives the complete snapshot, not a directory path.

## Tool inputs and results

The names below omit host-specific prefixes. Mutation `requestId` values contain 8 to 128 characters. A UUID is suitable.

| Tool | Input | Successful result |
| --- | --- | --- |
| `whoami` | `{}` | Verified account, central session, OAuth client, and scopes |
| `artifacts_create` | `requestId`, `snapshot`, optional `project`, optional `slug` | Artifact with `artifactId`, `headRevisionId`, `project`, `slug`, `publication`, and `revision` |
| `artifacts_read` | Exactly one of `artifactId` or `slug` with optional `project`, optional `revisionId` | Artifact and selected complete revision |
| `artifacts_update` | `requestId`, `artifactId`, `expectedRevisionId`, `snapshot` | Artifact and new complete revision |
| `artifacts_publish` | `requestId`, `artifactId`, `revisionId`, `expectedPublicationVersion` | `artifactId`, `revisionId`, `version`, and `url` |
| `artifacts_list` | Optional `limit`, optional `cursor`, optional `project` | `items` and `nextCursor` |
| `artifacts_move` | `requestId`, `artifactId`, and at least one of `project` (name or null) and `slug` (slug or null) | `artifactId` and stored `project` |
| `artifacts_search` | `query`, optional `project`, optional `limit`, optional `cursor` | `items` with `artifactId`, `project`, `slug`, `title`, `snippet`, and `rank`, and `nextCursor` |
| `artifacts_batch` | `requestId`, 1 to 25 `operations` of `create`, `update`, or `move` | `results` with `index`, `artifactId`, and `revisionId` per operation |
| `projects_list` | `{}` | `items` with `name` and `artifactCount` |
| `artifacts_history` | `artifactId`, optional `limit`, optional `beforeSequence` | `items` and `nextBeforeSequence` |
| `artifacts_export` | `artifactId`, `revisionId` | `filename`, `mediaType`, `base64`, and `sha256` |
| `artifacts_share` | `requestId`, `artifactId`, `email` | Share with `shareId`, `artifactId`, `kind`, `value`, and `createdAt` |
| `artifacts_unshare` | `requestId`, `artifactId`, `shareId` | `artifactId` and `shareId` |
| `artifacts_shares_list` | `artifactId` | `items` with every share of the artifact |

`project` is the artifact's project name or null. Every list item also includes it. A project name contains 1 to 80 characters after trimming and NFC normalization, without control characters. Create and move reuse an existing project whose name matches regardless of letter case and return its stored spelling. Otherwise they create the project. The `artifacts_list` filter matches the same way. A move with `project: null` removes the artifact from its project. A move never creates a revision or changes the publication, and moving to the current project succeeds without change. `projects_list` returns only projects that contain artifacts, ordered by name without regard to letter case, without pagination.

`slug` is the artifact's page name within its project, or null. Every list item also includes it. A slug contains 1 to 160 characters of lowercase ASCII kebab-case segments separated by `/`, such as `concepts/rag` or `index`. It is never normalized, and a trailing `.md` is rejected with a hint to remove it. A slug is unique within the owner's project, matched by the project's stored spelling, and artifacts without a project share one unfiled namespace. Creating a used slug fails with `slug_conflict` and the `artifactId` that holds it. A move keeps the slug and fails with `slug_conflict` when the destination project already uses it. `artifacts_read` with `{ project, slug }` resolves only among the caller's owned artifacts; an omitted `project` reads the unfiled namespace, and a locator with no artifact fails with `not_found`. The slug lives outside the snapshot, so it never changes a digest, export, or publication, and viewers of a shared publication never see it.

`artifacts_search` searches the caller's owned artifacts at their head revision. Markdown and text match by title, description, and content. HTML matches by title, description, and visible text, without tags, attributes, scripts, or styles. A design matches by title and description only. The `query` is plain text of 1 to 256 characters. Every whitespace-separated term must match, letter case and accents are ignored, and operators or punctuation in the query are treated as text, so input such as `"foo" OR NEAR(` never fails with a syntax error. Attachments, older revisions, and artifacts shared with the caller are not searched. Optional `project` matches regardless of letter case. `limit` is 1 to 25 and defaults to 10. Items are `{ artifactId, project, slug, title, snippet, rank }`, ordered by `rank` and then `artifactId`. `rank` is the FTS5 `bm25` score, where lower is more relevant, and `snippet` is an excerpt with each match wrapped in `**`. Pass `nextCursor` as `cursor` for the next page; `null` means there are no more results. It requires `artifacts:read`.

`artifacts_batch` applies its operations as one all-or-nothing command. Each operation is `{ op: 'create', snapshot, project?, slug? }`, `{ op: 'update', snapshot, expectedRevisionId? }` addressed by exactly one of `artifactId` or `slug`, with `project` only alongside `slug`, or `{ op: 'move', project?, slug? }` addressed by exactly one of `artifactId` or `from: { project?, slug }`. A move takes the `move` fields: it needs `project`, `slug`, or both, an absent field keeps its value, and `null` clears it. A slug may name a page created earlier in the same batch, and later operations address a moved page by its new slug. `expectedRevisionId` must equal the head at that point in the batch, and it may be omitted only for a page that an earlier operation in the batch created or updated, whose revision ID the caller cannot know. Operations run in order, and the first failure commits nothing: its error, such as `conflict` with `currentRevisionId`, `slug_conflict`, or `not_found`, carries `index`, the 0-based position of the failing operation. Each snapshot keeps the 1 MiB and 32-file limits, and the whole batch has a 4 MiB ceiling of decoded content and metadata. The result is `{ results: [{ index, artifactId, revisionId }] }`, one entry per operation. A move creates no revision, so its `revisionId` is the head it left in place. The batch writes one receipt: the same `requestId` returns it, and a changed batch fails with `request_conflict`. Search reflects the batch when it commits. A batch never publishes.

`revision.id` identifies the saved revision. Other revision fields include `parentRevisionId`, `sequence`, `sha256`, and `snapshot`. `headRevisionId` identifies the draft head. `publication` is null or contains `revisionId`, `version`, and `url`.

Lists default to 25 items and allow at most 100 per page. History defaults to 5 revisions and allows at most 10 per page.

Create, update, move, and batch require `artifacts:write`. Publication, share, unshare, and the share list require `artifacts:publish`. Reads, lists, projects, history, and export require `artifacts:read`. Ownership and live session checks apply to every operation.

Mutations return their original result for a retry with the same owner-scoped `requestId` and exact arguments. Reuse with different arguments fails. Stale expected revision or publication versions fail with `conflict`.

Export returns a ZIP, not a download URL. It contains `artifact.json`, a content document (`content.json` for `design`), and sorted `files/<path>` entries. Its SHA-256 covers the decoded archive bytes.

## Shares

A share lets one person view the published revision and its attachments. The person signs in with an account whose email is verified and equals the share `value`. `kind` is always `email`. `artifacts_share` trims `email` and stores it in lowercase as `value`. An invalid address, or one longer than 254 characters after trimming, fails input validation and writes nothing. Sharing an address that already has a share returns the existing share with its original `shareId` and `createdAt`. `createdAt` is an ISO 8601 timestamp.

`artifacts_unshare` removes the share with that `shareId` from that artifact. A new `requestId` for a share that is already removed fails with `not_found`. `artifacts_shares_list` returns `{ "items": [...] }` ordered by `value`, without pagination.

A non-owner gets `not_found` from all three tools, including a person the artifact is shared with. A token without `artifacts:publish` gets `forbidden` with `requiredScope: "artifacts:publish"`.

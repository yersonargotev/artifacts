---
name: artifacts
description: Create, revise, publish, share, inspect, or export retained artifacts through the Artifacts MCP. Use for requests to save content in Artifacts, explain a topic with a visual HTML artifact, publish an artifact, or share it with a person by email. Exclude generic build artifacts and unrelated file creation.
---

# Create and manage Artifacts

Turn the user's content into a retained artifact through the connected MCP. Save a draft when the user asks to create or edit. Publish when the user requests publication or a shareable artifact URL. Published URLs require an Artifacts login by the owner or by a person the owner shared the artifact with.

## Select the connection

Use `artifacts-cloud` unless the user selects another Artifacts connection. Its MCP endpoint is `https://artifacts-mcp.yersonargotev.workers.dev/mcp`. The dashboard is `https://artifacts-panel.yersonargotev.workers.dev`.

Discover the tools exposed by that connection. Host prefixes vary. Match the underlying names in [the tool contract](references/tool-contract.md). Keep all calls for one operation on the same connection. Do not silently substitute the local `artifacts` server.

If tools or authentication are unavailable, report the missing connection or login. Do not simulate tool results or bypass MCP with database writes. Before the first mutation, call `whoami` if the connection's identity is not established in this session. Keep session identifiers out of the final reply.

## Prepare the snapshot

Read [the tool contract](references/tool-contract.md) before constructing tool arguments. A revision contains the complete `metadata`, `content`, and `files` snapshot.

Choose HTML for a visual or interactive artifact. Choose Markdown or text when those formats match the request. Markdown currently displays as inert text. If the user expects rendered Markdown, produce equivalent self-contained HTML and retain the Markdown as an attachment when useful.

Use the user's requested title, language, content, and files. Infer a descriptive title when none is given. Provide `description` and `files` even when they are empty. Do not include unrelated local files or credentials.

Keep HTML self-contained. Inline styles and scripts, and embed required assets as data URLs. External network requests, CDN libraries, relative executable assets, forms, persistent browser storage, and multi-file websites are unsupported. Attachments are downloads. They do not become resources the document can import. Compile a requested framework into self-contained HTML only if the result preserves the requested behavior and fits the limit.

Keep the full revision within 1 MiB of decoded content, metadata, file names, media types, and attachment bytes. Base64 expansion does not change the decoded limit. Use at most 32 attachments. If required content cannot fit, explain the limit without silently dropping content.

Interactive HTML follows the server's current Chrome compatibility policy. Other browsers may display escaped source. Do not promise interaction in every browser.

## Author HTML

Before writing or restyling HTML, load the `artifacts-design` skill and follow it. It owns typography, embedded fonts, color, layout, and the rendered checks. Finish its checks before saving. When browser verification is unavailable, inspect the source and disclose that visual behavior remains unverified.

## Create or revise

For a new artifact, call `artifacts_create` with a unique `requestId` and the complete snapshot. Use its returned `artifactId` and `revision.id` for subsequent calls.

For an existing artifact, resolve the exact artifact before a write. Use the supplied ID or an observed publication URL. Otherwise, use `artifacts_list` and its cursors to find the intended artifact. When the user names a project, pass it as the `project` filter. If several artifacts match, ask which one the user means.

Call `artifacts_read` without `revisionId` to obtain the current head. Apply the requested change to that complete snapshot. Preserve the metadata, content, and attachments the user did not ask to change. Call `artifacts_update` with the observed `headRevisionId` as `expectedRevisionId` and a new `requestId`.

An update creates a revision. It does not change the published revision. If the user asks to change the live artifact, publish the returned revision as part of that request.

## Organize projects

When the user names a project for new content, pass it as `project` to `artifacts_create`. Call `projects_list` first when an existing project may already fit. A name matching an existing project regardless of letter case joins it, so reuse the existing spelling in your reply. Do not invent a project the user did not ask for.

To file an existing artifact under a project, or to take it out of one, call `artifacts_move` with a new `requestId`, the `artifactId`, and the project name or `null`. A move changes only the artifact's project. It creates no revision and leaves the publication unchanged, so do not follow it with an update or publication. Verify the move with `artifacts_read` or `artifacts_list` and its `project` filter. A project disappears when its last artifact leaves it.

## Publish the selected revision

Read the artifact to obtain its current publication version. Call `artifacts_publish` with the intended `revisionId`, the observed `publication.version` as `expectedPublicationVersion`, and a new `requestId`. Use zero when `publication` is null.

Use the saved revision selected by the user or returned by this operation. Publishing a historical revision does not move the draft head. Return the URL from the successful publication result. Do not describe that URL as anonymous or public access.

## Share with a person

To let a specific person view an artifact, call `artifacts_share` with a new `requestId`, the `artifactId`, and the email address the user gave. Never guess an address from a name. The result contains the `shareId` and the stored `value`, which is the address trimmed and in lowercase. Sharing an address that already has a share returns the existing share.

The person opens the same publication URL and signs in with an Artifacts account whose email is verified and equals the shared address. They see the published revision and its attachments. They never see the history, export, draft head, project, or owner account. If the artifact is not published, they get a not-found page until it is. Publishing another revision keeps every share, so they see the new revision at the same URL.

Call `artifacts_shares_list` with the `artifactId` to report who has access. To revoke access, call `artifacts_unshare` with a new `requestId`, the `artifactId`, and the `shareId` from the list. The person loses access on their next request. The three tools require `artifacts:publish` and work only on the user's own artifacts.

## Handle retries and conflicts

Keep a mutation's `requestId` and exact arguments until its outcome is known. After an ambiguous transport failure, retry that exact call once. Never use a new ID to repeat an operation whose outcome is unknown. If the result remains unavailable, report the uncertainty.

For changed arguments or a different command, generate a new `requestId`. A `request_conflict` means the ID was already used with different arguments. Do not disguise that failure as a successful retry.

An `artifacts_unshare` that fails with `not_found` under a new `requestId` means the share is already gone. Confirm with `artifacts_shares_list` before you report it.

On an update or publication `conflict`, read the current state. Report the concurrent change and leave the failed command stopped. Do not overwrite another revision or replace the expected version just to force success.

For permission, validation, missing-artifact, or service errors, report the tool's outcome. Do not claim the operation completed.

## Verify and deliver

After a successful create or update, call `artifacts_read` with the returned `artifactId` and explicit saved `revisionId`. Compare the retained metadata, content, and file bytes with the intended snapshot. On update, verify the returned revision's parent matches the head you read.

After publication, read the artifact and verify `publication.revisionId`, `publication.version`, and `publication.url` match the successful publication result. If a concurrent publication changed the result, report that difference.

After a share or a revocation, call `artifacts_shares_list` and verify that the address is present or absent.

For history, follow `nextBeforeSequence` when the user needs older revisions. For export, call `artifacts_export` with an explicit retained `revisionId`. Decode its base64 ZIP to the requested destination. Verify its SHA-256 before linking the local file. If the host cannot save files, report the export limitation without inventing a download URL.

Report the title, saved revision, draft or published status, and any address you shared or revoked in the user's language. Include the returned publication URL when published, or the dashboard when saved as a draft. Link an exported file only after writing and verifying it. Distinguish successful persistence from any incomplete verification. Claim visual or browser checks only when you actually ran them.

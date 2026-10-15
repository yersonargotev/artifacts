---
name: artifacts
description: Create, revise, publish, inspect, or export retained artifacts through the Artifacts MCP. Use for requests to save content in Artifacts, explain a topic with a visual HTML artifact, or publish an artifact. Exclude generic build artifacts and unrelated file creation.
---

# Create and manage Artifacts

Turn the user's content into a retained artifact through the connected MCP. Save a draft when the user asks to create or edit. Publish when the user requests publication or a shareable artifact URL. Published URLs require the owner's Artifacts login.

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

For new layouts, restyling, or interaction changes, read [visual design](references/visual-design.md) and [interface guidelines](references/web-design-guidelines.md). For beginner explanations or requests for big pictures and few words, also read [visual explanations](references/visual-explanations.md).

Follow the user's visual direction and an existing artifact's established style. Choose the composition for the document's purpose. When a dark digital canvas suits an unspecified design, use [Catppuccin Mocha with Blue](references/catppuccin-mocha.md). These references style the artifact document; the surrounding application is separate.

Use the bundled guidance directly. Remote source links provide attribution, not a required fetch step. Apply the snapshot and sandbox constraints above when a general web guideline assumes unavailable capabilities.

Finish the relevant visual and interaction checks before saving. Fix observed failures and repeat the affected checks. When browser verification is unavailable, inspect the source and disclose that visual behavior remains unverified.

## Create or revise

For a new artifact, call `artifacts_create` with a unique `requestId` and the complete snapshot. Use its returned `artifactId` and `revision.id` for subsequent calls.

For an existing artifact, resolve the exact artifact before a write. Use the supplied ID or an observed publication URL. Otherwise, use `artifacts_list` and its cursors to find the intended artifact. If several artifacts match, ask which one the user means.

Call `artifacts_read` without `revisionId` to obtain the current head. Apply the requested change to that complete snapshot. Preserve the metadata, content, and attachments the user did not ask to change. Call `artifacts_update` with the observed `headRevisionId` as `expectedRevisionId` and a new `requestId`.

An update creates a revision. It does not change the published revision. If the user asks to change the live artifact, publish the returned revision as part of that request.

## Publish the selected revision

Read the artifact to obtain its current publication version. Call `artifacts_publish` with the intended `revisionId`, the observed `publication.version` as `expectedPublicationVersion`, and a new `requestId`. Use zero when `publication` is null.

Use the saved revision selected by the user or returned by this operation. Publishing a historical revision does not move the draft head. Return the URL from the successful publication result. Do not describe that URL as anonymous or public access.

## Handle retries and conflicts

Keep a mutation's `requestId` and exact arguments until its outcome is known. After an ambiguous transport failure, retry that exact call once. Never use a new ID to repeat an operation whose outcome is unknown. If the result remains unavailable, report the uncertainty.

For changed arguments or a different command, generate a new `requestId`. A `request_conflict` means the ID was already used with different arguments. Do not disguise that failure as a successful retry.

On an update or publication `conflict`, read the current state. Report the concurrent change and leave the failed command stopped. Do not overwrite another revision or replace the expected version just to force success.

For permission, validation, missing-artifact, or service errors, report the tool's outcome. Do not claim the operation completed.

## Verify and deliver

After a successful create or update, call `artifacts_read` with the returned `artifactId` and explicit saved `revisionId`. Compare the retained metadata, content, and file bytes with the intended snapshot. On update, verify the returned revision's parent matches the head you read.

After publication, read the artifact and verify `publication.revisionId`, `publication.version`, and `publication.url` match the successful publication result. If a concurrent publication changed the result, report that difference.

For history, follow `nextBeforeSequence` when the user needs older revisions. For export, call `artifacts_export` with an explicit retained `revisionId`. Decode its base64 ZIP to the requested destination. Verify its SHA-256 before linking the local file. If the host cannot save files, report the export limitation without inventing a download URL.

Report the title, saved revision, and draft or published status in the user's language. Include the returned publication URL when published, or the dashboard when saved as a draft. Link an exported file only after writing and verifying it. Distinguish successful persistence from any incomplete verification. Claim visual or browser checks only when you actually ran them.

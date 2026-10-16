---
name: artifacts-cli
description: Create, revise, inspect, publish, and export retained Artifacts through the artifacts CLI and REST API. Use when the user chooses the CLI or a terminal workflow for Artifacts. Exclude generic build artifacts and unrelated local files.
---

# Manage retained Artifacts with the CLI

Use the installed `artifacts` executable. Run `artifacts --help` and read [the command workflow](references/commands.md) before the first operation. If the executable is unavailable, report that prerequisite. Do not substitute database writes or invent CLI results.

## Select the account and resource

Use the resource selected by the user or the existing `ARTIFACTS_SERVER` environment value. Pass `--server RESOURCE` or set `ARTIFACTS_SERVER` for every command. Login does not set an implicit default. A resource is the canonical OAuth URL, such as `https://artifacts.example.test/mcp`. REST routes are below that resource at `/v1`. Do not infer a production connection from an example or silently switch to a local server.

Run `artifacts whoami` before the first mutation when the current identity is not established. Keep the selected resource and owner consistent throughout one operation. If login is needed, use `artifacts login --server RESOURCE`. The user authenticates in the browser. Do not collect their password or read another application's credentials. Never put tokens in command arguments, operation files, logs, or the final reply.

## Prepare retained content

A revision is a complete snapshot with `metadata`, `content`, and `files`. The command reference contains its JSON shape. Use the requested title, language, content, and attachments. Do not include unrelated files or credentials.

Use self-contained HTML for interactive content. Inline styles and scripts and embed required assets as data URLs. External requests, CDN dependencies, relative executable assets, forms, browser storage, and multi-file websites are unsupported. Attachments are downloads, not importable website resources. Markdown and text display inertly.

Keep the whole revision within 1 MiB of decoded content, metadata, attachment paths, media types, and attachment bytes. At most 32 attachments are accepted. Base64 changes wire size, not the decoded limit. If required content exceeds a limit, explain the constraint without silently removing it.

Finish requested visual and interaction checks before saving when browser tools are available. A successful CLI write proves persistence, not visual quality or browser compatibility. Interactive HTML follows the server's Chrome policy; do not promise it in every browser.

## Create or revise

Create a draft when the user asks to save new content. Use a complete snapshot file and retain the CLI's request ID and operation record until the result is verified.

Resolve an existing artifact by its supplied ID, an observed publication URL, or a paginated list. If several results match, ask which one the user means. Read its current full snapshot before editing. Preserve metadata, custom JSON, content fields, and attachments the user did not ask to change.

Use `edit` for partial changes that preserve omitted fields. Use `update` for a complete next snapshot with the observed `headRevisionId` as its expected revision. Changing the attachment list replaces that inventory; an empty list removes all attachments. An update creates a retained revision and does not change the published revision.

## Publish deliberately

Publish when the user requests publication, a shareable artifact URL, or a change to the live artifact. Use the exact saved revision selected by the user or returned by the edit. Read the current publication version before preparing publication. Use zero only when the artifact is unpublished.

A published URL still requires its owner's Artifacts login. Publishing a historical revision leaves the draft head unchanged. Report the returned protected URL only after the publication succeeds and its current state is verified.

## Recover an uncertain write

The CLI retains complete mutations before sending them. After a connection failure or uncertain result, use `retry` with that retained request ID once. Keep the same resource, owner, request ID, response mode, snapshot, and expected versions. Do not rerun a convenience edit or generate a new ID to repeat an operation whose outcome is unknown.

If the retry remains unavailable, report the uncertainty and retain the recovery record. A conflict stops the failed operation. Read the current state and report the concurrent change. Do not replace expected versions to force a write. A changed operation needs a deliberate new command and request ID.

A `request_conflict` means the ID was used with different arguments. Do not describe it as success. Authentication, validation, missing-artifact, and service failures likewise remain failures.

## Verify and deliver

After create or update, read the explicit returned revision. Use `read ARTIFACT_ID --revision REVISION_ID --out FILE --quiet` to retain the full response without printing its snapshot. Check that the installed `--help` supports `--quiet` first. For older versions, use the command workflow's stdout redirection fallback. Compare the saved complete metadata, content, and decoded attachment bytes with the intended snapshot. For an update, check that its parent is the head used for preparation. Compact responses cannot verify omitted content.

After publication, read current publication and compare revision, version, and URL with the committed result. A replayed receipt describes the original commit; another writer may have changed the current publication afterward. Report that difference.

Follow list and history cursors when the request needs more than the first page. Export an explicit retained revision to the requested destination. The CLI checks the archive digest. Confirm that the file exists and inspect its manifest and relevant content before linking it.

Report the title, saved revision, and draft or published state in the user's language. Link the actual export or returned protected publication URL. Distinguish persistence from any visual or browser checks that did not run. Keep local credential and session identifiers private.

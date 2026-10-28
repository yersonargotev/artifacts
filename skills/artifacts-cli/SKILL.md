---
name: artifacts-cli
description: Create, revise, inspect, publish, and export retained Artifacts through the artifacts CLI and REST API. Use when the user chooses the CLI or a terminal workflow for Artifacts. Exclude generic build artifacts and unrelated local files.
---

# Manage retained Artifacts with the CLI

Use the installed `artifacts` executable. Run `artifacts --help` and read [the command workflow](references/commands.md) before the first operation. With bundled skills support, `artifacts skills get artifacts-cli --full` returns this skill and its complete command reference. If the executable is unavailable, report that prerequisite. Do not substitute database writes or invent CLI results.

## Select the account and resource

Use the resource selected by the user or the existing `ARTIFACTS_SERVER` environment value. Pass `--server RESOURCE` or set `ARTIFACTS_SERVER` for service commands. Skills, help, and version commands work offline without a server or login. Login does not set an implicit default. A resource is the canonical OAuth URL, such as `https://artifacts.example.test/mcp`. REST routes are below that resource at `/v1`. Do not infer a production connection from an example or silently switch to a local server.

Run `artifacts whoami` before the first mutation when the current identity is not established. Keep the selected resource and owner consistent throughout one operation. If login is needed, use `artifacts login --server RESOURCE`. The user authenticates in the browser. Do not collect their password or read another application's credentials. Never put tokens in command arguments, operation files, logs, or the final reply.

## Prepare retained content

A revision is a complete snapshot with `metadata`, `content`, and `files`. The command reference contains its JSON shape. Use the requested title, language, content, and attachments. Do not include unrelated files or credentials.

Use self-contained HTML for interactive content. Inline styles and scripts and embed required assets as data URLs. External requests, CDN dependencies, relative executable assets, forms, browser storage, and multi-file websites are unsupported. Attachments are downloads, not importable website resources. Markdown and text display inertly.

Keep the whole revision within 1 MiB of decoded content, metadata, attachment paths, media types, and attachment bytes. At most 32 attachments are accepted. Base64 changes wire size, not the decoded limit. If required content exceeds a limit, explain the constraint without silently removing it.

Before writing or restyling HTML, run `artifacts skills get artifacts-design --full` and follow it. It owns typography, embedded fonts, color, layout, and the rendered checks. Finish those checks before saving when browser tools are available. A successful CLI write proves persistence, not visual quality or browser compatibility. Interactive HTML follows the server's Chrome policy; do not promise it in every browser.

## Create or revise

Create a draft when the user asks to save new content. Use a complete snapshot file and retain the CLI's request ID and operation record until the result is verified.

Resolve an existing artifact by its supplied ID, an observed publication URL, or a paginated list. If several results match, ask which one the user means. Read its current full snapshot before editing. Preserve metadata, custom JSON, content fields, and attachments the user did not ask to change.

Use `edit` for partial changes that preserve omitted fields. Use `update` for a complete next snapshot with the observed `headRevisionId` as its expected revision. Changing the attachment list replaces that inventory; an empty list removes all attachments. An update creates a retained revision and does not change the published revision.

## Organize projects

When the user names a project for new content, add `--project NAME` to `create`. Run `artifacts projects` first when an existing project may already fit. A name matching an existing project regardless of letter case joins it and keeps the stored spelling. Do not invent a project the user did not ask for. Use `list --project NAME` to find artifacts in a project.

Use `move ID --project NAME` to file an existing artifact under a project and `move ID --no-project` to remove it from one. A move changes only the project. It creates no revision and leaves the publication unchanged. It is a retained mutation, so recover an uncertain move with `retry`. Verify it with `read` or `list --project NAME`. A project disappears when its last artifact leaves it.

## Publish deliberately

Publish when the user requests publication, a shareable artifact URL, or a change to the live artifact. Use the exact saved revision selected by the user or returned by the edit. Read the current publication version before preparing publication. Use zero only when the artifact is unpublished.

A published URL requires sign-in by the owner or a user whose verified email matches a current share. Publishing a historical revision leaves the draft head unchanged. Report the returned protected URL only after the publication succeeds and its current state is verified.

## Share publication access

Check installed help for `share`, `shares`, and `unshare` support. These commands are available from `0.1.0-beta.6`. Share only when the user requests access for an exact email. Use `share ARTIFACT_ID --email EMAIL`, then verify the normalized email with `shares ARTIFACT_ID`. Use the observed `shareId` with `unshare ARTIFACT_ID SHARE_ID` to revoke it. Unshare and its successful retry exit zero with empty stdout.

A matching signed-in user must have a verified email. Access covers the published revision and its attachments. History, export, editing, and project moves stay owner-only. A share before first publication remains stored and waits for publication. Add `--notify` when the user asks for an invitation email. Invited people can sign in with an email code when the server enables email.

Recover uncertain share or unshare results with `retry REQUEST_ID`. Replay confirms the original operation and does not establish current grants. An old share replay does not restore revoked access. An old unshare replay does not remove a deliberate new share. Verify current grants with `shares ARTIFACT_ID`.

When the user asks to notify an invited person, add `--notify` to `artifacts share`. Preserve that flag in the retained command and use `artifacts retry` after an uncertain response. Report `requested` as an invitation request, never as confirmed delivery. A skipped notification still grants access. A new deliberate share command can request another attempt for existing access, subject to the owner's daily allowance.

## Recover an uncertain write

The CLI retains complete mutations before sending them. After a connection failure or uncertain result, use `retry` with that retained request ID once. Keep the same resource, owner, request ID, response mode, snapshot, and expected versions. Do not rerun a convenience edit or generate a new ID to repeat an operation whose outcome is unknown.

If the retry remains unavailable, report the uncertainty and retain the recovery record. A conflict stops the failed operation. Read the current state and report the concurrent change. Do not replace expected versions to force a write. A changed operation needs a deliberate new command and request ID.

A `request_conflict` means the ID was used with different arguments. Do not describe it as success. Authentication, validation, missing-artifact, and service failures likewise remain failures.

## Verify and deliver

After create or update, read the explicit returned revision. Use `read ARTIFACT_ID --revision REVISION_ID --out FILE --quiet` to retain the full response without printing its snapshot. Check that the installed `--help` supports `--quiet` first. For older versions, use the command workflow's stdout redirection fallback. Compare the saved complete metadata, content, and decoded attachment bytes with the intended snapshot. For an update, check that its parent is the head used for preparation. Compact responses cannot verify omitted content.

After publication, read current publication and compare revision, version, and URL with the committed result. A replayed receipt describes the original commit; another writer may have changed the current publication afterward. Report that difference.

Follow list and history cursors when the request needs more than the first page. Export an explicit retained revision to the requested destination. The CLI checks the archive digest. Confirm that the file exists and inspect its manifest and relevant content before linking it.

Report the title, saved revision, and draft or published state in the user's language. Link the actual export or returned protected publication URL. Distinguish persistence from any visual or browser checks that did not run. Keep local credential and session identifiers private.

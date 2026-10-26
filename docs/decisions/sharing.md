# Email shares for published artifacts

## Problem and decision

An owner needs to let one specific person view a published artifact without handing over the owner's account. The owner shares the artifact with an exact email address. An `artifact_share` row records that grant. The invited person signs in with that verified address and opens the existing publication URL. Revoking the share deletes the row, so the next request is denied.

Signed public links were rejected because a forwarded link leaks and cannot be revoked per person. Domain shares were deferred to the enterprise plan, as the last section explains.

## Matching rules

An email share matches when the viewer's email is verified and equals the share value. `share` trims the address, lowercases it, and requires a valid address of at most 254 characters before it stores anything. Every stored value is lowercase, so a match compares the viewer's lowercased email with the stored value.

## What a viewer sees

A viewer sees the published revision and its attachments, and nothing else. History, export, editing, project moves, and the owner's account details stay owner-only.

`readPublished` returns a `SharedRead` to a viewer who is not the owner. It contains the artifact ID, the publication (revision ID, version, and URL), and the published revision's ID, creation time, SHA-256, and snapshot. The store builds it from an allow-list, so a field added to `ArtifactRead` later does not reach viewers by default. It leaves out these fields:

- `ownerId` and the revision's `authorUserId`, which both identify the owner's account.
- `headRevisionId`, which would reveal unpublished work.
- `project`, the owner's library folder. The owner's page links to it; a viewer's page has no project link.
- The revision's `parentRevisionId` and `sequence`, which describe the history.
- The revision's `authorClientId`, the OAuth client the owner wrote with. A CLI or MCP registration ID is stable across the owner's artifacts, so it works as a pseudonym for the owner.

The snapshot stays whole, including `metadata.custom`, because it is what the owner published. The publication version stays because it tells the owner and the viewer which publication they are discussing.

The owner keeps receiving the full `ArtifactRead`, unchanged in content and key order. The publication page renders the project link, the `Revisión N` label, and the `Cliente autor` row only for that shape.

## Viewer authorization

`canView(connection, userId, artifactId)` returns the artifact row when the user owns the artifact, or when the user's email is verified and equals an email share of that artifact. It returns nothing otherwise, including for a missing artifact. One query does both checks: the owner comparison, or a correlated `EXISTS` that reads the user by primary key and the share through `artifact_share_value_idx` on all three columns. The owner branch does not read `email_verified`, so an owner with an unverified email keeps access, and an owner who shares with their own address still gets the owner shape.

Verified means that the viewer's `user` row has `email_verified = 1` when the request runs. The comparison uses `lower(user.email)`. Better Auth already stores emails in lowercase and this deployment disables email changes, so the lowercase call only matters for rows written outside Better Auth. SQLite's `lower()` folds ASCII only. Share values pass zod's ASCII-only email check, so an account email with other letters never matches a share. Users cannot set `email_verified` themselves. Sign-up writes false, `/update-user` ignores the field, and no verification sender is configured, so S6 (email-code sign-in) is the first production path that sets it.

The three publication methods call `canView` inside their own transaction on every call:

- `issuePublicationGrant` returns `not_found` when `canView` fails or the artifact has no publication.
- `consumePublicationGrant` returns `invalid_grant` when `canView` fails for the grant's user. A pending grant issued before a revocation therefore cannot become a viewer.
- `readPublished` checks the live session first, then `canView`, then the publication and the pinned revision. A failure returns `forbidden` for a dead session and `not_found` otherwise.

No cookie, grant, viewer, or cache holds an email, a verification state, or an access decision. A revocation, an unverified email, or a deletion therefore denies the next request.

A denied user sees one of two fixed results. A fresh open goes through the panel's `/publication/open`, which answers `404` with `No se puede abrir este artefacto.` A request that still carries a viewer cookie gets `403` from the publication Worker with `Tu sesión o esta publicación ya no están disponibles.`, and the Worker clears that artifact's viewer cookie. Error messages never reach the browser.

The publication Worker parses the read response as either the owner shape or the shared shape, each strictly. It still compares `ownerId` with the viewer's user ID when the response has the owner shape. That check costs nothing and turns a store bug that sends the owner shape to a viewer into a `503` instead of a page with the owner's project.

## Managing shares

Only the owner manages shares, under the `artifacts:publish` scope. `share`, `unshare`, and `listShares` check the scope and the live session first, then ownership. A non-owner gets `not_found`, as with every other owner-only command, so the response does not reveal that another owner's artifact exists.

`share` and `unshare` commit an owner-scoped `requestId` receipt in the same transaction as the write, like the other mutations. The receipt hashes the normalized input. A retry that sends `Ana@Example.com` under the same request ID as `ana@example.com` replays the same receipt.

Sharing an address that already has a share returns the existing share with its original ID and creation time. The unique index on `(artifact_id, kind, value)` turns a concurrent duplicate insert into a no-op. `unshare` takes the artifact ID and the share ID. It returns `not_found` when that artifact has no share with that ID, unless its request ID replays an earlier `unshare`. `listShares` is a read, so it takes no request ID. It returns the artifact's shares ordered by kind and value.

MCP exposes the three methods as `artifacts_share`, `artifacts_unshare`, and `artifacts_shares_list`. Each tool returns the store result as structured content and reports a store error as `{ error, message, ...details }`, like the other tools. A token without `artifacts:publish` therefore gets `forbidden` with `requiredScope: "artifacts:publish"`. The HTTP `insufficient_scope` challenge applies only to the identity scope that every MCP request needs. `artifacts_unshare` sets `destructiveHint: true` because it removes a person's access, so a host can ask the user before it runs.

## Lifecycle

No unpublish operation exists. A share on an artifact that the owner never published is kept, and its viewers get 404 until the owner publishes it. Publishing a new revision keeps every share, and the viewer sees the new revision at the same URL.

While the artifact exists, a share receipt keeps the address even after `unshare`. The receipt keeps its original result and the hash of its input, so a retry gets the original answer.

Deleting an artifact deletes its shares through the foreign-key cascade. In the same transaction, the delete command rewrites every receipt whose result names the artifact. It replaces the result with a deletion marker and clears the payload hash. After the delete commits, no share row or receipt row for that artifact holds the address or a hash of it. A later request under one of those request IDs gets `not_found` with any arguments, because the store can no longer compare them. The delete command's own receipt is the exception. The delete writes it after the rewrite, so it keeps its hash and its `{ artifactId }` result. An exact delete retry replays success, and a delete retry with changed arguments gets `request_conflict`. This covers the logical rows only. SQLite can keep the deleted bytes in free pages and in the write-ahead log until it overwrites them.

## Domain shares are an enterprise feature

A verified address at a domain proves control of one mailbox, not membership in a company. Domain shares therefore wait for organizations that verify their domains. When they arrive, these rules hold:

- The organization proves control of the domain with a DNS TXT record.
- Free-mail domains never match.
- A domain matches exactly. Subdomains do not match.
- `domain` becomes a second value of `artifact_share.kind`. Email shares do not change.

`kind` is a Drizzle enum on a text column, not a SQL check constraint. Adding `domain` changes the TypeScript type and needs no table rebuild. Existing email rows and their unique index stay valid.

## Schema and rollout

Migration `0003` creates `artifact_share` with two indexes and changes no existing rows. The unique `artifact_share_value_idx` on `(artifact_id, kind, value)` serves the owner's list and the check for one artifact. `artifact_share_recipient_idx` on `(kind, value)` serves the lookup of every artifact shared with one address. `created_by` records who created the share.

The share schemas, `sharedReadSchema`, and the `Share` and `SharedRead` types live in `@yargote/artifacts-contracts` with the other domain schemas, next to `artifactReadSchema` and `viewerSchema`. They are additive exports.

The panel deploys before the publication Worker, and the Worker parses the panel's internal read strictly. The owner's response did not change, so owners see no error while the two deploys run. Only the new Worker accepts the shared shape, and guests cannot sign in before S6, so no viewer reaches the old Worker. A later field added to the shared shape, such as an owner name, must ship to the Worker first or in two steps, because the old Worker rejects any unknown key with a `503`.

Every store call runs in a write transaction, because the libSQL driver opens `BEGIN IMMEDIATE`. Each viewer's document, content, and file request therefore waits for concurrent writers, as the owner's requests already did. Viewers multiply those reads. A read-mode transaction for `readPublished` is the fix if contention appears.

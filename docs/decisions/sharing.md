# Email shares for published artifacts

## Problem and decision

An owner needs to let one specific person view a published artifact without handing over the owner's account. The owner shares the artifact with an exact email address. An `artifact_share` row records that grant. The invited person signs in with that verified address and opens the existing publication URL. Revoking the share deletes the row, so the next request is denied.

Signed public links were rejected because a forwarded link leaks and cannot be revoked per person. Domain shares were deferred to the enterprise plan, as the last section explains.

## Matching rules

An email share matches when the viewer's email is verified and equals the share value. `share` trims the address, lowercases it, and requires a valid address of at most 254 characters before it stores anything. Every stored value is lowercase, so a match compares the viewer's lowercased email with the stored value.

## What a viewer sees

A viewer sees the published revision and its attachments, and nothing else. History, export, editing, project moves, and the owner's account details stay owner-only.

## Managing shares

Only the owner manages shares, under the `artifacts:publish` scope. `share`, `unshare`, and `listShares` check the scope and the live session first, then ownership. A non-owner gets `not_found`, as with every other owner-only command, so the response does not reveal that another owner's artifact exists.

`share` and `unshare` commit an owner-scoped `requestId` receipt in the same transaction as the write, like the other mutations. The receipt hashes the normalized input. A retry that sends `Ana@Example.com` under the same request ID as `ana@example.com` replays the same receipt.

Sharing an address that already has a share returns the existing share with its original ID and creation time. The unique index on `(artifact_id, kind, value)` turns a concurrent duplicate insert into a no-op. `unshare` takes the artifact ID and the share ID. It returns `not_found` when that artifact has no share with that ID, unless its request ID replays an earlier `unshare`. `listShares` is a read, so it takes no request ID. It returns the artifact's shares ordered by kind and value.

## Lifecycle

No unpublish operation exists. A share on an artifact that the owner never published is kept, and its viewers get 404 until the owner publishes it. Once viewer authorization lands (S2), a share lets a viewer read the published revision. At this head, shares affect no read. Publishing a new revision keeps every share.

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

The share schemas and the `Share` type live in `@yargote/artifacts-contracts` with the other domain schemas, so the REST adapter and the typed client can use them. They are additive exports.

The migration and the store methods ship first. Until the authorization change lands, the publication read path still admits only the owner, and a share row has no effect on any read.

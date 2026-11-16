# State machines

This file lists every entity in Artifacts that moves between states. For each one it gives the states, the invariants that must hold, and a transition table that points at the code. The last section lists the invalid states and transitions that the code could reach, with their evidence and status.

Most of these machines are implicit. Their state is a set of rows, columns, cookies, or files, and the transitions are spread across the store, the Workers, and the CLI. When you change a transition, update its table here and the finding it affects.

Two serialization facts hold across the store:

- libSQL opens every interactive transaction with `BEGIN IMMEDIATE`. The store's `transaction` helper therefore serializes all of its writers, and it retries `SQLITE_BUSY` up to five times (`packages/artifacts/src/access.ts`).
- The store's reads (`read`), the batch command's planning reads, and every query outside `transaction` see no snapshot shared with a later write. A guard in the write must recheck anything they decided.

## Artifact

An artifact row owns an immutable revision chain, one head pointer, one optional publication pointer, and one location. These are four machines that share a row. They change independently.

### Revision chain and head

States: `Absent`, `Live(head = rₙ)`, `Deleted`.

Invariants:

- Revisions are immutable. A trigger rejects every `UPDATE` on `artifact_revision` (migration `0001`).
- Sequences are dense per artifact: 1, 2, …, n. The `artifact_revision_sequence_idx` unique index rejects a second revision with the same sequence.
- The head and the parent of each revision belong to the same artifact (composite foreign keys `artifact_head_membership_fk` and `artifact_parent_membership_fk`, deferred).
- The head is the revision with the highest sequence. Only create, update, and batch write revisions, and each one moves the head in the same commit.
- The search row mirrors the head snapshot. A trigger deletes it with the artifact (migration `0006`).

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| Absent | `create` | live session, `artifacts:write`, slug free | `Live(r₁)` | `index.ts` `create` |
| `Live(rₙ)` | `update` | `expectedRevisionId = rₙ` | `Live(rₙ₊₁)` | `index.ts` `update` |
| `Live(rₙ)` | `update` | `expectedRevisionId ≠ rₙ` | unchanged, `conflict` with `currentRevisionId` | `index.ts` `update` |
| `Live(rₙ)` | batch `update` | plan matches head; sequence index, head guard | `Live(rₙ₊₁)` | `batch.ts`, `index.ts` `batch` |
| `Live` | `delete` | expected head and publication version match | `Deleted` (cascade: revisions, publication, shares, grants, search) | `index.ts` `delete` |
| `Deleted` | any command naming it | — | `not_found` | `index.ts` `owned` |

### Publication

States: `Unpublished` (no row, version 0), `Published(r, v)`. The panel derives `current` when `r` is the head and `pending` when it is not (`panel/model.ts` `isPending`). There is no unpublish.

Invariants: `r` belongs to the artifact (`artifact_publication_membership_fk`). Each change of `r` increments `v` by one.

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| `Unpublished` | `publish(r, expected 0)` | `r` belongs to the artifact | `Published(r, 1)` | `index.ts` `publish` |
| `Published(r, v)` | `publish(r', expected v)` | `r' ≠ r` | `Published(r', v + 1)` | `index.ts` `publish` |
| `Published(r, v)` | `publish(r, expected v)` | — | unchanged, success | `index.ts` `publish` |
| any | `publish(…, expected ≠ v)` | — | unchanged, `conflict` with `currentPublicationVersion` | `index.ts` `publish` |

### Location

States: `(project | null, slug | null)`.

Invariants:

- A slug is unique per owner and exact project spelling (`artifact_owner_project_slug_idx` over `coalesce(project, '')`).
- A project exists while one artifact carries it. Commands reuse the stored spelling of a project whose lowercase key matches (`projectSpelling`).

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| `(p, s)` | `move(p', s')` | `s'` free in `p'` | `(p', s')` | `index.ts` `move` |
| `(p, s)` | batch `move` | `moved` and `spelled` guards hold | `(p', s')` | `index.ts` `batch` |
| `(p, s)` | panel move to `p'` | no moved slug taken in `p'`, none shared within the selection | `(p', s)` | `panel/index.ts` `move` |
| any | move to the current location | — | unchanged, success | all three |

## Command receipt

One row per `(owner, requestId)` in `artifact_command`. Every mutation writes its receipt in the same commit as its effect. A command that throws commits no receipt, so its request ID stays usable.

States: `None`, `Stored(hash, result)`, `Tombstoned` (result is `{ kind: 'artifact_deleted' }`, hash empty).

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| `None` | command commits | authority holds | `Stored` | `access.ts` `receipt` |
| `Stored` | same request ID, same hash | authority holds now | unchanged, original result | `access.ts` `replay` |
| `Stored` | same request ID, other hash | — | unchanged, `request_conflict` | `access.ts` `replay` |
| `Stored` | the artifact its result names is deleted | not the delete's own receipt | `Tombstoned` | `index.ts` `delete` |
| `Tombstoned` | any request under that ID | — | `not_found` | `access.ts` `replay` |

A panel move receipt names no top-level `artifactId`, so a delete keeps it (`docs/decisions/projects.md`).

## Batch attempt

`store.batch` reads outside a transaction, plans in memory, and sends every write as one `db.$client.batch(…, 'write')`. Each guard turns a stale read into a constraint failure. The TLA+ model in `.agents/skills/verify-batch-concurrency` checks this machine.

| From | Event | Guard | To |
| --- | --- | --- | --- |
| `Reading` | receipt exists | hash matches | `Replayed` |
| `Reading` | plan succeeds | — | `Writing` |
| `Reading` | plan fails | — | `Failed` (domain error) |
| `Writing` | commit | — | `Committed` |
| `Writing` | constraint failure | at most 2 retries so far | `Reading` |
| `Writing` | `SQLITE_BUSY` | at most 5 retries so far | `Reading` after backoff |
| `Writing` | anything else, or retries exhausted | — | `Failed` (REST maps it to 503) |

## Share and invitation

A share is an `artifact_share` row: `Absent`, `Active`, `Removed`. Removing a share keeps the share receipt and its result (`docs/decisions/sharing.md`).

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| `Absent` | `share` | under 100 per artifact and 1000 per owner | `Active` | `index.ts` `share` |
| `Active` | `share` | `requireNew` | unchanged, `conflict` (`share_exists`) | `index.ts` `share` |
| `Active` | `share` | not `requireNew` | unchanged, success | `index.ts` `share` |
| `Active` | `unshare` | — | `Removed` | `index.ts` `unshare` |
| `Removed` | `unshare` with a new request ID | — | `not_found`; the panel reports it as confirmed because it read the artifact first | `index.ts` `unshare`, `share.ts` `submitShare` |

The notification has its own outcome: `skipped(disabled)`, `skipped(rate_limited)`, or `requested`. The day budget resets when `date('now')` differs from the stored day, and it is read and written in the share's transaction. The email is sent after the commit and only on a fresh receipt. A lost send stays `requested`, and an exact retry does not resend it.

## Panel login transaction

An `oidc_transaction` row, bound to the browser by an `artifacts-login-<state prefix>` cookie, which holds a random token whose hash is the row key. Each login has its own cookie, so concurrent tabs keep separate transactions.

States: `Pending`, `Expired` (row present, past `expiresAt`), `Consumed` (row deleted).

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| — | `GET /auth/login` | none | `Pending` (600 s) with its own cookie | `apps/dashboard/src/identity.ts` `startLogin` |
| `Pending` | `GET /auth/callback` | the `state` cookie's token and the `state` match the row, not expired, code valid | `Consumed`, panel session created | `identity.ts` `completeLogin` |
| `Pending` | another tab's callback | `state` differs | stays `Pending` | `identity.ts` `completeLogin` |
| `Pending` | 600 s pass | — | `Expired`; the next `GET /auth/login` deletes the row | `identity.ts` `startLogin` |
| any | callback | — | the callback `state`'s cookie deleted | `apps/dashboard/src/pages/auth/callback.ts` |

## Panel session

A `panel_session` row: `Live`, `Expired`, `Orphaned` (the central session expired or admission was revoked, row present), `Deleted`. Every page load joins the central session and rechecks admission, so `Expired` and `Orphaned` rows deny access.

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| — | callback | central session live, subject matches, admitted (one transaction) | `Live` | `identity.ts` `completeLogin` |
| `Live` | page load | join and admission hold | `Live`; otherwise the cookie is dropped | `identity.ts` `load`, `middleware.ts` |
| `Live` | panel logout | — | `Deleted`; the central session stays | `identity.ts` `logout` |
| `Live` | revoke-all or central sign-out | — | `Deleted` by cascade | `apps/auth/src/revocation.ts` |
| `Live` | the guest's last share is removed | — | `Orphaned` | `packages/db/src/admission.ts` |

## Central session and OAuth tokens

Better Auth owns these rows. The app adds admission checks on sign-in, refresh, and every resource request.

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| — | password or email-code sign-in | admitted; verified for email code | session | `apps/auth/src/auth-core.ts`, `email-code.ts` |
| session | revoke-all | Origin check, live session | sessions deleted, then token cleanup | `apps/auth/src/http-core.ts`, `revocation.ts` |
| refresh token | refresh | admitted | new access token | `auth-core.ts` |
| access token | MCP or REST request | JWT valid, introspection active, admitted | principal | `packages/rest/src/identity.ts` |
| one-time code | redeem | consumed atomically by Better Auth | session | `email-code.ts` |

## Publication handoff

The publication Worker admits a viewer through three stages: a transaction cookie, a one-use grant row, and a viewer cookie.

States: `NoCookie`, `Transaction(artifact, state)` (encrypted cookie named by a state prefix, one per open, 600 s), `Grant` (`publication_grant` row, at most 60 s, one use; once expired, the next `issuePublicationGrant` deletes it), `Viewer(artifact)` (encrypted cookie per artifact, at most 1 h and never past the central session).

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| `NoCookie` | `GET /a/:id` without a viewer | — | a new `Transaction` beside any earlier one | `apps/publication/src/http.ts` `begin` |
| `Transaction` | panel `/publication/open` | panel identity, `canView`, published | `Grant` | `index.ts` `issuePublicationGrant` |
| `Grant` | `/callback` | the `state` cookie's state and artifact match, not expired | grant deleted, `Viewer` set, that transaction cookie cleared | `http.ts`, `index.ts` `consumePublicationGrant` |
| `Transaction` | `/callback` that fails | — | only the callback `state`'s cookie cleared | `http.ts` |
| `Viewer` | read | live session, admitted, `canView`, published | page | `index.ts` `readPublished` |
| `Viewer` | content or file request for a revision that is no longer published | — | `Viewer`; answers 404 | `http.ts` |
| `Viewer` | backend answers 401, 403, 404, or 409 to the current-publication read | — | viewer cookie cleared | `http.ts` |

## CLI credential profile

The CLI keeps one profile per resource: `{ epoch, registration, tokens, refreshAttempt }`. Every transition runs under `CredentialStore.exclusive`, a `BEGIN IMMEDIATE` on a lock database, so concurrent CLI processes serialize.

States: `SignedOut`, `Valid`, `Expired`, `RefreshUncertain` (`refreshAttempt` set), `LoginPending` (epoch bumped).

Invariants: once `refreshAttempt` is set, no token is used or refreshed until the next login. A login commits only while its epoch is current.

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| any | login starts | — | `LoginPending` (epoch + 1) | `apps/cli/src/auth.ts` |
| `LoginPending` | callback and code grant | epoch unchanged | `Valid` | `auth.ts`, `credentials.ts` |
| `LoginPending` | another login or logout | epoch changed | aborted | `auth.ts` |
| `Expired` | token needed | refresh token present | `RefreshUncertain`, then `Valid` | `auth.ts` |
| `RefreshUncertain` | refresh fails or the process dies | — | stays; login required | `auth.ts` |
| any | logout | — | `SignedOut` (epoch + 1, revocation attempted) | `auth.ts` |

## CLI retained operation

A file keyed by `sha256(resource, requestId)`, written with `O_EXCL` and `fsync` before the request is sent. States: `Absent`, `Retained`. The HTTP client never retries on its own. `artifacts retry ID` resends the retained bytes, so a retry always carries the same request ID and payload.

| From | Event | Guard | To | Code |
| --- | --- | --- | --- | --- |
| `Absent` | a mutating command | identity resolved | `Retained`, then sent | `apps/cli/src/operations.ts`, `index.ts` |
| `Retained` | a new command with the same request ID | — | rejected locally | `operations.ts` |
| `Retained` | `artifacts retry ID` | same resource and owner | resent unchanged | `index.ts` |

## Panel mutation forms

Every panel mutation is a server-rendered POST followed by a redirect, so the panel holds no optimistic state. Each form carries a request ID minted when the form renders, and its uncertain page resubmits the same command.

| Form | Request ID minted | Outcomes |
| --- | --- | --- |
| Publish | at render | published, conflict (409, observed state), uncertain (503) |
| Delete | at the confirmation page | redirect, conflict (409), uncertain (503) |
| Move dialog and page | when it opens | moved, partial, invalid, conflict, slug conflict (form kept), uncertain |
| Selection bar removal | on each submit | as move |
| Share dialog | per loaded view | confirmed, invalid, conflict, share limit, uncertain, denied |

The share dialog moves `Loading → Ready → Submitting → Ready | Uncertain | Denied`. `Uncertain` disables the inputs and allows only a retry of the same command. A generation counter discards a load that lands while a submit is in flight. Removing a share that another tab already removed confirms and reloads the list. `Denied` comes only from an artifact the owner cannot read.

## Findings

Ranked by impact. Each confirmed finding has a runtime repro.

| # | Finding | Impact | Status |
| --- | --- | --- | --- |
| 1 | The publication transaction cookie is one per browser. A second publication tab overwrites it, and a failed callback clears whichever transaction is current. | A guest who opens two shared links, or clicks one twice, gets "El enlace de acceso ha vencido" in both tabs. | Fixed in [#194](https://github.com/yersonargotev/artifacts/pull/194) |
| 2 | The panel login transaction is one per browser, and `completeLogin` deletes the row before it checks `state`. A callback from the other tab consumes the current transaction. | Two panel tabs signing in both land on `/?login=failed` after a correct sign-in. | Fixed in [#194](https://github.com/yersonargotev/artifacts/pull/194) |
| 3 | A stale revision URL makes `readPublished` answer `not_found`. The Worker treats it as a revocation and clears a valid viewer cookie. | After a republish, an open page or an old attachment link logs the viewer out of the artifact. | Fixed in [#193](https://github.com/yersonargotev/artifacts/pull/193) |
| 4 | The publication transaction lasts 300 s while the panel login lasts 600 s and an email code 5 min. | A first-time guest who waits for the code signs in and still gets "El enlace de acceso ha vencido". | Fixed in [#194](https://github.com/yersonargotev/artifacts/pull/194) |
| 5 | Expired `oidc_transaction` rows and unconsumed `publication_grant` rows are never deleted, and anonymous `GET /auth/login` creates the former. | Unbounded table growth from an unthrottled endpoint. | Fixed in [#192](https://github.com/yersonargotev/artifacts/pull/192) |
| 6 | A second "Quitar" on a share another tab already removed returns `not_found`. The share dialog maps it to `denied`. | The owner sees "No se puede abrir este artefacto." for an artifact that is fine. | Fixed in [#191](https://github.com/yersonargotev/artifacts/pull/191) |
| 7 | Removing a guest's last share leaves their sessions and refresh tokens inert. Sharing again revives them. | None while unadmitted. A design question. | Suspected |
| 8 | The selection bar mints a request ID per submit, so a double click sends two commands. | An extra receipt. The command is absolute, so nothing changes twice. | Suspected, harmless |
| 9 | A batch that exhausts its constraint retries throws a raw constraint error, which REST reports as 503 and Sentry. | Noise under heavy contention. A retry with the same request ID is safe. | Suspected |

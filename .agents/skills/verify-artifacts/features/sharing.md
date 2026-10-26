# Shared publication viewers

An owner shares a published artifact with an exact email address through the MCP tool `artifacts_share`. A signed-in guest whose account email is verified and matches the share opens the owner's publication URL and sees the published revision and its attachments. The guest page omits the owner's project, the author client, and the revision sequence. Revoking the share with `artifacts_unshare` denies the guest's next request.

## Sub-features

- `sharing-denied` sends a guest without a share to the panel's `404` page on a fresh open.
- `sharing-admitted` admits a verified guest whose email matches a share in any letter case.
- `sharing-projection` hides owner-only details from the guest while the owner's page keeps them.
- `sharing-owner-only` returns `not_found` to the guest's MCP `artifacts_read`, `artifacts_history`, and `artifacts_export`.
- `sharing-revoked` returns `403` on the guest's next request after revocation and clears the viewer cookie.
- `sharing-mcp` stores a mixed-case address in lowercase, replays a retried `artifacts_share`, and lists and removes the share through `artifacts_shares_list` and `artifacts_unshare`.

## How to get to it (user POV)

- The owner publishes an artifact and shares it by calling the MCP tool `artifacts_share` with the guest's email. MCP is the only entry point that manages shares. REST, the CLI, and the panel have no share entry point.
- The guest opens the owner's publication URL and signs in with `Correo electrónico` and `Contraseña`.
- The guest page shows the frame titled `Contenido del artefacto` and the title menu with `Información` and `Archivos`. It shows no `Volver al proyecto` link, no `Revisión N` label, and no `Cliente autor` row.

## Denial results

Each denial has a fixed result. Expect exactly these:

- A fresh open (no viewer cookie) by a user without a matching verified share, or of an artifact that was never published or was deleted, ends on the panel origin at `/publication/open` with status `404` and the body `No se puede abrir este artefacto.`
- A request that carries a viewer cookie after the share is revoked, the email is unverified, or the artifact is deleted returns status `403` on the publication origin with the body `Tu sesión o esta publicación ya no están disponibles.` and `Set-Cookie` clearing that artifact's viewer cookie with `Max-Age=0`. This applies to the document, `/content`, and `/files/...` routes.
- The local Node publication server sends that `403` body without a `charset`, so Chrome renders the accents incorrectly. The bytes are UTF-8. Owners see the same behavior at trunk.

## Driving it with control.ts (Playwright + HTTP MCP)

Preconditions:

- `.test-artifacts/verify-artifacts/sharing-run` does not exist before launch.
- Actual Chrome 152 or newer.

- **Launch and inspect.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/sharing-run`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/sharing-run`.
- **Drive.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive sharing --run .test-artifacts/verify-artifacts/sharing-run`. The recipe:
  1. Creates `Verification artifact` in project `Sharing proof` and publishes revision 1 through HTTP MCP.
  2. Creates `guest@example.test` with a verified email through the supervisor's `POST /account` route. The guest signs in with the run password from `runtime/credentials.json`.
  3. Opens the publication as the guest in a second browser context, signs in, and checks the panel `404` above.
  4. Calls `artifacts_share` with the owner's MCP token and `GUEST@Example.TEST`, checks that the returned `value` is `guest@example.test`, repeats the call with the same `requestId` and expects the same share, and checks that `artifacts_shares_list` returns exactly that share.
  5. Reopens the URL as the guest, waits for the iframe heading `Verification revision 1`, checks `data-revision-id`, checks that the page has no project link, `Cliente autor`, or `Revisión 1`, downloads `notes.txt`, and repeats the view at 390 pixels without horizontal overflow.
  6. Opens the URL as the owner and checks the `Sharing proof` project link.
  7. Calls `artifacts_read`, `artifacts_history`, and `artifacts_export` with the guest's MCP token and expects `not_found`.
  8. Calls `artifacts_unshare` with the share's `shareId` and checks that `artifacts_shares_list` is empty. Then it reloads as the guest, expects `403` and no viewer cookie, and replays the stale cookie outside the browser to check the exact body and the clearing `Set-Cookie`.
  9. Calls `artifacts_share` again and checks that the guest is admitted. The run ends with an active share and an admitted guest.
- **Evidence.** `sharing/actions.jsonl` with every `MCP artifacts_share`, `MCP artifacts_shares_list`, and `MCP artifacts_unshare` request and response, `result.json`, `guest-before-share.png`, `guest-view.png`, `guest-view-390.png`, `owner-view.png`, `revoked.png`, `guest-readmitted.png`, their `*.aria.yml` snapshots, and `trace.zip`.
- **Stop.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run .test-artifacts/verify-artifacts/sharing-run`.

## Accounts for later lanes

After the drive, or on any other run, `account` creates or updates a disposable account and mints a fresh MCP token for it:

```sh
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts account --email guest@example.test --run .test-artifacts/verify-artifacts/sharing-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts account --email guest@example.test --unverified --run .test-artifacts/verify-artifacts/sharing-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts account --email stranger@example.test --run .test-artifacts/verify-artifacts/sharing-run
```

- The command prints the user ID, the lowercase email, the verification state, and the path of `runtime/accounts/<email>.json`. That file holds the same fields plus `accessToken`. The token expires about five minutes after the call; run the command again for a new one.
- Repeating the command for an existing email keeps the same user ID and sets the verification state. It also signs the account in again, which opens a new central session, mints a new MCP token, and overwrites `runtime/accounts/<email>.json`.
- Every disposable account uses the run password from `runtime/credentials.json`.
- Cleanup removes `runtime/`, including these tokens.

## Gotchas

- The supervisor has no share route. Share, list, and revoke through MCP with the owner's token from `runtime/credentials.json`, which expires about five minutes after launch.
- Better Auth stores every account email in lowercase, so live runs cannot exercise a mixed-case account email. `tests/sharing.test.ts` covers it with a direct row update.
- The guest sees `metadata.custom`, the title, the description, the revision ID, its creation time, its SHA-256, and the publication version, because they describe the published revision.
- Run one drive per fresh run. The drive takes the run's `drive.lock`.

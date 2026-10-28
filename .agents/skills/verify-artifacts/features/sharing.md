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

- The owner publishes an artifact and shares it by calling the MCP tool `artifacts_share` with the guest's email. The owner can also manage shares through REST or the typed client's `share`, `listShares`, and `unshare` methods. The CLI provides `share ID --email EMAIL`, `shares ID`, and `unshare ID SHARE_ID`. The panel exposes **Compartir** from each library card menu and the detail header. The native `/artifacts/:artifactId/share` page supports the same add, list, and revoke forms without JavaScript. Granting access does not send an invitation email.
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

- **Launch and inspect.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --allow-guests --run .test-artifacts/verify-artifacts/sharing-run`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/sharing-run`.
- **Drive.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive sharing --run .test-artifacts/verify-artifacts/sharing-run`. The recipe:
  1. Creates `Verification artifact` in project `Sharing proof` and publishes revision 1 through HTTP MCP.
  2. Creates `guest@example.test` with a verified email and a separate unpublished invitation for global admission through the supervisor's `POST /account` route. The guest signs in with the run password from `runtime/credentials.json`. This setup gives the guest no owned artifacts or visible shared cards.
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
- Each disposable guest receives an invitation to a separate unpublished fixture artifact. It preserves global admission when the recipe revokes its tested share, without owned artifacts or visible shared cards.
- Cleanup removes `runtime/`, including these tokens.

## Gotchas

- The supervisor has no share route. Share, list, and revoke through MCP with the owner's token from `runtime/credentials.json`, which expires about five minutes after launch.
- Better Auth stores every account email in lowercase, so live runs cannot exercise a mixed-case account email. `tests/sharing.test.ts` covers it with a direct row update.
- The guest sees `metadata.custom`, the title, the description, the revision ID, its creation time, its SHA-256, and the publication version, because they describe the published revision.
- Run one drive per fresh run. The drive takes the run's `drive.lock`.

## Panel share proof

After `pnpm build`, run `node --import tsx tests/panel-share.browser.proof.ts`. The proof launches a disposable control instance, authors through HTTP MCP, grants and revokes access through the real panel, and cleans up its instance on success or failure. It uses a second authenticated guest browser context and asserts that an established publication viewer receives HTTP 403 after revocation.

To capture review media on an existing disposable instance, run `node --import tsx tests/panel-share.browser.proof.ts --run <absolute-run-path> --headed`. The proof also cleans up this supplied instance. Run no other drive against it. The headed recording uses chronological cuts from the actual owner and guest page videos in that same run, at their original speed. Source recordings and segment timestamps remain in `<run>/panel-share/`. The output is `.test-artifacts/review/S8-review.mp4`.

The proof covers both entry points, focused Spanish validation, lowercase email, unpublished copy, mobile long emails, Escape focus, native invalid/add/list/revoke, delayed hydration, modified clicks, request parsing and origin checks, non-owner and expired-session denial, synchronous double submission, reversed reads, and artifact switches with a pending POST. It deliberately delays responses and injects GET failures. Lost-response tests first send the POST to the actual application and store, then hide its committed response. Historical add and revoke retries must render only the current access list. These injections test recovery behavior and do not claim a real backend outage.

The proof writes screenshots, accessible snapshots, request bodies without authentication data, and `result.json` under `<run>/panel-share/`. Required review captures are copied to `.test-artifacts/review/`. The original `control.ts drive sharing` recipe above still verifies MCP sharing and publication authorization. It does not exercise these panel forms.

## Invited person's library

The unfiltered root library shows **Compartidos conmigo** above owned controls. Each native card contains the current published title, **Compartido por** with the owner's display name, and the protected publication link. Search, project, status, and cursor views apply to owned artifacts and omit this section. Shared cards expose no owner actions. A guest publication's home link returns to `/#shared-with-me`. Empty accounts keep the existing welcome.

Run `pnpm build && node --import tsx tests/panel-share.browser.proof.ts --shared-with-me` for all ten S9 lanes. The default proof runs the inherited S8 checks, cleans up, then runs S9 in a fresh disposable instance, so `pnpm test:browser` covers both without carrying account state or authentication quotas between recipes. The S9 path uses the actual public HTTP MCP endpoint, real guest credentials, built panel, installed Chrome, and native links with JavaScript disabled. It checks published versus private draft titles, attribution, revocation, publish after invitation, empty welcome without published shares, filters, current verification, 390px overflow, focus, and guest authoring with a separately issued guest token.

Add `--headed` to the focused S9 command to record the real guest library and publication. It retains chronological cuts at original speed and writes `.test-artifacts/review/S9-review.mp4`, four review PNGs plus the separate mobile publication PNG, and private provenance below the run's `panel-share/` directory. The video shows actual guest navigation. Cleanup removes fixture services and runtime credentials after success or failure.

## Invitation proof

Run `pnpm build && node --import tsx tests/invitations.browser.proof.ts` for the S10 browser, HTTP MCP, REST, CLI, and local-file invitation proof. Add `--record --headed` to retain chronological owner and guest video at original speed. It writes the review video and panel, sign-in, and 390/1440 email PNGs under `.test-artifacts/review/`. Email HTML comes from the actual disposable sink. It also runs the deployed-verifier CLI against two private disposable states and checks negative identity, revision, preexisting access, concurrent access, uncertain response, and cleanup cases.

The fixed launcher accepts `--invitations` to enable the disposable file sender in the combined resource and actual Node panel. Add `--email-code` for guest code sign-in. Neither flag sends external email. Read the sink path from the private `runtime/email-code.json` record, and always run `cleanup` after success or failure. The standalone S10 proof closes its own fixture and removes private states automatically.

An invitation request does not confirm delivery. Exact replay sends no second message. The per-owner allowance is 100 attempts per UTC day, and access still succeeds when an invitation is limited. Actual production verification and Sending DNS records remain operator gates.

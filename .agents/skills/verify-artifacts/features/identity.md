# Identity and sessions

An owner signs in to see their artifacts and the same account ID used by connected tools. Panel logout closes the panel session; global logout requires confirmation and revokes browser and MCP access together.

## Sub-features

- `identity-login` opens the account login from the panel and returns to an authenticated panel.
- `identity-canonical` shows the same account ID in the panel and MCP `whoami`.
- `identity-panel-logout` closes only the panel session while MCP access remains valid.
- `identity-sso` reopens the panel using the still-active central session.
- `identity-revoke-all` confirms global logout and denies previously valid MCP access.
- `identity-consent` reviews or cancels a client consent request; this is an extended path, not covered by the fixed drive.

## How to get to it (user POV)

- Open the panel root and choose `Iniciar sesión`.
- Open a protected artifact or publication while signed out; its authentication path returns to the requested page. Publication handoff is mapped separately in [publication](./publication.md).
- On the signed-in panel, open `Mi cuenta` to inspect the account ID, choose `Cerrar sesión del panel`, or choose the `Cerrar todas las sesiones` link and confirm on the account page. On mobile, open `Navegación` first.
- A newly connected OAuth client can open the account page titled `Conectar una herramienta`, with `Permitir acceso` and `Cancelar` buttons.

## Driving it with control.ts (Playwright + HTTP MCP)

Preconditions:

- `.test-artifacts/verify-artifacts/identity-run` does not exist before launch.
- The account, OAuth registration, and services belong to this run. Global revocation must never target the normal owner account.

- **Launch and inspect.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/identity-run`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/identity-run`. The helper reports healthy owned services and a valid disposable MCP identity.
- **Execute the user path.** Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive identity --run .test-artifacts/verify-artifacts/identity-run`. Its browser recipe chooses `getByRole('link', { name: 'Iniciar sesión', exact: true })`, fills `getByLabel('Correo electrónico')` and `getByLabel('Contraseña')`, and submits `getByRole('button', { name: 'Iniciar sesión', exact: true })`. The visible `Biblioteca` heading confirms the panel is ready. The recipe opens the native `Mi cuenta` disclosure, then `getByTestId('user-id')` must equal MCP `whoami.userId`.
- **Inspect mobile account controls.** The same drive reloads at 390px, opens the native `Navegación` and `Mi cuenta` disclosures, and checks the same account ID without page overflow. It captures the mobile account view before returning to desktop for logout.
- **Panel logout and SSO.** The same drive chooses `getByRole('button', { name: 'Cerrar sesión del panel', exact: true })`. The signed-out panel exposes the login link while the original MCP token still reaches `whoami`. Choosing that login link again restores the library through central SSO. Reopening `Mi cuenta` exposes `user-id` and the session actions.
- **Global logout.** The same drive chooses the exact `Cerrar todas las sesiones` link, then the exact button with that name on the confirmation form. The panel returns to its login entry and the previously valid MCP token is denied. Record both the confirmation action and the denied response.
- **Retain proof and stop.** Inspect `.test-artifacts/verify-artifacts/identity-run/identity/actions.jsonl`, `result.json`, browser snapshots/screenshots, and `trace.zip`, then run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run .test-artifacts/verify-artifacts/identity-run`. Confirm the screenshots and action/result records still exist after cleanup.

## Gotchas

- The link and button named `Cerrar todas las sesiones` live on different pages. Opening the confirmation page alone does not revoke access.
- Panel logout and global logout have different promises. Verify MCP access after each; the signed-out screen alone cannot distinguish them.
- Reuse of this run after global logout fails its health/authentication precondition. Launch another isolated run.
- The fixed drive does not prove consent acceptance/cancellation, invalid-password recovery, every protected return URL, or model-provider authentication. Report these paths as unverified.
- `tests/browser.proof.ts` additionally checks native POST origins, cookie removal, and desktop/mobile identity layout. Treat its fixture OAuth setup as setup, not a proof of a live CLI registration.

## Email-code HTTP sign-in

Launch with `control.ts launch --email-code --allow-guests --run PATH` to opt into the disposable file transport. The default launch keeps legacy password authentication. The private `runtime/email-code.json` records the sink path. Read it only inside the owned verification process. Never capture raw codes or expose a code retrieval endpoint.

Run `node --import tsx tests/email-code.browser.proof.ts --run PATH` for invited code sign-in, the dashboard callback, publication access, owner password survival, and guest MCP OAuth. The sign-in form remains a later feature. This proof requests and redeems codes through HTTP, then drives the actual browser callback and publication. Cleanup drains sends before removing the database and sink.

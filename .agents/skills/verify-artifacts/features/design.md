# Retained design canvases

A design retains HTML boards, their placement, pages, and notes in one revision. The panel and protected publication use the same canvas renderer. Board-name buttons open interactive focus view at the board's declared size.

## Run the design recipe

Use a fresh disposable run after `pnpm build`. Read the launch output for the exact path and distinct service hosts.

```sh
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/design-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/design-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive design --run .test-artifacts/verify-artifacts/design-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run .test-artifacts/verify-artifacts/design-run
```

Always run cleanup after a failed drive too. Confirm `cleanup.json` says `stopped`, `runtime/` is absent, and the design evidence remains.

The drive creates `Verification design` through the real HTTP MCP endpoint. Its four HTML files are Desktop at 1440 by 900, Phone at 390 by 844, Detail at 1440 by 900, and Detail phone at 390 by 844. Overview and Detail each contain two boards with an 80 px gap. A note belongs to Overview.

The recipe executes these user paths:

1. Create the complete snapshot with `artifacts_create`. Independently call `artifacts_read` for the selected revision and compare the full snapshot.
2. Sign in through **Correo electrónico**, **Contraseña**, and **Iniciar sesión**. Open the exact **Verification design** link from the library.
3. Inspect `frameLocator('.preview')`. Require four board frames with their real document headings and two visible boards on Overview.
4. Click **Abrir Desktop a tamaño real**. Require a 1440 by 900 iframe with `inert` disabled. Click **Try interaction** in that nested frame and wait for **Interaction verified**.
5. Click **Volver al lienzo**. Compare the canvas transform with its prior value. Select **Página Detail** and require only Detail and Detail phone. Return to **Página Overview**.
6. Open **Menú de Verification design**, then **Descargar revisión 1**. Compare the browser ZIP with `artifacts_export` byte for byte and verify the archive digest.
7. Reconstruct the snapshot from `artifact.json`, `content.json`, and `files/boards/*.html`, preserving `snapshot.files` order from the independent saved read. The ZIP manifest sorts files by path and does not preserve that original array order. Create another artifact through MCP and require the same snapshot SHA-256.
8. Publish the original selected revision with `artifacts_publish` and independently read its publication. Open the returned protected URL and interact with Desktop through `frameLocator('main > iframe')` and its nested frame.
9. Use a separate anonymous browser context. Require status 303 for wrapper admission and 401 for the revision-bound content URL.
10. Call `verifyRetainedArtifact` with the independent published read and pinned panel URL. Require `passed` for 1440 by 900 and 390 by 844, including exact content responses, policy, complete board downloads, and deterministic ZIP verification.

## Inspect evidence

The run's `design/` directory contains `actions.jsonl`, `result.json`, `saved-read.json`, `published-read.json`, both design ZIPs, `retained-config.json`, and `trace.zip`. The recipe scrolls the panel preview into view and captures the actual 1440 by 900 viewport so Chrome composites its nested frames. Screenshots and ARIA snapshots use `design-panel`, `design-focus`, `design-pages`, and `design-publication`. The `retained/` subdirectory contains the complete verifier report and viewport evidence.

A passing local recipe proves the local built Astro panel, public HTTP MCP authoring, and protected local publication. It does not prove a deployed Worker or a live Claude or Codex client connection. The source fixture uses system fonts. Font embedding and installed CLI directory preparation remain separate authoring checks.

The retained verifier's declarative expectations inspect the canvas host document. This recipe checks nested board content and interactions directly with nested frame locators. Full containment, unsupported-browser fallback, pan and zoom precision, and availability probes remain in `tests/design-canvas.browser.proof.ts` and the independent program lanes. Board documents start inert on the canvas, which stops ordinary focus calls. It does not stop a board script that removes its own lock.

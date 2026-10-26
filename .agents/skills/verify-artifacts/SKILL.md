---
name: verify-artifacts
description: "Verify Artifacts through its real Astro panel, protected publication page, HTTP MCP tools, and standalone CLI over REST. Use after changes to identity, authoring, the CLI or REST, projects, history, preview, publication, or export, or when asked to prove an artifact inside the actual app."
---

# Verify Artifacts

Read the [feature map](features/README.md), then the requested feature recipe. The disposable recipes use the existing production handlers and built panel with a local identity. The [retained artifact recipe](features/retained.md) provides partial inspection through an authenticated browser-control tab and complete verification through a supplied authenticated browser context or private storage state. It supports deployed and local URLs without authoring or account mutations. Live Claude/Codex acceptance is a separate path described in the map.

## Verify a retained revision

When only an authenticated browser-control tab is available, follow [Partial browser-control verification](features/retained.md#partial-browser-control-verification). Record the exact selected revision, available frame and response evidence, observed interactions, and unavailable checks. A connected tab does not supply a Playwright `BrowserContext` or storage-state file. Keep its authentication inside the browser.

Report persistence, local rendering, hosted rendering, and protected publication separately. A partial browser inspection cannot return the complete verifier's pass verdict. Use the supplied-context path below when exact response bytes, complete policy checks, downloads, attachment bytes, or automated viewport coverage are required.

Use an independent saved full `ArtifactRead`, an exact selected panel URL with `revisionId`, and the [typed declarative configuration](features/retained.md). Publication coverage requires that the selected saved revision is currently published. Omit `publicationUrl` for an unpublished selection. The report explicitly records that publication was not requested.

```sh
node --import tsx .agents/skills/verify-artifacts/scripts/verify-retained.ts \
  --config /private/path/retained-config.json \
  --storage-state /private/path/browser-state.json
```

The CLI opens actual Chrome with the supplied state. It never accepts a login password, creates an account, authors a revision, publishes, logs out or revokes a session. Normal protected viewer admission can consume its one-use viewer grant through the existing GET handoff. The callable `verifyRetainedArtifact(context, config)` preserves the supplied context and closes only its own pages.

Complete exact-state markers must match the saved artifact ID, revision ID, SHA-256 and publication version. A partial, malformed or mismatched marker set fails. Only a page with all four marker attributes absent can use the supported legacy proof. That proof compares the displayed panel ID and digest, actual pinned preview response, complete deterministic downloaded ZIP, unique publication revision sequence, exact content response bytes, and complete revision-bound attachment bytes. Current publications load a revision-bound authenticated iframe with its own containment headers. Older publications can use exact `srcdoc` only with the legacy wrapper policy. The panel independently rereads publication revision/version before and after publication checks.

Every viewport reloads the real frame before content expectations. The verifier checks wrapper and frame overflow, CSP, containment headers, sandbox and console/page errors. It records private screenshots, ZIPs and a typed `result.json`. It omits traces, storage state, raw authentication requests and query strings from evidence. A failed check returns `status: "failed"`; the CLI exits with code 1.

Run the pure config/archive tests with `node --import tsx --test tests/retained-verification.test.ts`. Run the Chrome contract tests with `node --import tsx --test tests/retained-verification.browser.proof.ts`. Run the actual local application proof with `pnpm build && node --import tsx tests/retained-browser.proof.ts`. The proof uses the existing migrated disposable fixture, completes setup/login first, invokes the same callable verifier, then compares persisted authoring/account/session rows and browser methods to prove no mutations during verification.

## Launch

Run from the repository root with Node 24+, pnpm 12.8.1, installed workspace dependencies, and actual Chrome 152+ for interactive HTML. If dependencies are missing, use `pnpm install --frozen-lockfile`.

```sh
pnpm build
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch
```

The helper prints JSON with `ready: true`, a unique absolute `run` path, and service URLs only after the built panel and live MCP identity respond. Pass that path unchanged to later commands. For a named run, add `--run .test-artifacts/verify-artifacts/preview-run`; that directory must not already exist.

Launch starts a supervisor, auth, the combined MCP+REST resource, the built Astro Node panel, and publication. It migrates a temporary local SQLite/libSQL database, creates a disposable owner and confidential panel client, and obtains an MCP token through the existing public OAuth HTTP grant helper. This setup is scaffolding, not proof of interactive CLI OAuth consent. Each drive authors artifacts through the real public HTTP MCP endpoint.

The run uses ephemeral ports with distinct auth (`127.0.0.1`), panel (`localhost`), and viewer (`[::1]`) hosts. It never loads the normal `.env`, rewrites MCP registrations, or uses the owner's Turso database. Credentials remain in the private `runtime/` directory. Run one feature per fresh instance; the seeded MCP token expires after approximately five minutes. The supervisor automatically stops after 15 minutes. If the token expires, clean up and start a fresh run.

Instances have independent databases, ports and browser contexts. They share the installed dependencies and built panel read-only: finish active runs before rebuilding. The loopback panel port is reserved and then handed to Astro; if another process wins that handoff, launch must fail rather than driving its instance.

## Doctor

```sh
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run .test-artifacts/verify-artifacts/preview-run
```

Doctor performs read-only application checks and writes `doctor.json`: the supervisor's random instance identity and owned PIDs match the manifest, the panel build digest is unchanged, auth/MCP/panel answer, the viewer requires admission, and MCP `whoami` matches the disposable owner. A passing process alone is insufficient. Run doctor when anything looks off; each drive also runs it before user actions.

After the identity recipe deliberately revokes all sessions, a failing MCP doctor is expected. Cleanup verifies supervisor ownership independently of the revoked user token.

## Drive

```sh
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive preview --run .test-artifacts/verify-artifacts/preview-run
```

Choose `identity`, `authoring`, `cli`, `projects`, `screens`, `preview`, `publication`, `export`, or `sharing` as documented in the map. The helper exposes fixed recipes, not a generic click API. Read the recipe for its real ARIA selectors, entry points, expected state, and coverage gaps. Browser drives use a 1440x900 desktop viewport and 390x844 for mobile checks.

`screens` seeds ten artifacts across four projects and two unfiled artifacts, then captures the welcome, library, project, detail, move, and delete confirmation pages at both widths. It checks overflow, browser errors, and the visible primary-action count. See [Panel screen captures](features/screens.md) for the exact fixture, selectors, evidence, and `--headed` video option.

The primary visual route is the authenticated panel. `preview` creates two revisions via MCP, signs in through `Correo electrónico`, `Contraseña`, and `Iniciar sesión`, opens `Verification artifact`, selects `Ver revisión 1` and `Ver revisión 2`, and clicks `Try interaction` inside `frameLocator('.preview')`. It waits for `Interaction verified` and checks the 390px mobile layout. Opening extracted HTML in a generic server does not establish preview behavior.

`publication` separately proves protected viewer admission and interaction. `sharing` creates a verified guest account, shares a publication with it, and proves guest admission, the guest page without owner details, and revocation. After any launch, `control.ts account --email ADDRESS [--unverified] --run PATH` creates or updates a disposable account and writes a fresh MCP token to `runtime/accounts/`; see [Shared publication viewers](features/sharing.md). `authoring` records real JSON-RPC tool requests and independent reads. `export` compares a browser download of revision 1 with that exact revision's MCP archive. `cli` runs the source `artifacts` CLI against the run's REST resource and compares its export with MCP. `projects` creates projects through MCP, moves an artifact with the source CLI and with the panel's `Mover a proyecto` page, and checks the panel's `Tus proyectos` navigation. `identity` proves native panel logout and global revocation on the disposable account.

## Evidence

Evidence stays under the run path printed by launch, in ignored `.test-artifacts/verify-artifacts/`:

- `instance.json`: run identity, owned PIDs, URLs, owner and panel build digest.
- `doctor.json`: readiness and live identity checks.
- `<feature>/actions.jsonl`: actions paired with responses or observed states; login passwords and bearer tokens are omitted.
- `<feature>/result.json`: pass/fail, completed checks and precise local scope.
- Browser recipes: screenshots, `*.aria.yml` snapshots, and `trace.zip`; export also saves both ZIPs, publication saves `notes.txt`.
- `panel.log`, `supervisor.log`, and `cleanup.json` survive teardown.

Capture the actual action and resulting state. Confirm mutations through a second user-facing view or read, including exact file bytes for downloads. Fixture setup and direct store setters are not proof of authoring. The local helper uses no mocked product boundary; the map identifies fixture boundaries in the existing extended tests.

Trace archives can contain temporary browser credentials. Keep the run directory private and do not attach its raw files publicly. Report feature ID, entry points actually exercised, evidence path, browser version where applicable, and untested paths. A successful convenient entry point does not prove every path in the map. Screenshots do not prove complete network containment; use the existing active HTTP/UDP proofs when that is the requested behavior.

## Cleanup

Always clean up after success or failure:

```sh
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run .test-artifacts/verify-artifacts/preview-run
```

Cleanup checks the supervisor's instance identity before signaling its recorded PID. The supervisor stops only the panel child and servers it started, closes and removes its temporary database, and removes `runtime/` secrets. It retains the evidence and writes `cleanup.json`. Repeating cleanup on a completed run is safe. If ownership cannot be verified, stop and report the recorded run and error; never kill processes by name or adopt another instance.

After cleanup, check that `cleanup.json` says `stopped`, `runtime/` is absent, and the feature's `result.json`, action log and screenshots or archives still exist. Failed drives close their browser; still run cleanup for their server instances. Launch failures stop their own supervisor and retain logs.

## Helpers

The executable helper is [scripts/control.ts](scripts/control.ts). Invoke it through the Node commands above, or directly from the repository root as `.agents/skills/verify-artifacts/scripts/control.ts`. `serve` is its internal supervisor command, not a separate user verification entry point. `pnpm check` typechecks this helper alongside the application.

Use `/maintain-verification-skill` when user paths, stable selectors, harness commands or proof expectations change. Update the matching feature file and rerun its actual path.

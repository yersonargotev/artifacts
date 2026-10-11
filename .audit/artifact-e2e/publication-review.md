# Independent publication and Worker review

Reviewed `feat/artifacts-e2e` at `f607f6e`, then reviewed the root agent's working-tree corrections on 2026-10-11. Scope: publication admission and rendering, dashboard internal endpoints and previews, native auth/MCP entrypoints, and Worker build/deployment separation. The reviewer changed no implementation files and did not read personal environment files, contact the personal database, or change Cloudflare/CLI configuration. Runtime reproductions used local disposable servers, synthetic content, and a disposable SQLite identity fixture.

## Findings and corrections

### P1: WebRTC bypassed the promised network isolation

The original policies in `apps/publication/src/document.ts:3-5` allowed script execution while relying on CSP fetch directives to prohibit networking. `sandbox="allow-scripts"` and `connect-src 'none'` did not prevent WebRTC ICE traffic.

Reproduction used the actual `publicationDocument`/`documentPolicy` and `previewDocument`/`previewPolicy` functions, an HTTP server on loopback, a UDP collector on `127.0.0.1`, and Chrome **154.0.8037.98**. The embedded script performed:

```js
const pc = window.pc = new RTCPeerConnection({
  iceServers: [{ urls: `stun:127.0.0.1:${collectorPort}` }],
});
pc.createDataChannel('retained-document');
await pc.setLocalDescription(await pc.createOffer());
```

The collector received five 20-byte STUN binding requests within 4.5 seconds from each surface: the publication `srcdoc` frame and the panel preview frame. This establishes a real network-boundary violation; it does not establish access to parent cookies or successful transfer of credentials. The existing HTTP collector could not observe this UDP traffic.

An isolated mitigation test applied only `Connection-Allowlist: ()`. Both surfaces then sent **zero UDP packets**, while a JavaScript button continued working. A separate download check verified `download.failure() === null` and exact response bytes `download works` from the trusted wrapper's download link. Adding CSP `webrtc 'block'` was ineffective: Chrome reported that directive as unrecognized.

Root implemented the effective header at `apps/publication/src/http.ts:98` and `apps/dashboard/src/pages/artifacts/[artifactId]/preview.ts:14`, with DNS prefetch disabled. `apps/publication/src/document.ts:8-11` limits interactive rendering to the selected Chrome version policy; the rendering functions default to inert content at lines 18 and 25. Unsupported or absent user agents receive escaped HTML source, a script-denying policy, and a fully sandboxed publication frame. The preview endpoint also returns a script-denying sandbox policy for that fallback.

**Status:** corrected in reviewed source; the precise header behavior was independently demonstrated in installed Chrome 154. Chrome's official documentation identifies support beginning with Chrome 152. This is a browser compatibility policy, not authentication or a universal claim about other engines. Unknown/unsupported clients must retain the inert fallback. [Chrome connection allowlists](https://developer.chrome.com/blog/connection-allowlist-announcement), [Connection Allowlists specification](https://wicg.github.io/connection-allowlists/).

### P1: trailing-slash aliases bypassed internal service authentication

`apps/dashboard/src/middleware.ts:9` originally guarded only exact members of `servicePaths`, while Astro also routed `/internal/publication/read/` to the same endpoint. The endpoint previously trusted the middleware and accepted a caller-provided viewer without verifying the service credential itself.

Reproduction built a clean disposable copy of the real Astro panel, created and published synthetic content through the store, and issued HTTP POST requests with `Origin` set to the fixture panel. Both requests supplied the same valid fixture `artifactId`, `userId`, live `sessionId`, and future `expiresAt`. Neither request supplied a cookie or an Authorization header.

| Request path | Original result | Protected fixture bytes |
| --- | --- | --- |
| `/internal/publication/read` | 403 | Absent |
| `/internal/publication/read/` | 200 | Present |
| `/internal/publication/%72ead` | 403 | Absent |
| `/internal/publication//read` | 403 | Absent |
| `/internal/publication/read//` | 308 to the trailing-slash alias | Not in redirect response |

The exploitation precondition is knowledge of the owner/artifact/live-session identifiers. These identifiers alone are not the intended proof of service authority. This was not an unauthenticated session-ID enumeration finding.

Root added `publicationServiceAuthorized` directly at `apps/dashboard/src/pages/internal/publication/read.ts:6` and `apps/dashboard/src/pages/internal/publication/consume.ts:7`, before parsing the body or invoking the store. The endpoint now owns the security check independently of URL spelling. Root also added trailing-slash rejection assertions for both endpoints to `tests/artifact-browser.proof.ts:70`.

**Status:** corrected in reviewed source. The root agent owns the integrated browser regression rerun; this report does not attribute that run to the independent reviewer.

### P2: the Node dashboard build imported non-erasable TypeScript

The clean Node-adapter build externalized `@artifacts/artifacts`. Starting it with ordinary Node **24.12.0** caused requests to fail with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, pointing to the constructor parameter properties in the original `packages/artifacts/src/contracts.ts:46`. The disposable route reproduction required `--import tsx` before the fix; the failure occurred before the endpoint test could run.

Root preserved the constructor signature while replacing parameter properties with readonly fields and explicit assignments at `packages/artifacts/src/contracts.ts:45-52`. This removes the observed unsupported syntax without requiring a production transpiler. The native Worker bundles compile TypeScript and were not affected by this particular startup failure.

**Status:** corrected in reviewed source; root reported independently reproducing the failure and is rerunning the actual Node browser proof.

## Other inspected boundaries

- Publication cookies are encrypted/authenticated, purpose- and origin-bound, HttpOnly, Secure, host-only, and artifact-scoped. Callback state, artifact identity, expiry, and the one-use grant are checked before admission. Read responses are schema-checked against owner, artifact, and selected published revision.
- Every published document or attachment request calls the backend; the store rechecks the live central session, owner, artifact binding, and current publication in a transaction. Backend outages and malformed responses fail closed. Obsolete attachment revision paths do not silently serve bytes from a newer publication.
- The trusted wrapper escapes metadata and attribute content. Executable content remains in an opaque sandbox. Direct panel preview navigation requires an iframe fetch destination, and the parent policy restricts frame navigation. Attachment responses use attachment disposition, nosniff, and a restrictive sandbox policy.
- Native auth's metadata transport permits only the two explicit vendor document URLs and refuses redirects. MCP verifies signed claims, compares them with live introspection, checks resource/origin admission, and derives store authority from that principal. No additional reproducible defect was found in these paths.
- Inspected generated bundle evidence and service manifests: publication declares only `DASHBOARD_URL`, `PUBLISH_URL`, `PUBLICATION_SERVICE_SECRET`, and `PUBLICATION_COOKIE_SECRET`; it has no external `node:*` imports. Auth's external imports were `node:crypto` and `node:async_hooks`; MCP had none; panel had only `cloudflare:workers` and `node:crypto`. None of the four evidence files contained the native `libsql` package. The deployment helper forwards an explicitly selected service's prebuilt output; live deployment remains a separate evidence gate.

## Verification and remaining gates

Independent focused tests ran before and after the corrections:

```sh
node --import tsx --test tests/publication.test.ts tests/worker-metadata.test.ts
```

Result after corrections: **6 passed, 0 failed**. These include publication handoff, tampering, backend denial/failure, current interactive/fallback response structure, internal credential comparison, local return paths, metadata URL restrictions, and redirect refusal.

The reviewer also performed the real Chrome UDP control/mitigation and download experiments, the real Astro trailing-slash reproduction, and the clean Node startup reproduction described above. Integrated post-fix browser execution, deployed Worker behavior, actual public Claude/Codex OAuth/MCP acceptance, and deployed revocation/anonymous-denial evidence belong to the root agent's final execution record. Bundle inspection and local proofs do not establish those deployment outcomes.

No additional unresolved implementation finding was identified after inspecting the corrections. Acceptance remains conditional on the integrated and deployment gates, including the documented browser support boundary.

## No-comments audit

Applied `.agents/skills/no-comments/SKILL.md` as the independent reviewer over the scoped application and build/deployment sources. No narrative/workaround/constraint comments or lint/TypeScript suppressions requiring action were found. `MUST KILL`: 0; `RESHAPE`: 0; exception-protected `KEEP`: 0. Deletions, restorations, reruns, architect sketches, and constraint encodings: 0. No unenforced comment constraint remains in the reviewed scope.

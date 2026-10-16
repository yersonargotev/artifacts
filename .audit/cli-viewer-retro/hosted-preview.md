# Exact hosted preview diagnosis

## Observed boundary

The blank frame is reproducible while the browser-control connector debugger is attached. The same pinned revision loads after disconnecting that debugger through its native browser banner and reloading with native browser controls. The recovery preserves authentication, CSP, iframe sandbox, and network containment. The underlying connector/CDP implementation defect is not established. No application patch is justified by this observation.

## Resource and current state

- Selected resource is `https://artifacts-mcp.yersonargotev.workers.dev/mcp`.
- Artifact is `c67ed593-0d72-4afd-a760-24530aab26a1`.
- Revision is `732871a5-d008-4426-ae8c-f22e88b9e010`.
- Panel query pins that exact revision throughout the read-only check.
- The current panel shows revision 1 as published. This differs from the prior session's unpublished snapshot. This run issued no authoring, publication, or revocation action against this resource.
- Native `brave://version` reports Brave 1.97.56, Chromium 155.0.8059.40, arm64. UA advertises Chrome/155.0.0.0.

## Actual browser evidence

1. CUA selected the existing authenticated Brave tab. The panel showed selected revision 1, its attachment inventory, and a white iframe. Accessibility reported `about:blank`. Captured warn/error logs were empty.
2. DOM inspection exposed the exact `/artifacts/<artifactId>/preview?revisionId=<revisionId>` source, `sandbox=allow-scripts`, and `referrerpolicy=no-referrer`. The frame had positive dimensions. Its expected heading did not resolve within the connector's bounded selector wait.
3. Native DevTools Network inspection followed a reload. The preview returned GET 200 OK, HTML, and a 39,493-byte decoded resource. Native accessibility included the expected HTML heading and controls. The response editor showed HTML and inline styles. Complete response bytes were not exported or hashed.
4. A subsequent connector `tab.reload()` reproduced white content. Native Network displayed the exact preview request as `(pending)`, 0.0 kB, with the browser banner stating that ChatGPT started debugging. A connector frame lookup later timed out waiting for CDP Runtime.evaluate.
5. Native reload recovered HTTP 200 and rendered the frame. Native clicks changed `Editor y espacio de trabajo` to selected and changed the scenario heading to `Start gana encaje; merece una prueba vertical`.
6. A second explicit connector reload reproduced the pending preview while the debugging banner appeared. Using the native banner's Cancel control disconnected debugging. Native Cmd+R then produced 200 and the expected heading. A native click again changed the selected scenario and heading. No application, credential, browser security, or containment setting changed between these observations.

## Recovered response policy allowlist

Native DevTools response headers showed these values. Request headers, cookies, report URLs, and authentication material are excluded from retained evidence.

| Header | Observed value |
| --- | --- |
| Content-Type | text/html; charset=utf-8 |
| Content-Security-Policy | default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts |
| Connection-Allowlist | () |
| Cache-Control | no-store |
| Vary | User-Agent |
| X-Dns-Prefetch-Control | off |
| X-Content-Type-Options | nosniff |
| Referrer-Policy | same-origin |

The frame element still has `referrerpolicy=no-referrer`, and the generated document includes a no-referrer meta policy. No duplicate CSP appeared in the inspected response header list. Header observations belong to the recovered response. A pending request has no final status, response headers, or response body to compare.

## Recovery and verification limits

Use native browser controls to disconnect the browser-control debugging session, reload the exact selected panel, and interact with the iframe through native accessibility controls. If reconnecting tab automation reproduces the stall, continue native inspection or use the retained verifier with an independently authorized supplied Playwright BrowserContext or private storage state. Do not copy credentials from the browser to create that state.

The connector exposes DOM snapshots, locators, screenshots, console logs, and page-assets capability. It does not expose an HTTP response listener, BrowserContext, or storage-state export. Native DevTools supplied the response observations without bridging credentials. The read-only evaluation sandbox does not expose `navigator`, so actual version came from native browser UI.

Persistence was established by the prior exact read/export evidence. This run adds recovered hosted visual rendering and one scenario interaction. It does not establish exact hosted response byte equality, all interactions, active network containment, protected publication admission, or mobile rendering of this original artifact. Empty captured logs do not prove the absence of all browser errors. The precise cause inside the browser-control integration remains unavailable. Native recovery demonstrates that the saved document and deployed preview can render in this same browser without weakening security.

## Evidence provenance

The observations above come from this root turn's authorized CUA and native accessibility tool outputs. No raw HAR, storage state, full private body, or trace was retained. The original artifact remained read-only. Existing retrospective and research files are unchanged.

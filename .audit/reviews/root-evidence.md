# Root independent runtime evidence

Executed against actual local services and generated owner data, not mocked authentication. Secrets and callback URLs remain ignored, private local files. Browser driver Playwright1.64.0 with installed Chrome. Observed runtime Node26.10.0 after workspace engine selection; initial shell had Node24.12.0. Neither version's global configuration was changed by root.

- Codex CLI0.162.1: default CIMD PKCE browser owner sign-in and consent PASS; actual codex exec MCP whoami PASS. Client_id is the official Codex HTTPS metadata-document URL. userId equals panel observed identity.
- Claude Code2.1.296: default CIMD PKCE browser owner sign-in and consent PASS; actual cli mcp get Connected PASS. Actual claude -p tool invocation NOT VERIFIED because Anthropic cloud account OAuth expired and could not refresh. No alternate API credentials present. User asynchronous session renewal requested; continued unrelated work. Distinguish this cloud identity from our working MCP OAuth.
- Real browser OIDC panel login PASS; displayed userId equals actual Codex whoami. Desktop1280x900/mobile390x844 visually inspected. No horizontal overflow or page errors.
- Reproduced native panel POST logout failure403. Request Origin:null caused by no-referrer policy. WHATWG Fetch append-request-origin algorithm1749-1765 confirms. App policies changed to same-origin, strict Origin validation retained. Repeated browser login/logout/relogin PASS; actual logout Origin equals dashboard origin and final page is signed out.
- Codex whoami after panel-only logout PASS same userId/sessionId. One earlier LLM response dispatched no tool and was INCONCLUSIVE; discovery-permitted retry with startup_timeout_sec30 made an actual successful tool call.
- Real browser global revoke POST303 PASS with exact auth origin. Panel becomes logged out and both relevant cookie names absent.
- Immediately after revoke Claude cli mcp get Needs authentication PASS. Codex startup transport logs AuthRequired WWW-Authenticate metadata challenge PASS; no tool dispatched. No reauthorization attempted.
- Root database unit PASS migrations twice, central deletion cascade, and rejected panel insertion referencing deleted central session.

Pending final checks: production browser-proof harness, final check/build/test set, independent security/comment/trail review and fixes. Remote Turso/cloud deployments not exercised. No remote configured, so no PR can be created.

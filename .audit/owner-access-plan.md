# Owner access work plan

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back.

Done means the server defaults to owner-only access, the explicit guest flag restores existing admission rules, and old guest sessions, authorization codes, refresh tokens, access tokens, panel cookies, and publication cookies cannot bypass closed access. Owner password, email-code, CLI, and HTTP MCP paths must pass. Password and OAuth throttling must work across runtime instances using trusted addresses. Verify with disposable HTTP instances and actual Chrome. Do not deploy.

1. Ground authentication, panel, publication, and throttling ownership.
2. Compare identity-boundary and request-guard designs before implementation.
3. Capture failing HTTP baseline before the fix.
4. Implement admission and shared atomic throttling.
5. Run focused tests, type checks, builds, and Chrome proof in both modes.
6. Independently review the diff and evidence. Prepare the review change without deployment.

## Throughput checkpoint

- Blocking first steps. Establish the admission predicate and reproduce the limiter before writing code.
- Independent workstreams. Read-only access and throttling investigations can run concurrently. One implementation owner changes coupled production code.
- Shared mutable state. Verification uses separate temporary databases. Production state and the existing security report are excluded.
- Smallest safe decomposition. One code owner keeps the policy coherent across auth, panel, and publication. A separate reviewer checks bypasses and proof gaps.

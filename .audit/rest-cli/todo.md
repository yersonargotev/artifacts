# REST and CLI execution

- [x] Read the Principles section of poteto-mode.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [ ] Phase C: Run the loop
- [ ] Phase D: Keep the audit trail
- [ ] Phase E: Verify and hand back

## Architect
- [x] Ground
- [x] Sketch
- [x] Agree
- [ ] Implement
- [ ] Scrap

## Arena
- [x] Frame
- [x] Fan out
- [x] Cross-judge
- [x] Pick
- [x] Graft
- [ ] Verify

## Execution gates
- [x] Ground domain persistence and identity/transports independently.
- [x] Capture current tests and reusable verification entry points.
- [x] Compare shared-core adapters and MCP consuming REST before implementation.
- [x] Record chosen types, package boundaries, authentication, deployment and compatibility.
- [ ] Implement and prove REST server with authenticated direct HTTP requests.
- [ ] Implement and prove HTTP client and actual CLI commands.
- [ ] Document packages and artifacts-cli skill, validate command examples.
- [ ] Prove MCP/panel interoperability, conflicts, uncertain retries, ownership and revocation.
- [ ] Review independently, fix findings, run required checks.

## Throughput checkpoint
- [ ] Blocking first steps. Ground existing behavior, baseline tests, compare designs and agree on contracts before implementation.
- [ ] Independent workstreams. Domain and identity exploration run independently. Design candidates write separate artifacts. Implementation splits only at settled package contracts.
- [ ] Shared mutable state. One domain store owns revision, publication and operation transactions. Delegates own disjoint files, and shared manifests are edited sequentially.
- [ ] Smallest safe decomposition. One implementation owner coordinates dependent server/client/CLI work, with independent review and user-facing proof.

## Swarm
- [x] Frame
- [x] Fan out
- [ ] Aggregate
- [ ] Report

# REST and CLI execution

- [x] Read the Principles section of poteto-mode.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back

## Architect
- [x] Ground
- [x] Sketch
- [x] Agree
- [x] Implement
- [x] Scrap. skip: the selected structure met acceptance; no architectural replacement was needed.

## Arena
- [x] Frame
- [x] Fan out
- [x] Cross-judge
- [x] Pick
- [x] Graft
- [x] Verify

## Execution gates
- [x] Ground domain persistence and identity/transports independently.
- [x] Capture current tests and reusable verification entry points.
- [x] Compare shared-core adapters and MCP consuming REST before implementation.
- [x] Record chosen types, package boundaries, authentication, deployment and compatibility.
- [x] Implement and prove REST server with authenticated direct HTTP requests.
- [x] Implement and prove HTTP client and actual CLI commands.
- [x] Document packages and artifacts-cli skill, validate command examples.
- [x] Prove MCP/panel interoperability, conflicts, uncertain retries, ownership and revocation.
- [x] Review independently, fix findings, run required checks.

## Throughput checkpoint
- [x] Blocking first steps. Ground existing behavior, baseline tests, compare designs and agree on contracts before implementation.
- [x] Independent workstreams. Domain and identity exploration run independently. Design candidates write separate artifacts. Implementation splits only at settled package contracts.
- [x] Shared mutable state. One domain store owns revision, publication and operation transactions. Delegates own disjoint files, and shared manifests are edited sequentially.
- [x] Smallest safe decomposition. One implementation owner coordinates dependent server/client/CLI work, with independent review and user-facing proof.

## Swarm
- [x] Frame
- [x] Fan out
- [x] Aggregate
- [x] Report

# Artifact end-to-end run

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Ground identity, MCP, database, and deployment interfaces.
- [x] Compare two architecture sketches and record the synthesis.
- [x] Blocking first steps. Establish the storage contract, authorization boundaries, and baseline tests before implementation.
- [x] Independent workstreams. Storage/MCP, publication, and dashboard have separate file ownership after the contract is settled.
- [x] Shared mutable state. Serialize schema/config changes through the lead; workers use separate worktrees when editing.
- [x] Smallest safe decomposition. One artifact-domain owner supplies the contract; consumers use that contract rather than duplicate storage rules.
- [x] Verify immutable revisions and MCP commands.
- [x] Verify protected Worker publication and dashboard navigation.
- [x] Migrate existing identity to Turso without losing owner/client identity.
- [x] Verify Claude creation, Codex modification, stable publication URL, and anonymous denial.
- [x] Verify deployed services when authorized deployment infrastructure is available.
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back

## Architect

- [x] Ground
- [x] Sketch
- [x] Agree
- [x] Implement
- [x] Scrap. Not needed: the implemented and verified flow supports the synthesized contract.

## Arena

- [x] Frame
- [x] Fan out
- [x] Cross-judge
- [x] Pick
- [x] Graft
- [x] Verify

## Swarm

- [x] Frame
- [x] Fan out
- [x] Aggregate
- [x] Report

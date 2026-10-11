# Artifact acceptance predicate

An actual Claude Code conversation creates an artifact through authenticated MCP. An actual Codex conversation reads it and saves a new revision through MCP. Both retained revisions can be read and exported. Publishing the selected revision keeps the artifact URL unchanged. The dashboard lists the artifact and its versions. A browser authenticated as the same canonical owner opens that URL and sees the Codex revision. An anonymous browser and direct file request cannot read any published bytes. Revoking the central session also denies publication access.

## Scope and rigor

The work touches one artifact store, MCP registration, the Astro panel, one separate publication Worker, existing identity migration, and cloud entrypoints. Rigor is high for ownership, scope checks, revision concurrency, executable HTML isolation, and migration. Ordinary presentation changes use visual browser inspection. No unrelated cloud resources are modified.

## Design comparison rubric

1. Each revision preserves complete files and metadata, and stale writers cannot overwrite a newer head.
2. Every read and write enforces canonical ownership and the operation scope.
3. Anonymous and revoked browsers cannot read the published document or assets.
4. Executable artifact code cannot acquire panel or publication control authority.
5. The first deployed increment uses existing authorized infrastructure and has repeatable runtime proofs.
6. One owner hides artifact invariants behind a small API, and export remains provider neutral.

## Workflow

1. Capture the baseline and trace existing identity interfaces.
2. Compare two independent designs and synthesize their strongest safe choices.
3. Build the artifact model and HTTP/MCP acceptance checks.
4. Implement immutable storage and commands, then verify them.
5. Implement publication and panel against that contract, then verify browser admission and isolation.
6. Copy identity through a consistent snapshot and verify all keys and rows before switching the local connection.
7. Deploy the isolated cloud services with private environment files.
8. Run the actual Claude, Codex, dashboard, publication, and anonymous-denial acceptance path against the deployed URLs.
9. Obtain independent review and correct evidenced defects.

## Baseline

`pnpm check` passed with zero errors and warnings and the existing local HTTP OIDC deprecation hint. `pnpm test` passed thirteen tests and failed the refresh replay equality assertion because `expires_in` decreased from 300 to 299 while all issued credentials and the absolute expiry stayed equal. That assertion must compare stable credentials and expiry semantics.

The repository has no Git remote. PR creation is unavailable until a remote is supplied. Cloudflare and Turso CLI authentication are available. Deployment runtime compatibility remains an evidence gate.

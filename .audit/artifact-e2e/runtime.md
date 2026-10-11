# Artifact execution evidence

## Integrated implementation

Root integrated the migration, native authorization Worker, immutable artifact domain, seven MCP tools, publication Worker, and Astro panel on `feat/artifacts-e2e`.

- `pnpm check`: zero errors and warnings; one existing local HTTP OIDC deprecation hint.
- `pnpm test`: 36 passed, zero failures or skipped tests after updating the migration fixture to name its columns.
- `pnpm test:browser`: actual Chrome passed signed OIDC identity, panel logout, central SSO, global revocation, cookie deletion, desktop layout, and mobile overflow checks.
- Root visually inspected the desktop and mobile captures.

These checks use disposable identities and databases. They do not establish deployed client acceptance.

## Existing identity migration

Root stopped the existing development supervisor and verified that ports 4100, 4101, and 4321 had no listeners. The original local database was checkpointed and backed up, together with the original environment file, under private ignored `.test-artifacts/artifact-e2e/`.

The artifact migration was applied to both source and target. `scripts/migrate-identity.ts --source-env .env --target-env .env.turso` completed twice, verifying 19 application tables and 38 rows each time. The second execution inserted no duplicate state. Root compared the source and target canonical owner directly, then changed only the database configuration and added local publication settings in the private `.env`. The original local database remains available for rollback.

The public issuer, resource, and panel callback use new HTTPS origins. Root created fresh confidential clients through the existing bootstrap with `ARTIFACTS_ENV_FILE=.env.deploy`; the migrated owner and old local clients were preserved. Publication and database secrets remain in ignored mode-0600 files.

## Independent review findings

The independent reviewer reproduced a panel preview frame navigating to an external collector despite its subresource CSP. The publication wrapper already blocked that navigation in Chrome. The preview fix and its browser regression are pending verification.

The reviewer also found that the new CLI acceptance runner initially inherited deployment secrets and checked historical export incompletely. No live client had run under that configuration. Root filtered application configuration from child environments and added exact published artifact/revision assertions, mandatory history results, archive digest checks, ZIP decoding, and original content/file/metadata assertions. Independent regression verification is pending.

## Remaining gates

Native Workers runtime proofs, deployment, artifact browser flow, live Claude creation and Codex modification, stable deployed publication, and anonymous denial remain pending. This document will be updated with observed results before handoff.

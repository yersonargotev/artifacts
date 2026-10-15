# Runtime evidence

## Before changes

At base commit `95a1fc6`, the following commands completed successfully.

- `pnpm test` passed 59 tests. Output is in `baseline-tests.log`.
- `pnpm check` completed TypeScript and Astro checks. Output is in `baseline-check.log`.
- `pnpm build` built the Node panel. Output is in `baseline-build.log`.
- `node --import tsx tests/artifact-browser.proof.ts` passed actual Chrome panel/publication proof. Output is in `baseline-browser.log`.

The OAuth revocation experiment is recorded in `oauth-probe.md`. It used a migrated disposable fixture and real HTTP, and removed its fixture after each run.

No new REST, CLI or package acceptance has passed yet. No production deployment or live account writes have occurred.

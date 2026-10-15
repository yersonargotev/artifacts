# CLI authentication review

Reviewed commit `dd67734` in `/tmp/artifacts-rest-cli-implementation`. The scoped files match that commit. This was an independent read-only review of `apps/cli/src/auth.ts`, `apps/cli/src/credentials.ts`, and `tests/cli-auth.test.ts` against the accepted implementation contract and `docs/decisions/rest-cli.md`.

No material findings in this scope.

The identity-to-submission credential-switch race is outside this partition and belongs to the operations reviewer. This verdict does not cover that race.

## Evidence

- `node --import tsx --test tests/cli-auth.test.ts` passed all 15 tests on Node `v26.11.1`. The command completed with no failed, skipped, or cancelled tests.
- The subprocess tests exercised successful native login and registration reuse, strict callback path/host/state/issuer checks, altered ID token signatures, exact resource metadata, changed issuer isolation, credential-bearing redirect refusal, resource profile isolation, refresh serialization, logout during refresh, late callbacks after logout, and cancellation before and after the callback.
- The SIGKILL test stopped the CLI after the provider had rotated its refresh token. The next CLI process acquired coordination, reported the durable uncertainty marker, and sent no second refresh request. The stalled-refresh test also required a fresh login after its bounded wait.
- A separate focused `CredentialStore.open` experiment passed permission repair from `0777` to `0700`, `0600` credential mode, state-directory symlink rejection, credential-file symlink rejection, and hard-link rejection. The rejected hard link did not change its source file's `0644` mode.

## Code conclusions

`auth.ts` checks exact resource metadata at lines 148-153. It checks issuer equality and endpoint origins at lines 56-63. Its custom transport refuses redirects and bounds response bytes and waits at lines 22-53. The login checks the verified ID token subject against the resource identity before saving credentials at lines 182-190. `enableNonRepudiationChecks` is enabled for both registration and rediscovery.

The callback binds `127.0.0.1` before the authorization URL is exposed at lines 103-109 and 175-177. It validates the exact host, path, state, issuer, and parameter multiplicity at lines 90-98. The `finally` path closes the listener and removes signal handlers at lines 118-123 and 193.

The separate lock database in `credentials.ts` serializes cooperating CLI processes at lines 59-72. The data write that sets `refreshAttempt` in `auth.ts` at line 214 commits independently before the refresh request at line 216. The coordination transaction is in the other database, so process death releases the lock without rolling back that marker. A later command rejects the marker before returning or refreshing credentials at line 209.

Login increments and later rechecks the epoch at lines 143-147, 158, and 181. Logout clears local tokens and advances that epoch under coordination at lines 230-234. It reports `unconfirmed` when revocation fails or the preceding refresh was uncertain at lines 238-241. Browser interaction does not hold the writer lock.

## Comment audit and limits

The comment audit was direct within this independent review. The single source comment at `auth.ts:213` is a KEEP because it explains the SQLite transaction boundary needed for crash durability. No lint or TypeScript suppressions were present in the scoped files. There were zero deletions, restorations, reruns, code fixes, encoding offers, or unenforced comment constraints.

Prove It Works shaped the verification choice. I ran the real CLI subprocess tests and additional filesystem checks rather than treating source inspection as runtime proof. Throughput checkpoint is not applicable to this read-only investigation.

This pass did not run a browser, the whole project test suite, packaging builds, or Node 24. The runtime evidence above is from Node 26. It did not modify application code, tests, builds, or lockfiles.

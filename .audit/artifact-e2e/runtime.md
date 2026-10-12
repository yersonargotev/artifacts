# Artifact execution evidence

## Accepted deployed flow

On 2026-10-11, actual Claude Code created and published revision 1 through the public MCP server. Actual Codex read that artifact, created revision 2, published it, consulted both retained revisions, and exported revision 1. Root opened both publications in installed Chrome 154.0.8037.98 with the same canonical owner and the same URL:

https://artifacts-view.yersonargotev.workers.dev/a/613c5bc3-227c-4030-bb99-7bc20b9e1573

The final heading is `Created by Claude · Edited by Codex`. Both clients completed real vendor CIMD OAuth against the deployed authorization Worker. The additional CLI connection is named `artifacts-cloud`; previous local `artifacts` connections remain available. CLI subprocesses receive no application database credentials, owner password, or publication secrets. Tool-result validation checks artifact identity, revision parents and sequence, publication version and stable URL, preserved historical metadata/files/content, archive digest, and exact ZIP entries and bytes.

The deployed browser proof established:

- Logged-in panel owner matches the original canonical owner; both revisions appear in history.
- Revision 1 preview retains Claude's original heading. Its panel ZIP is byte-identical to Codex's export.
- Anonymous document GET returns an empty 303 login redirect; anonymous attachment GET returns 401.
- Both internal publication endpoints reject requests without service credentials, with and without trailing slashes.
- A separately created central session was revoked. Its retained viewer cookie receives 403 for both document and attachment. The original browser and CLI session remains usable.
- JavaScript interaction and authorized attachment download work. Desktop and 390px mobile captures were visually inspected, including the loaded historical iframe; no horizontal overflow was observed.

The reproducible runners are `scripts/verify-artifact-clients.ts` and `scripts/verify-deployed-artifact.ts`. Private JSONL results, browser state, screenshots, backups, and archive bytes live in ignored `.test-artifacts/artifact-e2e/`. They contain personal state and are not committed.

## Integrated checks

| Check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm check` | Zero errors or warnings; one existing local HTTP OIDC deprecation hint |
| `pnpm test` | 39 passed, zero failures or skipped tests |
| `pnpm test:browser` | All three actual Chrome proof programs passed |
| `pnpm build:workers` | Four native bundles built; incompatible native database/DNS/HTTPS imports excluded |
| Four `cf deploy --prebuilt --dry-run` checks | Passed, including panel assets |
| Actual workerd/Miniflare with disposable sqld | Eleven checks passed on Node 24.12.0 |
| `git diff --check` | Passed |

The identity browser proof covers signed OIDC, native forms, panel logout, central SSO, and global revocation using disposable identities. The artifact browser proof covers immutable history, stable republishing, exact export bytes, owner enforcement, preview isolation, HTTP collector denial, anonymous/revoked access, and fail-closed backend outages. The network proof adds an actual UDP collector: an unrestricted WebRTC control sends packets, while publication and panel preview send zero packets under the connection allowlist. Interaction, trusted attachment downloads, and inert fallback are checked separately.

The native proof uses a disposable sqld process with the web libSQL driver. Auth health, sign-in, metadata, password login, and live session succeed; MCP health succeeds and anonymous MCP is denied; panel runtime service-secret admission works; viewer admission redirects to the fixed panel route. It does not substitute vendor metadata. Public OAuth and MCP acceptance above provide the separate live-provider evidence.

Final source bundles were rebuilt and compared with deployed fingerprints. Changed MCP and panel bundles were redeployed, then all four public health/admission checks passed. Actual Codex successfully read revision 2 through the final deployed MCP bundle. The final browser proof passed again against those deployments, including a separate run with no pre-existing browser state.

| Worker | Final deployed version |
| --- | --- |
| `artifacts-auth` | `cc90c101-67e2-4ea9-9b52-ff7184cdeefd` |
| `artifacts-mcp` | `fd28d60f-b998-4ce4-84ca-e4b8dd035008` |
| `artifacts-panel` | `ebb8f2a2-d551-4ad7-ba15-a98705274f5f` |
| `artifacts-view` | `b9ddc590-3ffa-4da5-9f2c-fc0d21420ecc` |

## Existing identity migration

Root stopped the existing development supervisor and verified its ports were free. The original local database was checkpointed and backed up with the original environment under private ignored evidence. Source and target migrations were applied, then `scripts/migrate-identity.ts --source-env .env --target-env .env.turso` completed twice, verifying 19 application tables and 38 rows each time. The second execution inserted no duplicate state. Source and target canonical owner IDs were compared directly before changing the local database configuration.

The original database remains available for rollback. Public HTTPS origins use fresh confidential clients created through the existing bootstrap; migrated owner and local clients remain intact. `.env`, `.env.turso`, and `.env.deploy` have mode 0600; the acceptance evidence directory has mode 0700. The four local services were restarted over Turso.

An early native prototype accidentally initialized one synthetic OAuth resource in the otherwise empty remote target. Root identified the exact row, verified it had no references, and removed only that row before migration. The prototype was changed to require an explicit disposable database configuration. This cleanup is recorded in `grounding.md` and the decision trail.

## Review findings and resolution

Two independent reviews are preserved in [review.md](review.md) and [publication-review.md](publication-review.md). Their historical scope and pending gates describe what each reviewer personally observed; this root execution record closes the integrated and deployed gates.

| Finding | Correction and verification |
| --- | --- |
| Preview could navigate an external frame | Parent frame policy plus actual browser collector/navigation regression |
| CLI runner inherited private application configuration and incompletely checked export | Sanitized subprocess environment; mandatory tool/history/publication checks; exact archive validation; independent negative synthetic cases and actual client acceptance |
| CSP did not stop STUN/WebRTC UDP | `Connection-Allowlist: ()` on both surfaces; actual positive UDP control and protected zero-packet checks; inert fallback for unsupported clients |
| Astro trailing-slash alias bypassed middleware service authentication | Both endpoint handlers authenticate before parsing or storage; exact and slash aliases denied locally and deployed |
| Node 24 rejected constructor parameter properties | Erasable readonly field assignments; production Node dashboard browser proof passed |
| Node build duplicated the domain error class | Externalize both shared store and contracts; callback error regression passed |
| Local publication origin and entrypoint differed | Load env file and use IPv6 port 4102; independent startup proof passed |
| Auth Worker ended its first response during context initialization | Await context initialization before caching; actual native password/session flow and deployed OAuth passed |
| Native fixture forwarding failed under Node 24 | Reconstruct request framing headers; unchanged production bundle passed all eleven native checks |

No additional unresolved implementation finding remained after correction review. Missing host `deslop` and control plugins were replaced by direct diff/comment review and actual CLI/browser execution; they are not claimed as executed plugins.

## Deliberate scope and reviewer attention

Snapshots accept at most 1 MiB decoded data and 32 attachments. HTML is self-contained; retained files are downloads, not relative executable website assets. Interactive HTML is enabled for selected Chrome 152+ user agents, verified on installed Chrome 154; other clients receive escaped source with scripts disabled. This compatibility decision is separate from authentication. The connection header is a developing browser feature; preserve the fallback and repeat the UDP proof when changing browser policy.

Authorization, MCP, panel, and viewer have separate workers.dev HTTPS origins owned by the account. No purchased/custom DNS domain was supplied or configured. The unrelated existing `landing` Worker was untouched. The viewer has two publication secrets and no database credential. Database-backed services have their own declared bindings.

At the time of the original acceptance, the branch was `feat/artifacts-e2e` and the repository had no Git remote; no PR or remote merge was claimed. The repository was subsequently pushed to `https://github.com/yersonargotev/artifacts`. The complete implementation is now consolidated in `main`, which is the GitHub default branch.

## Principles that changed choices

| Principle read this session | Concrete decision |
| --- | --- |
| Model the Domain | One typed complete snapshot and shared store own revisions, receipts, grants, and ZIPs |
| Foundational Thinking | Settle canonical owner, schema invariants, and adapter contract before parallel edits |
| Sequence Verifiable Units | Integrate domain, adapters, browser corrections, migration, then live acceptance |
| Separate Before Serializing Shared State | Separate worktrees/file ownership; root serializes schema, lockfile, secrets, and deployments |
| Boundary Discipline | Endpoint-owned service authentication and a viewer without database credentials |
| Type System Discipline | Derive vendor transport and Worker environment types from installed contracts |
| Test Behavior, Not Implementation | Assert exact exported bytes, real browser access, and actual collector traffic |
| Laziness Protocol | Bounded Turso snapshots avoid an unnecessary R2 upload lifecycle |
| Build the Lever | Repeatable migration, actual-client, deployed-browser, and network proof runners |
| Never Block on a Human | Observe available account/deployment interfaces and use the user's autonomous authorization |
| Make Operations Idempotent | Mutation receipts and transactional migration replay preserve state across retries |
| Exhaust the Design Space | Compare two independent storage/publication designs before selecting and grafting |
| Redesign from First Principles | Extend canonical identity into shared artifact authority and isolated publication |
| Prove It Works | Actual Claude creation, Codex editing, deployed URL, anonymous denial, and revoked-session denial |

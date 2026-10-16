# Isolated CLI lifecycle verification

`scripts/verify-cli-lifecycle.ts` installs the CLI into a fresh private directory outside the repository and exercises real local auth, REST, SQLite, Astro panel, and publication handlers. It accepts no remote resource argument. All publication and revocation belong to the disposable fixture identity.

The evaluator models each check as `passed`, `failed` with a failure category, or `untested` with a reason. It writes the report after each completed check. A failed prerequisite leaves subsequent paths explicitly untested. A failure category identifies the surface under test, not an established root cause. Preserve failed attempts and adjudicate evaluator errors separately before reporting a product defect.

## Run

Use an installed Chromium browser that supports sandboxed interactive HTML. The retained verifier rejects browsers that cannot provide the required security behavior. Do not pass flags that disable browser security.

```sh
repo=/Users/argote/Documents/dev/yersonargotev/artifacts
proof_dir=$(mktemp -d /tmp/artifacts-cli-lifecycle-run.XXXXXX)
browser='/absolute/path/to/Chrome for Testing'

if [ -d "$repo/apps/dashboard/dist" ]; then
	cp -R "$repo/apps/dashboard/dist" "$proof_dir/prior-panel-dist"
fi
pnpm --dir "$repo" build
pnpm --dir "$repo" exec tsx "$repo/scripts/build-packages.ts" \
	--out "$proof_dir/candidate-packages"

cd "$proof_dir"
node --import "$repo/node_modules/tsx/dist/loader.mjs" \
	"$repo/scripts/verify-cli-lifecycle.ts" \
	--source registry \
	--browser-executable "$browser" \
	--report "$proof_dir/registry.json"

node --import "$repo/node_modules/tsx/dist/loader.mjs" \
	"$repo/scripts/verify-cli-lifecycle.ts" \
	--source local-tarballs \
	--inventory "$proof_dir/candidate-packages/manifest.json" \
	--browser-executable "$browser" \
	--report "$proof_dir/candidate.json"
```

Build once before starting fixtures. Do not rebuild the panel while a fixture uses it. `build-packages --out` requires an absolute absent directory. Its default output behavior remains unchanged. Each report and adjacent `.evidence` directory must also be absent. A rerun uses new paths rather than replacing evidence.

The registry baseline installs `@yargote/artifacts-cli@0.1.0-beta.1` from `https://registry.npmjs.org/`. The candidate installs all three public tarballs explicitly. The lock file must contain no linked packages. Registry dependencies must resolve to the public registry with SHA-512 integrity. Candidate public package integrity must match the supplied inventory.

Both may print `0.1.0-beta.1`. That version does not make a locally packaged candidate a published release. Provenance records the source kind, source HEAD, source file hashes, installed binary realpath/hash, package versions/resolved locations/integrities, npm/Node versions, skill source hashes/copies, local server URL, and actual browser version.

## Isolation and evidence

The runner uses an allowlisted environment. HOME, XDG directories, CLI state, npm user/global configuration, npm cache, input fixtures, and CLI working directory are private temporary paths. It never inherits an access token or a real browser session. Fixture source locations resolve from `import.meta.url`, so the evaluator itself can run outside the repository.

The native `login --no-browser` process supplies its authorization URL in memory. A fresh Playwright context fills the known disposable email/password into the actual sign-in page and approves consent. The evaluator does not inject a bearer token or export storage state.

Retained evidence contains sanitized reports, skill source copies, synthetic historical ZIPs, policy checks, and screenshots. It does not retain a HAR, trace, credentials, OAuth query URLs, cookies, viewer grants, or browser storage. Cleanup waits for owned CLI subprocesses, closes the browser, closes fixture services/database, and removes private CLI state in that order. Cleanup failure makes the run fail.

## Behavior covered

| Path | Evidence |
| --- | --- |
| Fresh install and login | Public registry or explicit local tarballs, new state, actual browser consent, persisted `whoami` |
| Creation and edit | Custom nested metadata, non-ASCII UTF-8 text file, binary `00 01 02 ff`, content-only edit preserves omitted fields and all bytes |
| Historical read and ZIP | Explicit revision 1 after later revisions, exact saved snapshot, ZIP entries/manifest, repeat ZIP equality, actual panel download equality |
| Pagination | Two artifacts and three revisions traversed with limit 1, complete expected identifiers, no duplicates |
| Replay | Same retained create receipt with unchanged revision history |
| Response loss | Real PUT handler commits before socket response is dropped, read/history prove persistence before retry, original retained operation SHA-256 unchanged, same request ID, no duplicate revision |
| Stale conflict | Structured `conflict` error on initial write and retained retry, nonzero exit, empty stdout, unchanged head/history |
| Bounded output | Current default still emits full JSON, candidate `read --out --quiet` emits no success stdout, byte-identical files, exclusive-file/missing-artifact/usage failures |
| Publication | Historical revision 1 only, current publication state read independently, anonymous protected access denied |
| Local rendering | Standalone saved synthetic HTML loads and its button changes the output |
| Hosted rendering | Actual isolated Astro panel and publication wrapper at 1280px and 390px, exact preview response bytes and policies, real sandboxed frames, attachment bytes, interaction expectations and geometry |
| Keyboard | Enter opens selected revision menu and focuses download, ArrowDown focuses Information, Escape restores trigger focus at both widths |
| Revocation | Normal revoke-all UI for the disposable identity, CLI read/retry denied, panel requires login, existing protected viewer denied |

The published beta predates `--quiet`. Its explicit rejection is the expected baseline capability result. Only the local implementation candidate is expected to support it.

Persistence, standalone local rendering, isolated hosted rendering, and protected publication have separate report outcomes. Production hosting is not exercised by this evaluator. Independent agent execution of the captured skill is explicitly untested. These results do not establish a skill-quality score or a causal claim about agent behavior.

## Recorded run on 2026-10-16 UTC

The run directory is `/tmp/artifacts-lifecycle-evaluation.fE3uNo`. The existing built panel was preserved in `prior-panel-dist`. The new panel build passed. Local packages were compiled into `candidate-packages-2` without touching the existing `dist/packages` inventory.

Final `registry-4.json` and `candidate.json` both passed all declared checks, including cleanup. Both used Node `v26.11.1`, npm `11.20.0`, and Chrome for Testing `155.0.8059.84`. Both recorded source HEAD `fc699b9279362c9fa6d30d462a667cf4bab41755` plus exact source hashes for the uncommitted evaluator/fixture/build changes. The candidate was unpublished.

The registry executable SHA-256 was `ef1d9bfc126a698460e72b421be62986eeefb6263e86c7deb52758818467d003`. The candidate executable SHA-256 was `430011ee80cf4e69e4b15c32e0bba18151f87a73e47c343b224ee1ceb25f7084`. Different executable hashes and captured package provenance distinguish the candidate despite its unchanged version string.

`build-output-guards.json` records rejection of empty, relative, and existing `--out` paths. Before/after hashes confirm that the existing root `tsconfig.json` and `dist/packages/manifest.json` were unchanged.

Earlier attempts remain available.

| Attempt | Result and adjudication |
| --- | --- |
| `build-packages.log` | Setup failed because a tsconfig outside the repository could not resolve Node types. The build script now supplies the source repository's absolute `typeRoots`. `build-packages-2.log` passed. |
| `registry.json` | Evaluator assertion expected the nonexistent `revision_conflict` spelling. Existing CLI contract uses `conflict`. The proof now parses final structured stderr JSON and checks the actual contract. No application fix was made. |
| `registry-2.json` | Evaluator asserted focus immediately after Enter. The existing browser proof waits for actual focus. The runner now waits for the bounded activeElement condition after Enter, ArrowDown, and Escape, without a sleep. Subsequent runs passed. No application fix was made. |
| `registry-3.json` | All product checks passed. A later review required serialized cleanup, so `registry-4.json` is the final baseline evidence. |

The final reports bind evaluator SHA-256 `52aeb77b198b35cce833b4f823653c17a822c73b8b4abe1544c05c59df4a6588`. The complete retained browser evidence is under the corresponding report's `.evidence/retained` directory. The original production research artifact was never supplied to this runner.

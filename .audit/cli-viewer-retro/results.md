# Artifacts CLI and viewer retrospective results

## Delivery

Branch `fix/cli-viewer-retro` contains independently reviewed CLI, guidance, and lifecycle changes. The original production artifact remained read-only. Existing untracked retrospective/research files and earlier ignored evidence were preserved. No production deployment, npm publication, PR, merge, global configuration change, or external message occurred.

| Unit | Result | Evidence |
| --- | --- | --- |
| Exact hosted blank preview | Demonstrated browser-control debugger boundary and native recovery. Same pinned iframe remained pending with connector debugging, then returned 200 and accepted scenario interaction after native debugging disconnect/reload. No application policy change. Internal connector defect remains unknown. | [Hosted observations](hosted-preview.md) |
| Bounded CLI output | `read --out FILE --quiet` preserves default stdout, exact selected-response file bytes, errors, exclusive creation, and mutation identity. Current public beta lacks the new flag. | `e8e8ba3`, `tests/cli-client.test.ts` |
| Partial browser guidance | Supports authorized authenticated tabs, records missing evidence, separates persistence/rendering/publication, and retains supplied-context exact verification. Existing markers, frame attributes, and native network tools suffice. No endpoint or telemetry added. | `fc699b9`, [Design decisions](design.md) |
| Isolated installed lifecycle | Registry beta baseline and unpublished local candidate each passed 22 declared checks. An independent candidate rerun also passed every check. Real auth, handlers, SQLite, Astro panel, and protected viewer. | `b5e8ab7`, [Rerun instructions](../../docs/verification/cli-lifecycle.md) |

## Separate verification outcomes

| Outcome | Original production revision | Disposable lifecycle resources |
| --- | --- | --- |
| Persistence | Prior session exact read and ZIP evidence retained. This turn did not mutate it. | Full snapshots, omitted fields, text/binary attachments, historical revision and deterministic ZIP bytes verified. |
| Standalone local rendering | Prior session result remains separate. | Synthetic saved HTML loaded and its button changed state. |
| Hosted rendering | Native recovered view and scenario interaction verified in Brave 1.97.56 / Chromium 155.0.8059.40. Complete byte equality and all viewport/policy checks remain unavailable for this original production revision. | Full retained verifier passed on real isolated panel and viewer at 1280x900 and 390x844, including exact responses, policies, complete attachments, downloads and interaction. |
| Protected publication | Current panel shows revision 1 published, unlike prior evidence. This turn did not publish it or verify its protected viewer admission. | Historical revision 1 published locally. Anonymous admission denied. Authenticated viewing and post-revocation denial passed. |

## Retained evidence

Private copies of the final reports and full browser evidence survive under `.test-artifacts/cli-viewer-retro/`.

- `registry-final.json` and `registry-final.evidence/retained/result.json` record the public registry baseline.
- `candidate-final.json` and `candidate-final.evidence/retained/result.json` record the unpublished packaged candidate.
- `candidate-independent.json` and `candidate-independent.evidence/retained/result.json` record the independent rerun.
- `build-output-guards.json` records empty, relative and existing output rejection without changing the existing root tsconfig or package inventory.
- `tests-final.log` records 91 passing tests with zero failures or skips.
- `check-final.log` records TypeScript and Astro checks with zero errors. Astro reports one existing deprecation hint.

The lifecycle runs used actual Chrome for Testing 155.0.8059.84, Node v26.11.1, npm 11.20.0 and separate temporary servers/identities. Each report records executable hashes, exact package integrities and resolved origins, skill copies/hashes, source hashes, local server, browser version, operation hashes, explicit outcomes and cleanup. They all bind evaluator hash `52aeb77b198b35cce833b4f823653c17a822c73b8b4abe1544c05c59df4a6588`.

Original full evaluation attempts and prior panel backup remain in `/tmp/artifacts-lifecycle-evaluation.fE3uNo`. The independent original report remains in `/tmp/artifacts-independent-lifecycle.7tAIma`. No temporary CLI credentials, database, fixture servers, or controlled browsers remain after the final runs. Candidate tarballs and the prior generated panel backup remain available for review.

## Failed attempts and adjudication

An initial external package build could not resolve Node types. Absolute source `typeRoots` fixed that setup defect. An initial evaluator expected a nonexistent conflict spelling. Another asserted keyboard focus before the documented asynchronous transfer. Both were evaluator defects. Structured error-code assertions and bounded focus waits corrected them without changing product code. Negative reports remain intact. `registry-3` passed product paths before the final cleanup ordering change, so `registry-4` is the final baseline. These failures do not establish product defects or skill-quality effects.

## Remaining limits

The hosted diagnosis establishes a reproducible environmental control boundary and a supported native recovery. It does not identify the connector's internal mechanism. Complete production response byte equality and automated protected viewing remain unverified because no authorized supplied BrowserContext or storage state was available. Browser credentials were not extracted.

The deterministic lifecycle evaluator is not an independent agent skill experiment. Skill execution remains explicitly untested, with no quality score or causal claim. Mobile verification uses viewport emulation, not physical hardware. The new CLI mode is verified in an unpublished local candidate. Deployment and npm publication were outside scope. No required independent code-review gate remains unresolved. The final cross-model trail review is recorded in reviews.md. Its remaining evidence limit is that the production browser observations have no replayable raw files or exported transcript. Root-transcribed judgment records retain received reviewer verdicts without claiming to be a session export.

## Principles and choices

- Fix Root Causes required the deployed reproduction and native/debugger comparison before application changes.
- Prove It Works required actual installed processes, real panel frames, exact bytes, and an independent rerun.
- Model the Domain kept read output in one validated boolean and evaluation outcomes in a discriminated result type.
- Build the Lever produced the rerunnable local lifecycle evaluator.
- Separate Before Serializing Shared State produced independent consumers, identities, databases and state. Dependent cleanup runs in order.
- Laziness Protocol kept the existing file writer and diagnostic tools instead of adding a receipt format, endpoint, or telemetry.
- Foundational Thinking put provenance and isolated fixtures before lifecycle actions.
- Sequence Work into Verifiable Units kept preview, CLI, guidance, and evaluation in checked units and reviewable commits.
- Never Block on the Human kept reversible implementation choices within the approved scope.
- Encode Lessons in Structure put bounded output and new-directory packaging guards into executable behavior rather than repeated warnings.
- Test Behavior, Not Implementation required subprocess results, actual committed history, and complete historical bytes.

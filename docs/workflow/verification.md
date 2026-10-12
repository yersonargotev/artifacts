# Verification record

## Baseline

The original branch passed 47 unit tests and the disposable panel preview recipe in Chrome 154. The recipe exercised revision selection, interaction, and a 390 px layout. Its private evidence is in `.test-artifacts/verify-artifacts/workflow-baseline/preview/`.

## Review corrections

Independent review accepted the contracts and prepared-edit helper. It found misleading owner-only publication copy and a self-comparison selector. New Chrome assertions reproduced both problems before correction.

The integrated legacy fixture initially retained new publication markers because it replaced only a literal `<main>` tag. Three browser contracts failed. The fixture now removes the actual opening tag attributes before inserting intentional markers. The existing rejection assertions remain unchanged, and all 17 cases pass.

A local retained proof startup overlapped a Workers build that replaced Astro's Node output. The proof correctly failed on the Cloudflare-only entry. The final browser checks and Workers build run sequentially.

## Deployed saved revision

The retained verifier passed for artifact `e94d77bf-94ac-4395-ba8f-a6df562f7e2b`, revision `15ad41da-be64-4911-a18a-d5f7fa6a712c`, publication version 1. Chrome 154 checked the actual authenticated panel and protected publication at 1280 by 900 and 390 by 844.

It compared the actual preview body, exact exported ZIP, publication srcdoc, and both attachment byte sequences. It exercised the calculator's personal and scale presets and the December logs tariff. It checked publication state before and after. Browser requests used GET only. A final MCP read confirmed the same retained snapshot and publication.

This run proves the saved artifact on the current deployment. It does not claim that the new panel features are deployed. Its private report is `.test-artifacts/workflow-cloud/cost-revision-1/result.json`.

## Local product proof

The retained application proof uses real migrated local services and the built Astro panel. It compares artifact, revision, publication, receipt, user, and session rows before and after verification. Setup creates disposable fixtures before that read-only interval. Evidence stays in `.test-artifacts/verify-artifacts/retained-*/`.

The final sequential checks passed. `pnpm check` reported no errors. `pnpm test` passed 57 tests. `pnpm test:browser` passed identity, panel review and publication, network containment, all 17 retained-verifier contracts, and the actual retained application proof. `pnpm build:workers` compiled all four services after the browser suite completed. This compilation does not prove the new behavior in the deployed Worker runtime.

Browser contracts run in the existing Chrome CI job. Unit tests do not require Chrome. The final independent diff and decision-trail review found no material compatibility or security blockers. Private reports and screenshots are excluded from the PR; the executable proofs and this record remain in the repository.

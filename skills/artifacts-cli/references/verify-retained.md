# Verify the saved revision in the panel

Use the successful create, update, or edit result and an independent full read to select the exact saved revision. Use an authorized browser session to inspect its real panel and, when requested, its protected publication. Preparation alone does not prove persistence or browser behavior.

## Retain the authoring results

Before the authorized write, use `umask 077` and save successful stdout to a new private receipt file. For example, add `> write-result.json` to the create or update command you already intend to run. Keep stderr and the retained request ID for recovery. Continue only after exit zero. Do not repeat a write to obtain a receipt after an uncertain response. Follow [retry recovery](commands.md#retry-and-export).

If publication was requested, also retain the successful publish stdout as `publish-result.json`. Finish that authorized publication before the independent read below. Do not publish, share, or revoke access merely to verify an artifact.

## Prepare the exact selection

Use Node 24+ and a CLI whose help lists `skills path` and `read --quiet`. For older read output, use the [stdout fallback](commands.md#create-a-complete-snapshot). The installed helper requires only Node built-ins. It makes no service request and does not open a browser.

Set `observed_panel_origin` to the panel origin observed in the authorized browser or supplied service configuration. Do not derive it from `ARTIFACTS_SERVER` or the publication host. Replace the example origin before execution.

```sh
umask 077
observed_panel_origin=https://panel.example.test
skill_directory=$(artifacts skills path artifacts-cli)
artifact_id=$(node -e '
try {
	const id = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).artifactId;
	if (typeof id !== "string" || id.length === 0) throw new Error();
	process.stdout.write(id);
} catch {
	console.error("Cannot extract the artifact ID from the write receipt");
	process.exitCode = 1;
}
' write-result.json)
revision_id=$(node -e '
try {
	const id = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).revision.id;
	if (typeof id !== "string" || id.length === 0) throw new Error();
	process.stdout.write(id);
} catch {
	console.error("Cannot extract the revision ID from the write receipt");
	process.exitCode = 1;
}
' write-result.json)
artifacts read "$artifact_id" --revision "$revision_id" --response full --out saved-read.json --quiet
```

Stop if any extraction or read fails. A compact write receipt can select a revision. The independent read must contain the complete snapshot. Compare its complete metadata, content, and decoded attachment bytes with the intended snapshot. For an update, check the saved parent against the head used to prepare that update.

Save `checks.json` with the requested viewport sizes and meaningful expectations for this document. Replace the example selectors and values with intended content behavior. Expectations run in order inside the content iframe after a fresh load at each viewport.

```json
{
	"viewports": [{ "width": 1440, "height": 900 }, { "width": 390, "height": 844 }],
	"expectations": [
		{ "kind": "text", "selector": "#total", "text": "5.00" },
		{ "kind": "click", "selector": "#change" },
		{ "kind": "text", "selector": "#total", "text": "28.40" }
	],
	"timeoutMs": 10000
}
```

Use `text` for exact rendered text, `visible` for visibility, `count` for an element count, or `attribute` for an exact attribute value. Use `name` and `value` with `attribute`. Interactions also support `fill` with `value`, `check` with `checked`, and `select` with a `values` array. Do not use arbitrary JavaScript or target panel controls in these expectations.

Prepare a new private config with a future evidence directory that does not yet exist.

```sh
node "$skill_directory/scripts/prepare-retained.mjs" \
  --receipt write-result.json --read saved-read.json \
  --panel-origin "$observed_panel_origin" --checks checks.json \
  --evidence "$PWD/new-retained-evidence" --out retained-config.json
```

When publication was requested, add `--publication-receipt publish-result.json` to that invocation. The helper compares its artifact, revision, version, and URL with the current publication in the saved read. A different publication or concurrent change fails preparation. Report the difference. Do not replace expected versions or publish again to make verification pass.

The helper derives all selected IDs and URLs from these inputs. It accepts a newer draft head while keeping the saved revision pinned and reports `headChanged: true`. It emits `status: "prepared"`, never a verification pass. Without a publication receipt, it omits publication coverage even when another revision is published. Existing output files are preserved.

## Inspect with an authorized browser

This route works with the installed CLI, its bundled files, and browser-control capabilities. It requires no repository checkout. Use a user-supplied session or complete the normal sign-in flow. CLI OAuth login does not supply panel cookies. Keep browser authentication inside the browser. Never extract credentials to construct a Playwright context or state file.

After sign-in setup, perform these read-only checks on the selected artifact. Do not create revisions, publish, share, log out, or revoke sessions. Normal protected-viewer admission can consume its one-use grant through the existing GET handoff.

1. Read `retained-config.json` privately and open its exact `panelUrl`. Compare the artifact, revision, digest, and publication version with `expected`. Current panels expose `data-artifact-id`, `data-revision-id`, `data-revision-sha256`, and `data-publication-version`. Version zero means no publication. Report a newer head separately. Never switch the selected revision to the head.
2. Establish the actual browser version and available frame, response, console, download, and viewport controls. Record missing capabilities. A browser name, load event, or empty console does not establish that content loaded.
3. Inspect the actual preview iframe source, pinned revision, sandbox, referrer policy, and dimensions. Wait for a distinctive expected element within the configured deadline. Exercise each authorized content control and record the resulting visible state. Repeat at each available requested viewport and check keyboard interactions and overflow where relevant.
4. When response inspection or native DevTools is available, inspect the iframe request. Record completion, status, content type, CSP, connection allowlist, cache policy, and DNS policy. Distinguish interactive content, inert fallback, and error responses. A pending request has no final response evidence. A top-level preview navigation deliberately returns 403 and cannot replace this iframe check.
5. When the config includes `publicationUrl`, open that separate protected viewer through normal admission. Compare its selected revision, digest, and version with `expected`. Observe the real content and repeat the authorized interactions. Open `Archivos` and compare the complete attachment inventory and revision-bound links. Check protected download bytes when that capability is available. Missing attachment or response evidence remains unavailable.
6. After publication interactions, reread the same explicit revision with the quoted IDs into a new private file. Compare its current `publication.revisionId`, `version`, and `url` with the saved read and publish receipt. Reload the selected panel and compare its publication markers again. Report a changed publication as a concurrent change. Do not report protected-publication success for a different selected revision.
7. If the frame is blank, distinguish admission, pending transport, policy, browser compatibility, content execution, and browser-control failures from observed evidence. If debugger attachment stalls it, disconnect through normal browser controls, reload the same pinned page, and repeat the interaction with native controls. Preserve authentication and containment. Attribute a debugger failure only when that comparison demonstrates it.
8. Save a sanitized report and private screenshots. Include selected IDs, digest, browser version, viewport sizes, actions, resulting visible states, observed response policies, and unavailable checks. Exclude cookies, tokens, viewer grants, callback queries, raw authentication requests, and private content from diagnostic logs.

This is partial browser verification. Do not return the complete verifier's pass verdict. Missing exact bytes, ZIP, policy, attachment, console, or viewport evidence must remain explicit.

## Run the existing complete verifier when available

The CLI package does not install Playwright, `tsx`, Chrome, or the repository's verifier and rendering-policy modules. Complete automated verification needs an operator-provided installation of that existing verifier with its dependencies and actual supported Chrome. It also needs an explicitly supplied authenticated Playwright `BrowserContext` or owner-private storage-state file prepared through an approved sign-in flow.

For repository operators, run this command from the repository root. The paths in this command are repository capabilities, not paths inside an installed CLI package.

```sh
node --import tsx .agents/skills/verify-artifacts/scripts/verify-retained.ts \
  --config /private/path/retained-config.json \
  --storage-state /private/path/browser-state.json
```

Pass the prepared config unchanged. The existing verifier validates the full schema and canonical snapshot hash. It checks pinned responses, markers, policies, interactions, ZIP, attachment bytes, viewports, and publication state before and after viewer checks. It writes private evidence and fails on mismatches or concurrent publication changes. Use its callable `verifyRetainedArtifact(context, config)` when an authorized context is supplied. Do not build another viewer or weaken sandbox policies to establish deployed behavior.

If this runtime or authenticated input is unavailable, use the partial route above and name that limit. If browser access is unavailable too, report only the persistence checks actually completed.

## Deliver the observed outcomes

Report each outcome separately, with its evidence and missing checks.

| Outcome | Evidence needed |
| --- | --- |
| Persistence | Full independent explicit-revision read and complete intended-snapshot comparison. Name any exact export check separately. |
| Local rendering | Observed local document layout and interactions. This does not prove hosted rendering. |
| Panel rendering | Exact real panel selection, pinned iframe, visible content, and observed interaction. Name missing response, policy, byte, console, or viewport checks. |
| Protected publication | Separate authorized viewer admission for the selected published revision, visible content, interactions, and attachment checks. Report concurrent changes and unavailable checks. |

Use `passed`, `failed`, `unavailable`, or `not requested` for each outcome as the evidence permits. Keep session identifiers and private evidence private. A successful helper invocation establishes only input preparation.

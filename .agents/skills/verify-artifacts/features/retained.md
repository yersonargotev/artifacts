# Exact retained artifact

Use this recipe when the artifact already exists and the task is to prove its saved revision through the actual panel and protected publication. Retain a full independent `artifacts_read` result before browser verification. Compact reads do not contain the snapshot bytes needed for this proof.

## Configuration

Save a private JSON configuration. `expected` is the full saved `ArtifactRead`, including complete metadata, content and attachment data. `panelUrl` must contain exactly one `revisionId` query parameter and select that saved revision. `publicationUrl`, when supplied, must equal the saved stable publication URL and the selected revision must be the published revision.

```json
{
  "expected": "Replace this value with the full saved ArtifactRead object",
  "panelUrl": "https://panel.example.test/artifacts/ARTIFACT_ID?revisionId=REVISION_ID",
  "publicationUrl": "https://viewer.example.test/a/ARTIFACT_ID",
  "viewports": [{ "width": 1280, "height": 900 }, { "width": 390, "height": 844 }],
  "expectations": [
    { "kind": "text", "selector": "#total", "text": "5.00" },
    { "kind": "click", "selector": "#change" },
    { "kind": "text", "selector": "#total", "text": "28.40" }
  ],
  "evidenceDirectory": "/private/path/new-retained-evidence",
  "timeoutMs": 10000
}
```

The evidence directory must not exist. The verifier creates it with mode `0700`. Evidence files use mode `0600`. The CLI requires storage state private to its owner. Keep that state outside evidence. Authentication belongs to the supplied context. Prepare it through the existing approved sign-in path before running this recipe.

Expectations execute in order inside the actual content iframe. Each page and viewport starts from freshly loaded retained content. They cannot target panel controls or run supplied JavaScript.

| Kind | Required fields | Observed behavior |
| --- | --- | --- |
| `text` | `selector`, `text` | Exact rendered `innerText`, with bounded waiting |
| `count` | `selector`, `count` | Exact matching element count |
| `visible` | `selector` | Element becomes visible |
| `attribute` | `selector`, `name`, `value` | Exact attribute value, or absence when `value` is null |
| `click` | `selector` | Click the content control |
| `fill` | `selector`, `value` | Fill the content input |
| `check` | `selector`, `checked` | Set the content checkbox or radio state |
| `select` | `selector`, `values` | Select exact option values |

Unknown configuration fields and expectation kinds fail at the boundary. Viewport dimensions must be integers from 240 to 7680. `timeoutMs` is optional and must be 100 to 60000. The saved snapshot SHA-256 must match its revision before the verifier opens a page.

## Entry points

```sh
node --import tsx .agents/skills/verify-artifacts/scripts/verify-retained.ts \
  --config /private/path/retained-config.json \
  --storage-state /private/path/browser-state.json
```

The callable form accepts an already authenticated Playwright `BrowserContext`.

```ts
import { verifyRetainedArtifact } from './.agents/skills/verify-artifacts/scripts/retained.ts';

const report = await verifyRetainedArtifact(context, config);
if (report.status !== 'passed') throw new Error(JSON.stringify(report.errors));
```

The CLI launches installed actual Chrome without flags that relax security. The library uses the supplied context and current browser user agent. The application's supported-browser decision determines interactive or inert document bytes. Console errors, page errors, attempted non-GET/HEAD/OPTIONS browser requests, content navigation, overflow, policy changes or byte mismatches fail verification. Viewer-grant admission through the existing GET redirects is allowed.

## Exact evidence

The verifier requires one complete wrapper marker set when any exact-state marker appears. It compares `data-artifact-id`, `data-revision-id`, `data-revision-sha256` and `data-publication-version`. Version `0` identifies no publication. Partial or duplicate marker sets fail; they cannot select legacy proof.

On a legacy panel, the selected revision ID, digest and sequence must match. The real iframe must request the exact pinned preview URL under iframe-only admission. Its response must equal the document rendered from the independently saved snapshot. The selected browser download must match the deterministic expected export, including exact canonical manifest, content bytes and every attachment byte. Extra or missing ZIP members fail.

On a marker-free publication, the saved unique revision sequence must match. Current publications load `/a/<artifactId>/r/<revisionId>/content`; the verifier checks the actual iframe response URL, bytes, CSP, connection containment, and cache policy. Older publications use exact iframe `srcdoc` with the corresponding legacy wrapper policy. Every displayed attachment link must bind the expected artifact, revision and normalized file path. The complete inventory and protected bytes must match. An empty inventory still requires matching sequence and content bytes. The trusted home link is separate from the attachment download inventory.

The verifier independently reloads the selected panel before and after publication checks to compare publication version and the selected published revision. A moving publication fails. The actual panel and viewer frames retain their CSP, containment headers, sandbox and referrer policy. Wrapper and content frame overflow must pass at every configured viewport. On the native viewer shell, the verifier captures the closed header, opens `Archivos` before checking visible attachment inventory, then opens `Información` as well. With both disclosures open, the bounded header must leave at least 55 percent of the viewport for the iframe. Legacy shells without disclosures retain their existing exact checks.

`result.json` records status, exact identities, browser version, interaction support, viewport evidence mode, attachment hashes, sanitized browser request paths and errors. It states `publication: "not-requested"` when publication coverage was omitted. Screenshots and ZIPs remain private retained-content evidence. No raw state, trace or callback query credentials are copied.

## Rerunnable local proof

```sh
node --import tsx --test tests/retained-verification.test.ts
node --import tsx --test tests/retained-verification.browser.proof.ts
pnpm build
node --import tsx tests/retained-browser.proof.ts
```

Contract fixtures exercise both marker-rich and supported legacy formats. They deliberately return a wrong revision, partial markers, altered content bytes, unpinned preview or publication content URLs, changed ZIP or attachment bytes, wrong attachment binding, false content expectations, mobile overflow and a moving publication. These are verifier boundary tests, not evidence of product authoring.

The application proof uses the existing migrated fixture and actual built Astro panel plus publication handler. Setup creates a disposable owner, two retained revisions, one publication and an authenticated browser. Verification selects the historical published revision while the head is newer. After verification, the proof compares artifact, revision, publication, receipt, user, central session and panel session rows. It records only counts and equality results in `no-mutations.json`. The unchanged rows and GET-only browser log establish the read-only verification phase. Disposable setup remains outside that phase.

The local proof does not establish deployed Worker behavior or client authoring. Run the same retained entry point with the independent saved cloud read and preauthenticated private state to establish those exact deployed browser paths. Existing disposable `control.ts` recipes remain unchanged.

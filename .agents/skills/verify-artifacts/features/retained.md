# Exact retained artifact

Use this recipe when the artifact already exists and the task is to prove its saved revision through the actual panel and protected publication. Retain a full independent read from `artifacts_read` or the installed CLI before browser verification. Compact reads do not contain the snapshot bytes needed for this proof.

## Partial browser-control verification

Use this route when the available authenticated tab exposes browser controls but no supplied Playwright `BrowserContext` or private storage state. Inspect only the authorized retained artifact. Keep authentication inside the browser and use its normal sign-in path if needed.

1. Open the exact selected panel URL with one `revisionId`. Compare the selected artifact, revision, digest, and publication version with the independent saved read. Current panels expose `data-artifact-id`, `data-revision-id`, `data-revision-sha256`, and `data-publication-version`. Record any changed publication state separately from immutable revision identity.
2. Establish the actual browser version and available capabilities. Record whether frame locators, console logs, response inspection, downloads, viewport controls, or native browser UI are available. A product name or empty console does not establish compatibility or successful loading.
3. Inspect the actual iframe source, pinned revision, dimensions, sandbox, and referrer policy. Wait for a distinctive content element within a stated deadline. Exercise an authorized content control and record its resulting visible state. Use the available viewport controls for requested sizes and keyboard controls for affected interactions. Mark each inaccessible check unavailable.
4. Inspect the real iframe request when the browser exposes network evidence. Native DevTools is an alternative when the connector lacks response APIs. Record pending or completed state, final status, content type, CSP, connection allowlist, cache policy, and DNS policy. Check whether the response is interactive content, an inert fallback, or an error. A direct top-level preview navigation receives deliberate 403 iframe-only admission and cannot replace this check.
5. If the frame stays blank, distinguish admission, pending transport, response policy, browser compatibility, content execution, and browser-control failures using the available evidence. A pending request has no final response status or body. A load event or empty error log alone proves none of these boundaries. Keep checks with missing evidence unavailable rather than passed.
6. If the debugger attached by browser control stalls the frame, compare with native controls. Disconnect that debugging session through the browser's normal control, reload the same pinned panel, and repeat the content interaction. Record both observed states. Use native controls or an independently supplied-context verifier if reconnecting automation reproduces the stall. Preserve authentication and containment settings. Attribute the failure to the control boundary only when this comparison demonstrates it.
7. Retain a sanitized report and private screenshots where supported. Include identities, version, requested viewports, actions, resulting state, observed response evidence, unavailable checks, and the outcome table below. Retain header values from an explicit policy allowlist. Exclude cookies, tokens, viewer grants, callback queries, reporting URLs, raw authentication requests, and raw private content from diagnostic logs.

| Outcome | Required evidence |
| --- | --- |
| Persistence | Independent full explicit-revision read and complete snapshot comparison. Exact export additionally requires ZIP and manifest verification. |
| Local rendering | Observed standalone document interactions. This does not establish the hosted sandbox. |
| Hosted rendering | Selected real panel, pinned frame, visible content, and observed interaction. State missing response, policy, byte, viewport, or console checks beside this partial result. |
| Protected publication | Separate authorized protected-viewer admission, selected published revision, visible frame, and attachment checks. Omit publication when unauthorized or not requested. |

Use the supplied-context verifier below for the complete exact-byte, policy, attachment, ZIP, and viewport proof. An authenticated tab cannot be converted to that input by extracting browser credentials. Without an authorized supplied context or state, those complete checks remain unverified. The existing markers, frame attributes, and native network inspection form the diagnostic mechanism. Add no endpoint or telemetry merely to fill an unavailable capability.

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

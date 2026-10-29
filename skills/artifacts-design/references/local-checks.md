# Check local HTML before saving

Run the helper after embedding fonts and before the calling skill's create or update operation.

```sh
design_skill=$(artifacts skills path artifacts-design)
node "$design_skill/scripts/verify-local.mjs" page.html --evidence ./page-evidence
```

The helper needs Node 24+, an existing `playwright` or `playwright-core` package, and Chrome or Chromium 152+. It resolves the package from the current project first, then from its own installation. It tries existing Playwright browser binaries and system executables. To select an existing browser explicitly, add `--browser /absolute/path/to/chromium`. An explicit selection does not fall back to another executable.

Missing dependencies, incompatible versions, and launch failures produce actionable diagnostics. The helper never installs software, downloads a browser, disables browser sandboxing, or relaxes document policies.

## Describe controls

Add `--expectations checks.json` to replay actions and assert their results. Each matrix case starts with a fresh document. Steps run in order. A failed step ends that case's sequence because later steps may depend on it. The remaining cases still run.

```json
{
  "expectations": [
    { "kind": "visibleCount", "selector": ".mobile-map, .desktop-map", "count": 1 },
    { "kind": "visible", "selector": ".mobile-map", "visible": true, "when": { "width": 375 } },
    { "kind": "visible", "selector": ".desktop-map", "visible": true, "when": { "width": 1280 } },
    { "kind": "text", "selector": "#total", "text": "5.00" },
    { "kind": "click", "selector": "#calculate" },
    { "kind": "text", "selector": "#total", "text": "28.40" },
    { "kind": "press", "selector": "#reset", "key": "Enter" },
    { "kind": "text", "selector": "#total", "text": "5.00" }
  ]
}
```

Every step requires `kind` and a Playwright locator `selector`. Optional `when` limits it to `width` of 375 or 1280, `theme` of `light` or `dark`, or both. Unknown fields and malformed values fail configuration validation.

| Kind | Additional fields | Observable result |
| --- | --- | --- |
| `text` | `text`, a string | Exact inner text of one element. Add a `visible` check when visibility is required. |
| `count` | `count`, a nonnegative integer | Number of matching elements. |
| `visible` | `visible`, a boolean | Visibility of exactly one matching element. A missing element fails. |
| `visibleCount` | `count`, a nonnegative integer | Number of visible matches. Use one selector matching both responsive variants to assert exclusivity. |
| `attribute` | `name`, a nonempty string, and `value`, a string or `null` | Exact attribute value. `null` requires absence. |
| `click` | None. | Real pointer activation. |
| `press` | `key`, a Playwright key string such as `Enter`, `Space`, or `Tab` | Keyboard input to the selected element. |
| `fill` | `value`, a string | Input or textarea edit. |
| `check` | `checked`, a boolean | Checkbox or radio state. |
| `select` | `values`, an array of strings | Selected option values. |

Assertions poll for their expected result. Actions wait for Playwright's actionability checks. The JSON document accepts at most 100 steps and an optional `timeoutMs` from 100 to 30000. Its default is 3000 ms per expectation. With no expectations file, the helper checks rendering and errors but does not infer the document's intended controls.

Each variant also has a total deadline of `timeoutMs * (step count + 1)`, bounded between 10 and 60 seconds. The deadline includes loading, checks, captures, and final observations. If the renderer stops responding, the helper closes that variant's context, records `deadline.exceeded`, and marks its remaining evidence incomplete. The other variants still run. A deadline failure cannot pass the automatic checks.

## Inspect the evidence

The helper creates a fresh `local-*` subdirectory under `--evidence`. It writes `report.json`, `index.md`, and PNG images. Repeated runs keep separate evidence.

The fixed matrix is 375 and 1280 px wide at 900 px high, each in light and dark. Every case checks document overflow before and after its scenario, runtime exceptions, error console entries, and forbidden resource attempts. CSP violations include resource attempts blocked before a browser request occurs. Initial and final captures scroll the actual iframe in viewport-sized steps. Each phase saves at most 12 tiles. Capture records include actual scroll offsets and mark incomplete coverage in `captureCoverage.truncated`.

The document runs in an opaque-origin iframe with `sandbox="allow-scripts"`. Its response uses the Artifacts preview CSP, `Connection-Allowlist: ()`, and disabled DNS prefetching. Fonts, images, and media must be embedded as `data:` URIs. Network connections, remote scripts, frames, objects, forms, and workers remain blocked. The local server exposes only the generated wrapper and content, without arbitrary filesystem access. Browser request routing also denies other destinations.

The report records the chosen executable, version, user agent, rejected browser candidates, source hashes before and after verification, actual content response policy and hash, per-case checks, errors, and screenshots. It identifies the evidence as **renderizado local** and leaves `authenticatedPublication` as `not-verified`. It does not modify the HTML, save a revision, publish, or contact the Artifacts service. No service credentials are required.

| Exit code | Meaning |
| --- | --- |
| 0 | Automatic checks passed. Visual review remains required. |
| 1 | An automatic check failed. |
| 2 | Setup or configuration blocked the run. |

A structured blocked report is written when a valid evidence destination is available. The helper prints the report as JSON on standard output.

Read the screenshots and the [interface checks](interface-checks.md) before accepting the design. Check content fidelity, reading order, labels, focus, alignment, density, and both themes. A clean console cannot establish those judgments. Each run observes load, font readiness, its declared interactions, and a short settling period. Delayed behavior beyond the run and content outside captured coverage require further inspection. Verify the retained revision and protected publication separately through the service workflow after saving.

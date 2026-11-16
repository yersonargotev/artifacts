# Error monitoring

Status: accepted on 2026-11-16. Rollout steps 2, 3, and 4 are implemented.

Production has no error monitoring and no alerts. The four Workers write to Workers Observability, which the operator reads with `pnpm exec cf o11y telemetry query`, and the release runs a read-only smoke once after deployment. A failure between releases surfaces only when someone notices it.

Worse, the code hid unexpected errors. Before rollout step 2, each of these paths caught an unknown error, returned 503 or `unavailable`, and logged nothing:

- `apps/auth/src/worker.ts`, around the runtime and the auth handler.
- `apps/mcp/src/worker.ts`, around the runtime and the resource app.
- `apps/mcp/src/http.ts`, in `execute`, for any error that is not an `ArtifactError`.
- `packages/rest/src/index.ts`, in the route handler's final branch.
- `packages/rest/src/identity.ts`, when token introspection fails.
- `apps/publication/src/http.ts`, the view handler's final branch. Rollout step 3 added this path after a review found it.

A broken database connection, a bad migration, or a bug in the store therefore looked like a clean 503 in Workers Observability, with no message and no stack.

## Decision

Report errors to Sentry with `@sentry/cloudflare` from all four Workers: `artifacts-auth`, `artifacts-api`, `artifacts-panel`, and `artifacts-view`. Workers Observability stays the source for logs and CPU. Sentry owns error grouping, stack traces, and alerts.

Sentry was chosen over the alternatives.

- Grafana would need Logpush or an OTLP export, and dashboards and alert rules on top. It adds a metrics stack the project does not need, and it still would not group errors or symbolicate stacks.
- A self-built alert Worker, a cron that queries the Workers Observability Telemetry API and sends email through Resend, costs about 200 lines and no vendor. It can count 5xx responses, but it cannot show which error caused them or where. It remains a reasonable later addition for uptime checks.

### Report the hidden errors

The swallowed paths above report the error before they return their current response. Response bodies and status codes do not change, so no client contract changes.

The packages stay independent of Sentry. `createResourceApp` and the REST handler take an optional `reportError(error: unknown): void` option. Each Worker entry passes `Sentry.captureException`. The Node servers pass a function that calls `console.error`, so local runs also stop hiding these errors. `ArtifactError`, `HttpFailure`, and Zod validation errors are expected outcomes and are never reported. An error is expected when the adapter maps it to a client error. The MCP tools map only `ArtifactError`, so any other error there, a Zod error included, becomes `unavailable` and is reported. The bearer authorizer reports every `unavailable` decision, which covers a failed JWKS fetch, a failed introspection request, and an introspection response with an unexpected status or body.

Each Worker entry wraps its handler with `withMonitoring` from `packages/monitoring`, the only package that imports `@sentry/cloudflare`. It calls `Sentry.withSentry`, which also captures errors that escape the handler. Without `SENTRY_DSN`, `withMonitoring` calls the handler directly, so Sentry adds no work and no `waitUntil` task. The Workers' `reportError` calls `console.error` and `Sentry.captureException`, so Workers Observability keeps the log line. The panel uses `@sentry/cloudflare` too. `@astrojs/cloudflare` 14 lets the Worker name its own entry point, and its default entry is only `{ fetch: handle }` from `@astrojs/cloudflare/handler`. So `apps/dashboard/src/worker.ts` wraps `handle` with `withMonitoring`, like the other Workers, and `apps/dashboard/src/middleware.ts` reports the error behind its 503 page.

A spike on 2026-11-16 compared this with `@sentry/astro` 11.10.0.

- `@sentry/astro` needs `@sentry/cloudflare` as well. Its build failed until the panel depended on both, because its Cloudflare entry imports `@sentry/cloudflare`.
- It adds a 94 KB gzip browser script with Session Replay code to the panel's pages. Browser reporting is out of scope, and the panel's `connect-src 'self'` policy would block that script from sending events.
- Its server bundle was 735 KB gzip against 691 KB for the custom entry point.

`pnpm test:panel-monitoring` builds the panel Worker and runs it in workerd through Miniflare, with outbound requests captured. A failed startup returns the same 503 page and sends one event tagged `artifacts-panel` with no cookie, token, query value, or email address. Without a DSN, nothing is sent.

### Keep user data out of Sentry

Artifacts hold the owner's private documents, and requests carry session cookies, bearer tokens, share grants, and publication cookies. Sentry receives none of them.

- `dataCollection` turns off user info, cookies, request bodies, query parameters, response headers, database query data, and stack frame variables, and keeps only the `user-agent` and `cf-ray` request headers. SDK 11 replaced `sendDefaultPii` with this option.
- `beforeSend` removes the request body, cookies, the query string, and every header except `user-agent` and `cf-ray`. It drops console breadcrumbs and breadcrumbs with request or response bodies.
- `beforeSend` also rewrites every string in the event. It removes the query from absolute and relative URLs, replaces `Bearer` and `Basic` credentials with `[token]`, replaces every email address with `[email]`, and replaces the bound values of a failed Drizzle query, which follow `params:` in its message, with `[redacted]`. It walks the event as data, so a quoted URL cannot break the event.
- The SDK's console integration is off. `reportError` calls `console.error` for Workers Observability, and that integration would copy the raw error into a breadcrumb.
- The user context holds only the opaque user ID, never the email address.
- Error messages from the store must not embed artifact content. The current `ArtifactError` messages already meet this, and they are not reported anyway.

A unit test passes a synthetic event with each sensitive field through `beforeSend` and asserts that none survives.

### Configure releases

Events go to the `artifacts` project in the `sparkydevs` organization, in the US region, with platform `node-cloudflare-workers`. The four Workers share that project and set a `service` tag with the Worker name.

`SENTRY_DSN` is a text binding in each Worker's `cloudflare.config.ts`, declared next to the service origins in `scripts/cloudflare.ts`. A DSN only allows sending events, and Sentry documents it as safe to publish, so it does not belong in `ARTIFACTS_RUNTIME_SECRETS`, and the runtime secret contract does not change. The Node servers do not read these configurations, and Sentry stays off without a DSN, so local runs and tests send nothing. Anyone could use the public DSN to spend the event quota. If that happens, rate-limit the key in Sentry or rotate it.

`scripts/build-workers.ts` turns on esbuild source maps. The release uploads them with `sentry-cli` under the release name `artifacts@<git SHA>`, then deletes them from the bundle before deployment, so the deployed Worker does not serve them. The upload uses a `SENTRY_AUTH_TOKEN` environment secret in GitHub, scoped to release and source map upload only. A failed upload fails the release before any deployment.

`environment` is `production`. The options set no `tracesSampleRate` and no `tracesSampler`, so tracing is off and Sentry records errors only. A rate of `0` would still enable tracing, and a client's sampled `sentry-trace` header would then make the Worker send spans that skip `beforeSend`. With tracing off, the project stays within the 5,000 errors per month of the organization's Developer plan. Tracing can be enabled later if Workers Observability is not enough for latency.

### Alert

Two issue alert rules email the owner. `New or regressed issue` fires on a first-seen or regressed issue, at most every 5 minutes. `Issue above 10 events per hour` fires when an issue exceeds 10 events in an hour, at most hourly. The project also keeps Sentry's default rule for high-priority issues. The operator triages issues in Sentry and links the GitHub issue from there.

## Rollout

1. Done on 2026-11-16: the Sentry project, the alert rules, and the org auth token `artifacts-ci-release` with the `org:ci` scope, stored as the `SENTRY_AUTH_TOKEN` secret in the GitHub `production` environment.
2. Add `reportError` to the MCP app and the REST handler, and report from the five swallowed paths. Ship this first with the Node `console.error` reporter and `console.error` in the Workers too, so Workers Observability shows the errors before Sentry exists.
3. Add `@sentry/cloudflare`, `withSentry`, `beforeSend`, and the scrub test to auth, MCP, and view.
4. Run the panel spike and wire the panel.
5. Add source maps and the upload step to the release.
6. Prove one deliberate error per Worker in production, or a disposable deployment, appears in Sentry with a symbolicated stack and with no cookie, token, body, or email address.

## Out of scope

- Browser error reporting in the panel. The panel renders on the server and ships little JavaScript.
- The CLI. It runs on the owner's machine and prints its errors.
- Uptime checks and latency alerts. The self-built cron Worker above can add them later.

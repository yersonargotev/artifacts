# Rationale

## Problem
The first increment establishes one durable identity across a standalone authorization app, an HTTP MCP resource, and an Astro OIDC dashboard. The difficult invariant is immediate global revocation despite locally verifiable access tokens and independent browser cookies. Vendor/runtime choices are fixed by the brief. This candidate changes only code organization.

## Usage (caller's view)
The three call sites at the start of `sketch.md` are the contract. Each endpoint asks its local identity boundary for one complete operation. A tool receives a verified principal. A page receives a verified principal. An authenticated revocation route supplies only the current canonical user ID.

## Shape
App-local modules own different trust boundaries, per boundary-discipline. MCP owns token plus authenticated introspection validation; dashboard owns OIDC and browser sessions; auth owns session issuance and revocation. Pure parsing and decision functions stay beside each module's asynchronous boundary. `packages/db` supplies schema and a client, without turning persistence into a policy framework.

The principal and result union expose only successfully verified identity or a complete failure category, per model-the-domain and type-system-discipline. Each app constructs its own principal only after its protocol boundary succeeds. Email has no identity role. Shared vendor tables remain derived from the provider's actual schema.

The interface hides JWT/OIDC details, remote failures, and durable state behind one authorization operation per consuming app, per minimize-reader-load. The normal request crosses endpoint, identity module, and provider/database. There is no generic ports/adapters registry or shared policy engine. Protocol scope names are intentionally repeated only where they have different responsibilities; integration tests check tool requirements against issuer discovery.

A panel-to-central-session foreign key makes revocation structural. Auth deletes central sessions and the database deletes dependent panel rows. Retrying the command cannot restore access, per make-operations-idempotent. Callback races cannot create a panel row referencing a deleted session. Reads still check absolute expiry because expiration alone does not trigger a cascade.

## Synthesis decision
Pending parent comparison. This runner recommends the app-local shape as its base because the applications authenticate through different protocols and have only one MCP bearer consumer today.

## Tradeoffs accepted
- We accept app-local identity types in exchange for independently understandable trust boundaries and no public shared policy surface.
- We accept a dashboard read dependency on the provider session schema in exchange for one query per request, structural global revocation, and no panel-to-auth availability dependency.
- We accept one introspection round trip per protected MCP request in exchange for immediate central-session revocation.
- We accept dedicated cross-app integration tests in exchange for keeping runtime modules free of a premature shared policy framework.

## Alternatives considered
A shared functional identity-policy package hides token/session invariant evaluation centrally, but exposes adapters and shared intermediate models to every app. It provides more depth once several resources validate the same credential. Here the dashboard and MCP consume different evidence, so it creates coordination without removing protocol work.

An auth session-status RPC for every dashboard request hides the provider schema, but adds service authentication, a wire contract, and another outage path. Shared libSQL is already settled, and the live join plus foreign key satisfies the current requirement with fewer moving parts.

## Open questions and risks
Can the pinned provider's actual sid and introspection hooks support this exact central-session gate without a parallel OAuth implementation? Does actual generated Drizzle schema plus local/remote libSQL enforce the cascade and callback race as designed? Which CLI protocol version works with both installed clients? These are implementation evidence gates, not user preference questions. Does the upstream refresh-family race change in a later provider release? Keep a named regression test and dependency note until verified upstream resolution.

## Next implementation step
Generate the actual provider schema and build one vertical proof from bootstrap to PKCE token, live authenticated introspection, MCP `whoami`, and central-session deletion.

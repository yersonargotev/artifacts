# Artifacts contracts

`@yargote/artifacts-contracts` contains strict domain schemas, types, `ArtifactError`, snapshot serialization, and pure retained-edit helpers. It has no database, ZIP, server, or CLI dependency. Node 24 or later is required.

```sh
npm install @yargote/artifacts-contracts@0.1.0-beta.7
```

The root export contains domain schemas and types. `/workflow` contains `prepareArtifactEdit`, revision comparison, and compact projections. `/serialization` contains canonical JSON and SHA-256. `/http` contains HTTP response schemas, identity, canonical resource validation, and route URL helpers.

`protectedResourceMetadataSchema` accepts standard protected-resource metadata and an optional `artifacts_rest_resource`. The relation names the exact absolute canonical REST OAuth resource URL. It may name the resource itself or one distinct REST resource. Metadata for the distinct resource may omit the relation or name itself, but cannot name another resource.

`slugSchema` validates page slugs such as `concepts/rag` without normalizing them. `readSchema` takes exactly one of `artifactId` or a `{ project, slug }` locator, and `readByIdSchema` takes only an ID. `ArtifactRead` and the HTTP summary schema include `slug`, and `ArtifactErrorCode` includes `slug_conflict`.

The existing `@artifacts/artifacts` root, `/contracts`, and `/workflow` exports re-export these implementations. Store and REST packages share one `ArtifactError` runtime.

This package is MIT licensed. The license applies to this package and does not license the private Artifacts application repository.

`shareSchema` accepts optional `notify` and `requireNew: true` without defaults. `shareResultSchema` remains the strict five-field grant shape used by lists. `shareCommandResultSchema` adds an optional immutable notification disposition for commands. Plain and explicit-false requests return the original grant shape. An absent flag and an explicit false remain distinct receipt arguments.

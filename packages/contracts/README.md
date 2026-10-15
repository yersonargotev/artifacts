# Artifacts contracts

This package contains strict domain schemas, types, `ArtifactError`, snapshot serialization, and pure retained-edit helpers. It has no database, ZIP, server, or CLI dependency.

The root export contains domain schemas and types. `/workflow` contains `prepareArtifactEdit`, revision comparison, and compact projections. `/serialization` contains canonical JSON and SHA-256. `/http` contains HTTP response schemas, identity, canonical resource validation, and route URL helpers.

The existing `@artifacts/artifacts` root, `/contracts`, and `/workflow` exports re-export these implementations. Store and REST packages share one `ArtifactError` runtime.

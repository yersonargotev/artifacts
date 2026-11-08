# Slugs

Build the panel and start a fresh run with `pnpm build && node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run .test-artifacts/verify-artifacts/slugs-run`.

An owner names a page with a slug such as `concepts/rag` and reads it back by `{ project, slug }` without knowing its ID. A slug is unique within the owner's project, matched by the project's stored spelling. Artifacts without a project share one unfiled namespace. The owner renames or clears a slug with `move`. The panel shows the slug on library cards and under Información on the detail, and its move page lists the artifacts whose slugs would collide in the destination.

## Sub-features

- `slugs-create` creates a page with `project` and `slug` through HTTP MCP `artifacts_create`.
- `slugs-read-mcp` reads it through `artifacts_read` with `{ project, slug }`, spelling the project in another letter case.
- `slugs-read-cli` reads it through the source CLI with `read --project NAME --slug SLUG`, which calls `GET /v1/lookup` over REST.
- `slugs-conflict` creates the same slug again in the same project through MCP and through the CLI, and gets `slug_conflict` with the holder's `artifactId` (MCP) and status 409 (CLI).
- `slugs-not-found` reads an unknown slug through the CLI and gets `not_found` with status 404.
- `slugs-unfiled` creates the same slug without a project and reads it with `read --slug` alone.
- `slugs-panel` sees the slug on the library card and in the detail's Información list at 1440x900 and 390x844.
- `slugs-move-cli` renames the page with `move ID --slug concepts/retrieval`, reads it with `read --slug concepts/retrieval`, fails a move into a used slug with `slug_conflict`, and clears the slug with `move ID --no-slug`.
- `slugs-move-panel` selects two drafts in `Borradores`, moves them to `Mi-Wiki`, which already uses both slugs, and sees the conflict alert at 1440x900 and 390x844 while nothing moves.

[Link resolution](./links.md) has its own drive. [Search](./search.md) has its own drive. Batch commands are a later ticket of the wiki pages program and are not driven here.

## How to get to it (user POV)

- MCP: call `artifacts_create` with `project` and `slug`, then `artifacts_read` with `{ project, slug }`.
- CLI: `artifacts create --snapshot FILE --project NAME --slug SLUG`, then `artifacts read --project NAME --slug SLUG`. Rename with `artifacts move ID --slug SLUG` and clear with `artifacts move ID --no-slug`.
- Panel: open the library, then the artifact, then the `Información` tab. For the conflict, open a project, check `Seleccionar TITLE` on each card, choose `Mover a otro proyecto`, type the destination, and choose `Mover`.

## Driving it with control.ts

```sh
R=.test-artifacts/verify-artifacts/slugs-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive slugs --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

The drive lives in [scripts/slugs.ts](../scripts/slugs.ts). It creates a Markdown page titled `RAG` in project `Mi-Wiki` with slug `concepts/rag`, then a second `RAG` page with the same slug and no project. The CLI runs with the same private state and REST token as the `cli` drive.

Expected end state:

- MCP `artifacts_read { project: "mi-wiki", slug: "concepts/rag" }` and CLI `read --project mi-wiki --slug concepts/rag` both equal the MCP create result.
- MCP create with project `MI-WIKI` and the same slug returns `{ error: "slug_conflict", slug, project: "Mi-Wiki", artifactId }`. The CLI create exits 1 with `"code":"slug_conflict"` and status 409.
- CLI `read --project Mi-Wiki --slug concepts/missing` exits 1 with `"code":"not_found"` and status 404.
- CLI `read --slug concepts/rag` returns the unfiled page.
- The `Mi-Wiki` library card shows `concepts/rag` in `.artifact-slug`. The detail's `#information` list shows `Proyecto` `Mi-Wiki` and `Slug` `concepts/rag`, and the 390px detail does not overflow.
- CLI `move ID --slug concepts/retrieval` returns `{ artifactId, project: "Mi-Wiki" }`. `read --project Mi-Wiki --slug concepts/retrieval` returns the same artifact and head revision, and the old slug reads `not_found`.
- CLI `move UNFILED_ID --project Mi-Wiki --slug concepts/retrieval` exits 1 with `"code":"slug_conflict"` and status 409, and the unfiled page stays unfiled.
- After CLI `move ID --no-slug`, MCP `artifacts_read` returns `slug: null`, and `history ID` still lists one revision.
- With `Portada` (`index`) and `Bitácora` (`log`) in `Mi-Wiki`, the bulk move of `Índice borrador` (`index`) and `Registro borrador` (`log`) from `Borradores` answers 409 on `/move`. The heading is `Hay slugs en conflicto`. The alert names `Mi-Wiki` and lists both drafts with their slugs in `code`, and the form returns with the same request ID. The 390px page does not overflow, and MCP reads both drafts unchanged in `Borradores`.

Evidence under `<run>/slugs/` includes `actions.jsonl` with every MCP request and CLI argv, `library-slug.png`, `detail-information-slug.png`, `detail-information-slug-390.png`, `bulk-slug-conflict.png`, `bulk-slug-conflict-390.png`, their `.aria.yml` snapshots, `trace.zip`, and `result.json`.

## Gotchas

- `GET /v1/lookup` is separate from `/v1/artifacts/:id` so a slug such as `history` never collides with an ID route. The CLI and the typed client pick the route from the locator.
- A slug is never normalized. `Concepts/RAG` and `concepts/rag.md` fail validation with `invalid_input`; the `.md` case has its own message.
- A failed panel move writes no receipt, so the conflict page keeps the request ID and the owner can choose another destination with it.

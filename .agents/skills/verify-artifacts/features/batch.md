# Batch

An owner maintaining a wiki applies an ingest, such as new pages plus the index and log updates, as one all-or-nothing command with one receipt. An update addresses its page by `artifactId` or by `{ project, slug }`, including a slug created earlier in the same batch, and may omit `expectedRevisionId` only for such a page. A failure commits nothing and names the 0-based `index` of the failing operation. Search reflects the batch when it commits, and a batch never publishes.

## Sub-features

- `batch-seed` creates `Index` (`index`) and `Log` (`log`) in `Mi-Wiki` through HTTP MCP `artifacts_create`.
- `batch-cli` applies a six-operation ingest with the source CLI `batch --command FILE` over REST: three creates in `mi-wiki`, an update by slug of a page created earlier in the batch without `expectedRevisionId`, an index update by `artifactId` with `expectedRevisionId`, and a log update by slug.
- `batch-read` reads the twice-written page and the index through MCP and sees the batch heads, sequences, and no publication.
- `batch-retry` replays the batch with CLI `retry REQUEST_ID` and gets the same receipt.
- `batch-stale` applies a batch whose operation 1 carries the old index head, gets exit 1 with `conflict` at `index` 1, and MCP `artifacts_list` shows that nothing from it committed.
- `batch-search` finds the batch text through MCP `artifacts_search` and the CLI, and the replaced text no longer matches.
- `batch-collide` applies a batch whose operation 1 moves a page onto the slug that operation 0 just took, gets exit 1 with `slug_conflict` at `index` 1, and MCP reads `concepts/rag` unmoved.
- `batch-move` applies a three-operation reorganization with the CLI: it moves `concepts/rag` to `concepts/retrieval`, updates that page by its new slug, and points the index at it. MCP reads the page under the new slug, and MCP and CLI search return it there.
- `batch-panel` sees the three new pages in the library and the reorganized index's `Enlaces` resolving to them at desktop and 390px.

## How to get to it (user POV)

- MCP: call `artifacts_batch` with `{ requestId, operations }`.
- CLI: `artifacts batch --command FILE`, then `artifacts retry REQUEST_ID` for a lost response.
- REST: `POST /v1/batch`.

## Driving it with control.ts

```sh
R=.test-artifacts/verify-artifacts/batch-run
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts doctor --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts drive batch --run "$R"
node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run "$R"
```

The drive lives in [scripts/batch.ts](../scripts/batch.ts). The ingest creates `Karpathy` (`sources/karpathy`), `RAG` (`concepts/rag`), and `Agents` (`concepts/agents`), rewrites `Agents` from `Borrador.` to `Agentes que mantienen la wiki en Sabaneta.`, points the index at the three pages, and adds a log line. The CLI runs with the same private state and REST token as the `cli` drive.

Expected end state:

- The CLI prints `{ "results": [...] }` with indexes 0 to 5. Results 2 and 3 name the same artifact, and results 4 and 5 name the index and the log.
- MCP `artifacts_read { project: "mi-wiki", slug: "concepts/agents" }` shows project `Mi-Wiki`, sequence 2, and result 2's revision as parent. The index is at sequence 2 with `publication: null`.
- CLI `retry REQUEST_ID` prints the same result.
- The stale batch exits 1 with `"code":"conflict"`, `"status":409`, and `"index":1`, and `Mi-Wiki` still holds five artifacts.
- MCP and CLI search for `sabaneta` in `mi-wiki` return only `concepts/agents`. `borrador` and `todavia` return no items.
- The colliding batch exits 1 with `"code":"slug_conflict"`, `"status":409`, and `"index":1`.
- The reorganization prints results that name the RAG page twice and then the index. The move's `revisionId` is the RAG head from the ingest, and MCP reads `concepts/retrieval` at sequence 2. Search for `itagui` in `mi-wiki` returns only `concepts/retrieval` through MCP and the CLI.
- The library shows `Karpathy`, `RAG`, and `Agents` in `Mi-Wiki`. `region "Enlaces"` on the index detail holds three links and no `[data-link-state="broken"]` item, and the 390px detail does not overflow.

Evidence under `<run>/batch/` includes `actions.jsonl`, the `ingest.json`, `stale.json`, `collide.json`, and `reorganize.json` command files, `batch-library.png`, `batch-index.png`, `batch-index-390.png`, their `.aria.yml` snapshots, `trace.zip`, and `result.json`.

## Gotchas

- A batch command file carries its own `requestId`. The CLI retains every submitted command and refuses a second command under a retained request ID, so a corrected batch needs a new `requestId`, and `retry` resends only the retained command.
- Raced writes, such as a competing update between the batch's reads and its write request, are covered by `tests/batch.test.ts`, not driven here.

# Permanent deletion from the library

Feature ID `panel-deletion` uses the dedicated real Chrome proof rather than a `control.ts drive` command.

```sh
pnpm build
node --import tsx tests/artifact-deletion.browser.proof.ts
```

The optional `ARTIFACTS_CHROME_EXECUTABLE` environment variable accepts an absolute Chrome executable path. By default the proof uses the installed `chrome` channel. It requires Chrome 152 or newer.

This proof is included in `pnpm test:browser`. It starts its own migrated temporary SQLite database, local identity, built Astro panel and protected publication service on isolated loopback hosts. It never loads the normal `.env`. Setup authors disposable revisions through the shared store. That scaffolding is not proof of MCP authoring. Artifact deletion itself happens through the authenticated panel.

The keyboard path opens `Opciones de Disposable deletion proof artifact`, chooses the final `Eliminar artefacto` menu item and reaches the server-rendered confirmation. `Cancelar` returns to the library without changing data. Confirmation shows the current title and the permanent consequences. Stale head and publication submissions each return 409 and require a new confirmation. Invalid Origin and mismatched route/body submissions fail. A deliberately corrupted disposable receipt forces a transactional failure, so the 503 page can be checked for exact retry fields. After restoring the receipt, keyboard activation of `Reintentar eliminación` submits that same command and returns 303 to the library.

The proof captures desktop and 390px mobile confirmations, checks overflow, reloads the library with zero counts and no deleted row, replays the exact delete POST, and independently calls HTTP MCP `artifacts_read`. Old detail, export, iframe preview and confirmation URLs return 404. Both an already admitted publication viewer and a pending viewer grant are denied after removal. Scope, session, competing writers, receipt tombstones and cascade details are additionally covered by `tests/artifact-deletion.test.ts`.

Evidence remains private under ignored `.test-artifacts/artifact-deletion/`. The proof writes screenshots, `actions.jsonl`, `result.json`, and `cleanup.json`. Failure screenshots and ARIA snapshots remain there. Cleanup closes the owned browser and services and removes the temporary database. No deployed or retained user artifact is touched. This path proves local Chrome behavior; it does not claim deployment verification or secure erasure of SQLite free pages, WAL files or backups.

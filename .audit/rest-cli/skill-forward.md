# CLI skill forward evaluation

Completed at 2026-10-15T03:37:52.177693+00:00. **Pass.** The complete requested lifecycle succeeded against the disposable local instance. The original skill reference had one command-file documentation gap; the root agent corrected it during this run, and the corrected update/publication shapes were then accepted by the CLI without changing the final artifact state.

Root archived the evaluation inputs, sanitized outputs, credential-free operation records, and harness in `skill-evidence.zip` before shutting down the disposable fixture. Paths below record their original runtime locations; the archive preserves the same relative paths. `skill-export.zip` retains the exact historical export. Root separately fetched this CLI-created artifact through direct REST and HTTP MCP, compared both full reads with the CLI output, and verified that all three exports were byte-identical. The result is in `skill-root-check.json`.

## Scope and isolation

The first materials read were `skills/artifacts-cli/SKILL.md` and `skills/artifacts-cli/references/commands.md`, followed by the installed CLI help. No implementation source or prior review report was read. All artifact operations used `/tmp/artifacts-rest-cli-implementation/dist/packages/forward-consumer/node_modules/.bin/artifacts`; no alternate API, database write, other account, production connection, code edit, build, subagent, Memory checkpoint, PR, or external message was used.

The supplied connection manifest was read privately before every CLI subprocess. Its environment values were passed only in the subprocess environment. Credential values were never passed as command arguments or printed. The `whoami` session identifier was redacted before its output was saved or displayed. The artifact resource and owner stayed consistent.

Evaluation directory: `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation`.

Primary private state: `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/state`.

The retained harness is `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/run_cli.py`. Inputs, sanitized command outputs, full read snapshots, operation records, and the exported ZIP remain in that evaluation directory. The harness rereads the connection manifest for every command; it also scrubs sensitive identity fields from diagnostic records.

## Retained artifact and final state

Artifact ID: `29344e3c-e396-444e-aafe-14732bfcbb39`.

| Sequence | Revision ID | Parent | Title | Description |
| --- | --- | --- | --- | --- |
| 1 | `cf79320c-fb03-4050-a20f-233134670966` | none | CLI skill field notes | empty |
| 2 | `904e3268-4e1a-4ae2-99a3-176bbb490edc` | `cf79320c-fb03-4050-a20f-233134670966` | CLI skill reviewed notes | empty |
| 3 | `f5d7480b-9e94-45e6-a976-59002b8f6996` | `904e3268-4e1a-4ae2-99a3-176bbb490edc` | CLI skill reviewed notes | Reviewed through the CLI skill |

Final draft head: revision 3, `f5d7480b-9e94-45e6-a976-59002b8f6996`.

Published revision: revision 2, `904e3268-4e1a-4ae2-99a3-176bbb490edc`, publication version **1**.

Protected owner-login URL: http://[::1]:57325/a/29344e3c-e396-444e-aafe-14732bfcbb39.

All three revisions retain custom metadata `{"project":"field-notes","language":"en"}`, `notes.txt` as `text/plain` with UTF-8 bytes for `keep these notes\n`, and `sample.bin` as `application/octet-stream` with decoded bytes `[0,1,2,255]`. Revision 1 contains `# Field notes\n\nFirst observation.\n`; revisions 2 and 3 contain `# Field notes\n\nReviewed observation.\n`.

## Executed verification

| Step | Outcome | Evidence under `outputs/` |
| --- | --- | --- |
| Establish identity before mutation | pass; session identifier redacted | `01-whoami.json` |
| Create complete Markdown snapshot | pass; generated request ID retained | `02-create.json` |
| List artifact | pass; requested artifact present; `nextCursor` null | `03-list.json` |
| Read explicit revision 1 | complete metadata/content/files equal intended snapshot; both decoded attachments checked | `04-read-r1.json`, `revision-1.json` |
| Partial edit of title and content only | pass; metadata description, custom metadata, content kind, and both attachments preserved | `05-edit.json`, `06-read-r2.json`, `revision-2.json` |
| Complete update command | pass; caller-owned request ID, expected revision 2, full snapshot, description added | `08-update-complete.json`, `09-read-r3.json`, `revision-3.json` |
| Full history pagination | pass; `--limit 1`, cursors `3`, `2`, then null; sequences `[3,2,1]`, full snapshots equal explicit reads | `10-history-page-1.json`, `11-history-page-2.json`, `12-history-page-3.json` |
| Publish historical revision 2 | pass; observed unpublished state justified expected version 0; version 1 returned; head stayed revision 3 | `13-publish-r2.json`, `14-read-after-publish.json`, `current-after-publish.json` |
| Export explicit revision 2 | pass; CLI succeeded; independent ZIP SHA-256, manifest, content and attachment byte checks passed | `15-export-r2.json`, `revision-2.zip`, `export-artifact.json` |
| Replay retained publication with `retry` | pass; original receipt exactly equal; current publication version/revision/URL unchanged | `16-retry-publication.json`, `17-read-after-replay.json`, `current-after-replay.json` |
| Submit stale update based on revision 1 | expected exit 1, error `conflict`, HTTP 409, current revision 3 identified | `18-stale-update.json` |
| Inspect state after conflict | pass; head, complete revision 3 snapshot and publication unchanged; failed operation not retried or forced | `19-read-after-conflict.json`, `current-after-conflict.json` |
| Final state and revision count | pass; exactly three retained revisions; publication remains revision 2/version 1 | `23-final-read.json`, `current-final.json`, `24-final-history.json`, `final-verification.json` |

Verification compared complete snapshots, not compact projections. Parent links were checked for revisions 2 and 3. No connection failure or uncertain write occurred; the requested publication replay was deliberate. The stale update stopped on conflict as the skill requires. No expected version was replaced to force the failed write.

## Export

Path: `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/outputs/revision-2.zip`.

Size: 1446 bytes.

SHA-256: `58710cba0af11a9ac9ee314dcfec2beacd4b38f545c816c7ffdd79a764d0e65c`.

ZIP entries are exactly `artifact.json`, `content.md`, `files/notes.txt`, and `files/sample.bin`. The manifest artifact ID, full retained revision-2 identity/parent/sequence/digest fields, metadata, content path, per-file media types/encodings/sizes/digests, content bytes and decoded attachment bytes were inspected and verified. Revision-2 description remains empty, confirming export targeted the selected historical revision rather than draft head.

## Request IDs and retained operation records

| State directory | Kind | Request ID | Operation record path |
| --- | --- | --- | --- |
| state | update | `ec0afc28-fe97-418a-bf76-58de02488553` | `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/state/operations/07097546501e64275ead769c11c3805e94b61227e83ebf3faf766a70f7d9eca2.json` |
| state | update | `e54edede-07ad-44e4-928b-ead1cf7ed15a` | `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/state/operations/272be3222673dcf082f55cf0f41e9c5df336a3379eeabfdd8d0b7e8521ea80b9.json` |
| state | publish | `2f43cd3d-5bd1-45b9-8303-34185d9b1d7b` | `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/state/operations/411c3f0d10f135d573764a44ee58c6ba9a2ec3eea0f6bd199ab82a7484340b63.json` |
| state | update | `dc8946da-ebf5-431c-b3ca-2ef4139da2c2` | `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/state/operations/c4a3731f372ae47d2eaaf1b3ac05e80a330b494d369402117c58967f00dfd77d.json` |
| state | create | `55761204-8768-4905-be8d-0764b3a5bfdf` | `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/state/operations/ca2b6740af17268b726d599782afcf47bae2c4c3036a0b1e04c143f105fea732.json` |
| documentation-shapes-state | publish | `2f43cd3d-5bd1-45b9-8303-34185d9b1d7b` | `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/documentation-shapes-state/operations/411c3f0d10f135d573764a44ee58c6ba9a2ec3eea0f6bd199ab82a7484340b63.json` |
| documentation-shapes-state | update | `dc8946da-ebf5-431c-b3ca-2ef4139da2c2` | `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/documentation-shapes-state/operations/c4a3731f372ae47d2eaaf1b3ac05e80a330b494d369402117c58967f00dfd77d.json` |

## Original friction and correction validation

At the start, the reference said that complete command files preserve request IDs, snapshots and expected revisions, but did not provide their exact JSON fields. `artifacts --help` and `artifacts update --help` likewise exposed command-line syntax only. In particular, `expectedRevisionId` and `expectedPublicationVersion` could not be learned from those documents. The complete update command was prepared from the CLI's own retained `edit` operation record, without reading implementation source. This did not block honest completion, but it was a real onboarding gap for the requested `--command` path.

The root agent then added the required-field table and complete update/publication examples to `skills/artifacts-cli/references/commands.md`. I reread that section and confirmed its field sets against the actual retained commands. The documented update fields (`requestId`, `artifactId`, `expectedRevisionId`, `snapshot`) and publication fields (`requestId`, `artifactId`, `revisionId`, `expectedPublicationVersion`) matched.

For execution validation, an initial repeat of `update --command` in the original private state returned the CLI's expected `local_error`: an operation with that request ID already exists, and the diagnostic directs the caller to `retry`. This is recorded in `outputs/20-documentation-update-command-replay.json`; it made no server write and is not counted as successful replay.

Following the root agent's follow-up direction, I created a second private state directory, `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/documentation-shapes-state`, and submitted **byte-for-byte identical complete commands with their original IDs and expected versions**. `update --command` and `publish --command` both succeeded and returned the exact original server receipts (`outputs/21-documentation-update-command-fresh-state.json` and `outputs/22-documentation-publish-command-fresh-state.json`). The update replay receipt still says `publication: null`, accurately reflecting its original commit; the current read correctly remains publication revision 2/version 1. The final read and history confirmed no extra revision and no publication-version increment. This was a deliberate example-shape evaluation, not uncertain-write recovery.

The only other observed friction was a repeated Node experimental SQLite warning on stderr. It did not affect JSON stdout or exit status. No remaining skill defect blocked the requested lifecycle.

## Reproduction command shapes

Authentication/resource/state are supplied by the retained Python harness; credential values do not belong in command arguments. These are the CLI argument shapes actually exercised. The inputs remain under `/var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/inputs`. Existing read/export destinations are exclusive and should not be reused for another execution. Convenience mutations should not be rerun to recover uncertainty; use the retained request ID with `retry`.

```sh
artifacts --help
artifacts whoami
artifacts create --snapshot INPUT_DIR/create-snapshot.json
artifacts list --limit 1
artifacts read 29344e3c-e396-444e-aafe-14732bfcbb39 --revision cf79320c-fb03-4050-a20f-233134670966 --out NEW_READ_PATH
artifacts edit 29344e3c-e396-444e-aafe-14732bfcbb39 --changes INPUT_DIR/edit-changes.json
artifacts read 29344e3c-e396-444e-aafe-14732bfcbb39 --revision 904e3268-4e1a-4ae2-99a3-176bbb490edc --out NEW_READ_PATH
artifacts update --command INPUT_DIR/update-command.json
artifacts read 29344e3c-e396-444e-aafe-14732bfcbb39 --revision f5d7480b-9e94-45e6-a976-59002b8f6996 --out NEW_READ_PATH
artifacts history 29344e3c-e396-444e-aafe-14732bfcbb39 --limit 1
artifacts history 29344e3c-e396-444e-aafe-14732bfcbb39 --limit 1 --before-sequence 3
artifacts history 29344e3c-e396-444e-aafe-14732bfcbb39 --limit 1 --before-sequence 2
artifacts publish 29344e3c-e396-444e-aafe-14732bfcbb39 --revision 904e3268-4e1a-4ae2-99a3-176bbb490edc --expected-version 0
artifacts read 29344e3c-e396-444e-aafe-14732bfcbb39 --out NEW_READ_PATH
artifacts export 29344e3c-e396-444e-aafe-14732bfcbb39 --revision 904e3268-4e1a-4ae2-99a3-176bbb490edc --out NEW_ZIP_PATH
artifacts retry 2f43cd3d-5bd1-45b9-8303-34185d9b1d7b
artifacts read 29344e3c-e396-444e-aafe-14732bfcbb39 --out NEW_READ_PATH
artifacts update 29344e3c-e396-444e-aafe-14732bfcbb39 --snapshot INPUT_DIR/stale-snapshot.json --expected-revision cf79320c-fb03-4050-a20f-233134670966 --request-id e54edede-07ad-44e4-928b-ead1cf7ed15a
artifacts read 29344e3c-e396-444e-aafe-14732bfcbb39 --out NEW_READ_PATH
```

The exact full revision-3 command is `inputs/update-command.json`. The exact full publication command used for corrected-documentation validation is `inputs/publish-command-exact-replay.json`. Those validation invocations additionally used `--state-dir /var/folders/91/b4gh134x6zdfdw1x9kwd0rrc0000gn/T/artifacts-cli-forward-5dgUv8/skill-forward-evaluation/documentation-shapes-state`; they preserved the original complete mutation arguments.

## Limits and unexecuted steps

No requested lifecycle step remains unexecuted. This evaluation proves retained CLI persistence, snapshot preservation, history pagination, historical publication, export integrity, receipt replay and conflict behavior. It did not run browser/panel rendering checks, login/logout flows, failure-injection recovery, cross-interface ZIP byte comparison, or unrelated accounts. The content was inert Markdown, so no interactive visual behavior was claimed. The protected URL was verified from current publication state, not opened in a browser.

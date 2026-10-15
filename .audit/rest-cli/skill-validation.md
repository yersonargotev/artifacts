# artifacts-cli skill validation

The canonical skill is `skills/artifacts-cli/SKILL.md`. It includes one relative command reference and no dependency on another installed skill.

- The skill-creator `quick_validate.py` passed.
- Root ran executable `--help` and matched every documented option, including `--before-sequence`, `--cursor`, `--command`, `--server`, and `--state-dir`.
- A fresh evaluator read only the skill, its reference and installed help before running the authenticated lifecycle through the packed `artifacts` executable. It created, listed, read, edited, updated, paginated history, published a historical revision, exported, replayed publication and observed a stale update conflict. Complete snapshots and decoded attachment bytes were checked. Exactly three revisions remained, with revision 2 published and revision 3 as the draft head.
- That evaluation exposed missing `--command` JSON shapes. Root added the field table and complete examples. The evaluator then executed exact complete update/publication commands in a fresh private state directory and recovered their original receipts without another state change.
- Root independently fetched the CLI-created artifact through direct REST and HTTP MCP. Full reads matched the CLI result, and CLI/REST/MCP historical ZIP exports were byte-identical.
- Evidence is in `skill-forward.md`, `skill-evidence.zip`, `skill-root-check.json`, and `skill-export.zip`. The fixture and temporary credential directories were removed after evidence was archived.

The CLI has no implicit resource default. The skill requires an explicit resource, preserves complete snapshots, uses retained operations for uncertain retries, and stops on conflicts. Output paths remain exclusive. Native login and injected network failure were verified separately by the executable auth/client tests and Chrome proof, not by this skill evaluation.

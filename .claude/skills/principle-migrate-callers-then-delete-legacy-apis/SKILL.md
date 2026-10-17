---
name: principle-migrate-callers-then-delete-legacy-apis
description: "Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers."
disable-model-invocation: true
---

## Claude Code execution

Apply this workflow when explicitly requested, or read it as a dependency of an explicitly requested pstack workflow. Read sibling pstack skills from this installation, not from another host's roots. Project skills belong under `.claude/skills`; personal skills under `~/.claude/skills`.

Claude manual-only dependencies must be read as files; do not invoke them through the Skill tool or preload them as model-invoked skills.

# Migrate Callers Then Delete Legacy APIs

When we decide a new API is the right design, migrate callers and remove the old API in the same refactor wave instead of preserving compatibility layers.

**Rule:**
- Do not keep legacy API paths only because internal callers still exist
- Inventory callers, migrate them, and delete the old API immediately
- Treat temporary adapters as exceptional and time-boxed, not default architecture
- Update tests to assert the new contract, and delete tests that only protect pre-refactor implementation details

**When this applies:**
- No external users depend on backward compatibility
- The project can absorb coordinated breaking changes
- The new API is part of a simplification or refactor initiative

Keeping both old and new APIs creates dual-path complexity, slows cleanup, and makes the codebase feel append-only.

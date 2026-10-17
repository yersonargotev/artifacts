---
name: principle-exhaust-the-design-space
description: "Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competing prototypes and compare side by side before committing."
disable-model-invocation: true
---

## Claude Code execution

Apply this workflow when explicitly requested, or read it as a dependency of an explicitly requested pstack workflow. Read sibling pstack skills from this installation, not from another host's roots. Project skills belong under `.claude/skills`; personal skills under `~/.claude/skills`.

Claude manual-only dependencies must be read as files; do not invoke them through the Skill tool or preload them as model-invoked skills.

# Exhaust the Design Space

It also applies to product design decisions where user experience depends on feel, not logic.

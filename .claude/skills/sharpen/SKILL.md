---
name: sharpen
description: "Sharpen a task before starting: the expert approach, what the user is really after, and the right level of specification. Use for /sharpen."
disable-model-invocation: true
---

## Claude Code execution

Apply this workflow when explicitly requested, or read it as a dependency of an explicitly requested pstack workflow. Read sibling pstack skills from this installation, not from another host's roots. Project skills belong under `.claude/skills`; personal skills under `~/.claude/skills`.

Delegate through the Agent tool with an available agent type, such as general-purpose; use only parameters exposed by this session. Delegate only when current instructions permit it. Read `~/.pstack/claude-models.md` for confirmed role preferences; otherwise inherit the host model. `inherit-parent` means omit an override, not a model ID. Same-model reviewers are not a multi-model panel. When delegation is unavailable, label sequential work as such; a required independent-review gate remains incomplete.

Use accessible current-workspace history and authorized tools. Missing history, live control, scheduling, or external integrations is a reported limitation. Monitoring lasts only while the session actually runs unless a supported scheduler is verified. Preserve the user's scope and authority for messages, merges, deployments, and destructive actions. Required evidence gates remain blocked until real evidence exists.

Claude manual-only dependencies must be read as files; do not invoke them through the Skill tool or preload them as model-invoked skills.

Before starting, ask how a top expert would approach this task (their raw sources, their real methods, an outside check that the result is right), what the user is really after, and whether the task is over- or underspecified. Loosen constraints that don't serve the goal as readily as you add ones that do, and leave choices that are the user's to make open instead of deciding them. Fold in only what makes the work better, not bigger, but always keep one outside check that the result is right, without narrating the framing, then do the work. Don't hand back a rewritten prompt.

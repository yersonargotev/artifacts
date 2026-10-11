---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Multiple LLM reviewers challenge changes from independent angles."
---

## Codex execution

Apply this workflow when explicitly requested, or read it as a dependency of an explicitly requested pstack workflow. Read sibling pstack skills from this installation, not from another host's roots. Project skills belong under `.agents/skills`; personal skills under `~/.agents/skills`.

Delegate through the available Codex subagent API; use only its advertised agent types and parameters. Delegate only when current instructions permit it. Read `~/.pstack/codex-models.md` for confirmed role preferences; otherwise inherit the host model. `inherit-parent` means omit an override, not a model ID. Same-model reviewers are not a multi-model panel. When delegation is unavailable, label sequential work as such; a required independent-review gate remains incomplete.

Use accessible current-workspace history and authorized tools. Missing history, live control, scheduling, or external integrations is a reported limitation. Monitoring lasts only while the session actually runs unless a supported scheduler is verified. Preserve the user's scope and authority for messages, merges, deployments, and destructive actions. Required evidence gates remain blocked until real evidence exists.

# Interrogate

Spawn one reviewer per configured model to adversarially review code changes. Each model gets the same prompt and rubric. The adversarial signal comes from model diversity, not assigned personas.

The deliverable is a synthesized verdict. Do NOT auto-apply changes.

## Step 1, Determine Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that
- If on a feature branch, run `git diff main...HEAD` (or the appropriate base branch) for the full changeset
- If the user's message references recent work, gather the relevant files

Package the diff (or file contents) plus any surrounding context files the reviewers need to understand the code.

## Step 2, State the Intent

Before spawning reviewers, state the intent explicitly. Derive this from:

- The user's message
- Commit messages
- PR description if one exists
- The code itself

Write one clear paragraph. If you're unsure about the intent, ask the user before proceeding.

## Step 3, Spawn Reviewers

Launch all reviewers in a single message using the host subagent tool. Use the `interrogate reviewers` line in `~/.pstack/codex-models.md`, one reviewer per entry, extending or shrinking the Reviewer A/B labels below to the configured entry count. If the rule or that line is missing, use the table defaults.

| Subagent | Default model |
|----------|---------------|
| Reviewer A | `inherit-parent` |
| Reviewer B | `inherit-parent` |

For each reviewer:
- agent type: a general-purpose type exposed by this host
- `model`: the configured `interrogate reviewers` entry, or the table default with no configured line. For an `auto` or `inherit-parent` entry, omit `model` so that reviewer runs on the parent model.
- Permissions: read-only intent; inspect the actual authorized delegated tools, including any needed connectors.

If a configured model is unavailable, inherit the host model and disclose the fallback. Keep an explicitly required multi-model review incomplete when distinct models are unavailable.

Read `references/reviewer-prompt.md` and fill in the template with:
1. The stated intent
2. The diff or file contents
3. The review rubric from `references/rubric.md`
4. The code-quality lens from `references/code-quality-review.md`

The same filled template goes to all reviewers, so every model applies the code-quality lens.

## Step 4, Synthesize

As results come back, build a unified picture:

1. **Parse all findings** from the reviewers
2. **Identify consensus**. Findings raised by 2+ models independently are highest signal.
3. **Identify lone-model findings**. Still worth reading, but weight accordingly.
4. **Deduplicate**. Different models may describe the same issue differently. Merge these and note which models raised it.
5. **Note disagreements**. If one model flags something and another explicitly says the opposite, that's useful context for the verdict.

## Step 5, Lead Judgment

You are the lead reviewer, a pragmatic senior engineer, not a neutral aggregator.

Read `references/lead-judgment.md` for the full framework.

Categorize every finding using these buckets:

- **Act on**. Real issues affecting correctness, security, or maintainability given the actual goals. These would block a real PR.
- **Consider**. Legitimate points, but you're not sure they outweigh the cost of addressing them right now. Worth the user's attention.
- **Noted**. Technically valid but not actionable. Context-dependent, premature optimization, or low-impact given the current stage.
- **Dismissed**. Wrong, nitpicky, or missing context. Brief explanation why.

For each finding, include:
- Which model(s) raised it
- The category (act on / consider / noted / dismissed)
- A one-line rationale for the categorization

## Output Format

Present the verdict in this structure:

### Intent
> [The stated intent paragraph from Step 2]

### Reviewers
- Reviewer [label]: [model name], [N findings] (one bullet per reviewer)

### Act On
[Findings that should be addressed. For each: description, which models raised it, why it matters.]

### Consider
[Findings worth thinking about. For each: description, which models raised it, tradeoff involved.]

### Noted
[Valid but low-priority. Brief list.]

### Dismissed
[Rejected findings with brief rationale.]

### Agreement Map
[Where did models agree, where did they diverge, and what does the pattern of agreement/disagreement tell us?]

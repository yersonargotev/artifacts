---
name: chief-of-staff
description: Pursue a long-running goal in a single session by co-ordinating subagents.
disable-model-invocation: true
---

## On-demand context

Use the initiating retrieval result's explicit `surface` and `snapshot_id` for
this procedure and every nested request. Read and follow the linked Matty entry
at each authored call below; these links identify prepared Catalog Resources,
without requiring native Skill-tool registration or an installed sibling copy.
For a fresh nested descriptor, use:

```sh
packy get skill matty:<skill> --surface <initiating-surface> --snapshot <initiating-snapshot-id> --json
```

Keep that host and snapshot even if catalog selection changes. If retained
content is unavailable, stop and restore that exact revision rather than use a
newer snapshot or another Pack's same-name skill. Obtaining instructions does
not execute the procedure or satisfy its runtime or human prerequisites.

Resolve skill references and templates relative to this returned entry and
`resource_root`. Resolve project paths, repository inspection, and configuration
against the user's intended target project; choose writable scratch/output
separately from immutable Catalog resources. Preserve the procedure's invocation
policy, user decisions, and output destinations. Read only the references needed
for the active branch.

Pass the initiating host, snapshot, target directory, writable scratch/output,
and returned entry/resource locations to every delegated agent or handoff. Read
Catalog instructions for the user's selected Matty workflow; preserve its own
policies even when another Pack is active. Availability does not authorize a
user-only invocation or bypass a decision required by the procedure.

This is an experimental upstream workflow. Use it only when explicitly selected
by the user. Recurring schedules remain subject to host support and the user's
authorization.

You are a chief of staff, co-ordinating subagents and schedules to pursue a long-running goal. This session will run for a long time, accruing tribal knowledge and helping you make long-term strategic decisions.

You are the Directly Responsible Individual for this goal. You are empowered to think much longer-term than you're used to. You must think on two tracks simultaneously:

- Tactical: how do I complete the immediate task?
- Strategic: how do I modify the environment to improve the outcomes of the _next_ task?

## Schedules

Harness-permitting, you will suggest recurring schedules which can help in achieving the goal.

## Subagents

All work should be done in subagents. Protect your context window.

Use background agents so you can stay in active dialogue with the user. Start every subagent with a fresh context window.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: research notes, previous commits, wiki pages, and others. Don't duplicate information already available via pointers.

## Wiki

Keep your memory in a **wiki**: a folder of interlinked markdown pages that outlives this session. Tribal knowledge that lives only in your context is lost at compaction; the wiki is how it reaches the next session. Look for a shared wiki first, one the user or other agents already keep, and write your pages into it, following its conventions where they differ from the ones below. Only if there is none, agree a location with the user before the first write.

- `index.md` lists every page with a link and a one-line summary, grouped by category.
- Each other page covers one thing: a decision, a recurring problem, a subsystem, a user preference. Link related pages to each other.
- Sources (issues, PRs, transcripts, subagent reports) are never copied in or edited. Pages cite them.

Three operations keep it alive:

- **Ingest.** When you learn something durable (a decision, a user correction, a subagent's finding), update every page it touches and the index, not only a new page.
- **Query.** Before a decision, read `index.md` and the pages it points to. If the answer you build is worth keeping, file it as a page.
- **Lint.** Periodically look for contradictions, orphan pages, missing links and claims newer sources have overtaken. Suggest this as a schedule.

### Write history, not the present

The wiki is a historical record. It never claims to describe how things are now, because it cannot keep up with the code.

- Date every claim: "On 2026-10-13, Matt decided..."
- When a claim concerns code, cite the commit it was true at, with its repo: "As of `mattpocock/skills@abc1234`, `retro` loads `writing-for-agents` in step 1."
- Never write "currently", "now" or "is" about code without a date or commit beside it.
- When something changes, add a new dated claim and mark the old one superseded. Don't rewrite the old one.

## Procedures

Read and follow the linked Matty entry for each selected procedure, using the initiating surface and snapshot. These dependencies prepare instructions; preserve each procedure's user decisions and runtime requirements.

- **Retro** ([matty:retro]({{packy.access:matty:retro}})): run a retro on about one in five of your subagents' sessions, including those an `implement-spec` run dispatches. Pick first the ones where something went wrong. In place of retro's last step, decide yourself which candidates are worth pursuing, then pursue them.
- **Large chunks of work**: write a spec with [matty:to-spec]({{packy.access:matty:to-spec}}), break it into tickets with [matty:to-tickets]({{packy.access:matty:to-tickets}}), publish both to the issue tracker, then implement them with [matty:implement-spec]({{packy.access:matty:implement-spec}}).

## Strategic View

As part of any and all work, FIRST consider how the environment the agents operate in might be improved. Agents thrive in the **pit of success**:

- API's and functions which are extremely constrained and limited
- Lint rules which force correctness
- CODING_STANDARDS.md files which let code reviewers enforce best practices

They also need relevant **data sources** to succeed:

- Logs from critical running processes, like dev servers (or production logs)
- Access to test environment databases
- Access to the browser (when necessary) for clicking around and taking screenshots

Finally, create environments (and codebases) that obey the **"no workarounds"** rule:

- No one-off workarounds, or hacks that bypass established processes
- Any deviations from conventions must be fixed proactively, before feature work is done

Be relentless in improving the environment. Use every user message as an excuse to search for these improvements.

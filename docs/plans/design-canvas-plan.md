# Design canvas plan

An author can save a design as several HTML artboards placed on one canvas, with sticky notes and pages. The owner sees it in the panel preview and a viewer sees it on the protected publication page. Both pan, zoom, fit, and open one artboard in a focus view. Editing stays with agents through MCP, CLI, and REST. There is no in-browser editor in this program.

The rule is that a canvas is an ordinary revision. It keeps history, export, sharing, the 1 MiB limit, the 32 file limit, and the existing sandbox policy unchanged.

The program lands three PRs in this order. D1 adds the `design` content kind and its canvas index. D2 renders the canvas in the panel and the publication page. D3 teaches the skills to author canvases and adds the verification recipe.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `/Users/argote/Documents/dev/artifacts/.claude/skills/poteto-mode/playbooks/autopilot-stack.md` as its execution playbook. The PRs form one linear chain, D1 at the root and D3 at the tip. Each link targets its parent's branch. The root agent appends verified links. The operator lands the chain bottom-up, so D1, D2, and D3 all stop at stack-ready.

In every perf and regression lane, trunk means the PR's base branch. That is `main` for D1 and the parent link for D2 and D3.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

### The canvas data shape

Every PR builds on this shape. D1 owns it.

```ts
type DesignContent = { kind: 'design'; text: string }; // text is the canvas index as JSON
type CanvasIndex = {
  v: 1;
  boards: Record<BoardPath, { x: number; y: number; w: number; h: number; title?: string; page?: PageId }>;
  order: BoardPath[];                 // back to front, same set as the keys of boards
  notes?: Record<NoteId, { x: number; y: number; text: string; w?: number; page?: PageId }>;
  pages?: { id: PageId; name: string }[];
};
// BoardPath matches ^boards/[A-Za-z0-9_][A-Za-z0-9_.-]*\.html$ and names a snapshot file
// with mediaType text/html and encoding utf8. w and h are 40 to 8000. Ids match [A-Za-z0-9_-]{1,40}.
```

Boards live in `snapshot.files`, so the store, the 1 MiB budget, the 32 file limit, attachment downloads, and the export ZIP need no new storage path. The canvas index is the content text, so `compareRevisions` reports layout changes through `textChanged`.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from their installed locations at program start. Re-read them at every tick.
  - [ ] Read `/Users/argote/Documents/dev/artifacts/.claude/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] Read `/Users/argote/Documents/dev/artifacts/.claude/skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] Read the sibling `swarm/SKILL.md`
  - [ ] `git show origin/main:.claude/skills/verify-artifacts/SKILL.md`
  - [ ] `cat /Users/argote/Documents/dev/artifacts/.claude/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] Read `principle-model-the-domain`, `principle-boundary-discipline`, `principle-type-system-discipline`, and `principle-prove-it-works` from `.claude/skills`
- [ ] On the operator's go, arrange an hourly audit with the tick prompt below, using active-session monitoring or a verified host scheduler. Respect the host's maximum wait and keep the operator informed. Report missing scheduling and do not promise ticks after this session ends. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the installed execution playbook. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners run on `opus` at `xhigh` per `~/.pstack/claude-models.md`. D2's canvas host runs on `fable` at `xhigh` as a hardest task.
- [ ] Follow this dependency graph. Each link branches from its parent's branch.
  - [ ] D1 is first and branches from `main`.
  - [ ] D2 after D1.
  - [ ] D3 after D2.
- [ ] Hold the file boundaries.
  - [ ] D1 touches only `packages/contracts/**`, `packages/artifacts/**`, `apps/dashboard/src/presentation.ts`, `apps/mcp/src/http.ts`, `.agents/skills/verify-artifacts/scripts/retained.ts`, and `tests/**`.
  - [ ] D2 touches only `apps/publication/src/**`, `apps/dashboard/src/pages/artifacts/**`, `apps/dashboard/src/components/detail/**`, and `tests/**`.
  - [ ] D3 touches only `skills/**`, `.agents/skills/verify-artifacts/**`, `.claude/skills/verify-artifacts/**`, `docs/**`, and `tests/cli-skills.proof.ts`.
- [ ] Hold the review gate. D2 changes an interaction. It waits for the operator's review in chat with screenshots and a video before it joins the stack.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <parent-branch>` or `gh pr create --base <parent-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run `pnpm check` and `pnpm test` once before the PR-facing push. The repository has no lint script. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review. When `cursor-team-kit` is absent, apply the same checks by hand and record that in the PR body.
- [ ] Triage every Bugbot and security-reviewer comment per `.claude/skills/poteto-mode/references/bugbot-triage.md`.
- [ ] Rebase onto the parent branch before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at stack prep, on a `git merge-tree` conflict with the parent, or on a CI failure that comes from a change on the parent.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head. Run each full swarm per `.claude/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the stack-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends a clean link to the stack with its base set to its parent's branch. A link whose patch-id is unchanged after a rebase keeps its verdict per `playbooks/shipping.md`. The operator lands the chain bottom-up.

### Boot recipe, for every live lane

Each live lane runs in its own git worktree at the PR head. No scenario needs a VM. The control surface is the `verify-artifacts` launcher plus Playwright on real Chrome 152 or later, because `control-ui` from `cursor-team-kit` is not installed on this host. Appendix C records that gap.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `pnpm install --frozen-lockfile && pnpm build`, then `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts launch`. Wait for its ready line with the panel and viewer URLs.
- [ ] Deliver input only through `control.ts drive <feature>`, the `artifacts` CLI against the launched REST URL, or Playwright actions on the launched panel and viewer. Read-only diagnostics are `control.ts doctor`, response headers, and the content frame's console.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.
- [ ] Run `node --import tsx .agents/skills/verify-artifacts/scripts/control.ts cleanup --run <run dir>` at the end of the lane.

## Add the design content kind and canvas index (D1)

**Depends on.** None.

**Files.**

- [ ] Edit `packages/contracts/src/index.ts`.
- [ ] Edit `packages/contracts/src/http.ts`.
- [ ] Edit `packages/artifacts/src/panel/model.ts`.
- [ ] Edit `packages/artifacts/src/index.ts`.
- [ ] Edit `apps/dashboard/src/presentation.ts`.
- [ ] Edit `apps/mcp/src/http.ts`.
- [ ] Edit `.agents/skills/verify-artifacts/scripts/retained.ts`.
- [ ] Create `tests/design-canvas.test.ts`.
- [ ] Edit `tests/helpers.ts`.

**Build.**

- [ ] Add `'design'` to the kind enum at `packages/contracts/src/index.ts:16` and export one `contentKinds` tuple that `http.ts` and `panel/model.ts` reuse, so the hand-written `ContentKind` union is deleted.
- [ ] Add `canvasIndexSchema` in `packages/contracts/src/index.ts` with the shape in "The canvas data shape". Export `parseCanvas(snapshot)` that returns the typed index and its resolved board files.
- [ ] Extend the snapshot `superRefine` so a `design` snapshot fails when the text is not a valid index, when `order` and `boards` differ as sets, when a board path has no matching file, when a board file is not `text/html` with `utf8` encoding, or when a board or note names an unknown page.
- [ ] Map `design` to `json` in the export extension table at `packages/artifacts/src/index.ts:257` and in `.agents/skills/verify-artifacts/scripts/retained.ts`.
- [ ] Add a `design` entry to `contentLabels` in `apps/dashboard/src/presentation.ts:50` with the label `Diseño`.
- [ ] Describe the `design` kind in the create and publish tool prose at `apps/mcp/src/http.ts:51` and `:72`.

**You see.**

- [ ] `artifacts create --snapshot canvas.json` with a three-board snapshot prints a revision with `content.kind` `design`, and the panel library card shows the label `Diseño`.
- [ ] A snapshot whose `order` names `boards/Missing.html` fails with a validation error naming that path.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/design-canvas.test.ts` gains cases for a valid canvas, an order and boards mismatch, a missing board file, a non-HTML board file, an unknown page reference, an out-of-range `w`, and a 33-board canvas rejected by the file limit. Run `node --import tsx --test tests/design-canvas.test.ts`.
- [ ] `tests/artifacts.test.ts` gains a case that exports a design revision and finds `content.json` plus each board under `files/boards/`. Run `pnpm test`.
- [ ] `tests/workflow.test.ts` gains a case where moving one board reports `textChanged` and leaves `kindChanged` false. Run `pnpm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet (xhigh)` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Create, update, publish, and export an HTML artifact through the CLI at trunk and head. Trunk lacks `design`, so record that and also gate a design create, publish, and export at head. Save `d1-regression.png`. Pass when both HTML flows produce byte-identical ZIPs for the same snapshot and the head design export contains `content.json` and every board.
- [ ] Lane 2. Create a three-board design through MCP `artifacts_create`. Save `d1-mcp-create.png`. Pass when `artifacts_read` returns the same index and three board files.
- [ ] Lane 3. Create the same design through REST with `curl` against the launched API. Save `d1-rest-create.png`. Pass when the response revision SHA-256 equals the MCP revision SHA-256 for the same snapshot.
- [ ] Lane 4. Send a design whose `order` names a missing board through the CLI. Save `d1-cli-missing.png`. Pass when the CLI exits non-zero and stderr names `boards/Missing.html`.
- [ ] Lane 5. Update a design with `expectedRevisionId` after moving one board. Save `d1-update.png`. Pass when history shows two revisions and the compare panel shows a text change with an unchanged kind.
- [ ] Lane 6. Open the panel library after Lane 2. Save `d1-library.png`. Pass when the card shows the `Diseño` label and no console error.
- [ ] Lane 7. Open the panel detail for the design. Save `d1-detail.png`. Pass when the header and facts card show `Diseño` and the files panel lists each board path.
- [ ] Lane 8. Download one board attachment from the publication page. Save `d1-attachment.png`. Pass when the response is `content-disposition: attachment` with the board bytes.
- [ ] Lane 9. Create a design whose total size is 1 MiB plus one byte. Save `d1-oversize.png`. Pass when every surface rejects it with the existing size error.
- [ ] Lane 10. Retry a design create with the same `requestId`. Save `d1-retry.png`. Pass when the retry returns the original revision and no second revision exists.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Median `snapshotSchema.parse` time for the largest valid HTML fixture at trunk and head, and at head for a 32-board design near 1 MiB.
- [ ] Probe. A `node --import tsx` script that parses each fixture 500 times after 50 warmups, run at trunk and at head in interleaved order, five rounds each.
- [ ] Baseline. Record the trunk HTML median first.
- [ ] Rule. Fail when the head HTML median exceeds the trunk median by more than 10 percent, or when the 32-board design median exceeds 25 ms.

**Review gate.** None. D1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto `main` after the verdict, patch-id unchanged.
- [ ] The root appends D1 as the stack root with base `main`. The operator lands it.

## Render the canvas in the panel and publication (D2)

**Depends on.** D1.

**Files.**

- [ ] Edit `apps/publication/src/document.ts`.
- [ ] Create `apps/publication/src/canvas.ts`.
- [ ] Edit `apps/dashboard/src/components/detail/PreviewCard.astro`.
- [ ] Create `tests/design-canvas.browser.proof.ts`.
- [ ] Edit `tests/publication.test.ts`.
- [ ] Edit `package.json` to add the new proof to `test:browser`.

**Build.**

- [ ] Replace the kind branch in `previewDocument` at `apps/publication/src/document.ts:22` with a renderer table keyed by content kind. The `design` entry calls `canvasDocument` in `apps/publication/src/canvas.ts`. Both the panel preview route and the publication content route already call `previewDocument`, so neither route changes.
- [ ] `canvasDocument` renders each board as `<iframe sandbox="allow-scripts" srcdoc>` at its `x`, `y`, `w`, `h`, in `order`, inside the existing content document and its unchanged `previewPolicy`. Notes render as escaped text blocks. Pages render as a row of real buttons that filter boards and notes.
- [ ] The canvas script supports drag and wheel to pan, ctrl or pinch wheel to zoom around the cursor, `+`, `-`, and `Fit` buttons, and a focus view opened from each board's name button that shows the board at native size with a `Volver al lienzo` button and Escape to return. Every control is a `<button>` with an `aria-label`. No global key handler other than Escape inside the focus view.
- [ ] The inert renderer for other browsers lists each board title with its escaped source in a `<pre>`, as HTML does today.
- [ ] Give the canvas host a Catppuccin Latte and Mocha ground that follows `prefers-color-scheme`, matching `docs/decisions/catppuccin-blue.md`.

**You see.**

- [ ] The panel preview tab for a three-board design shows three artboards fitted to the viewport, each labeled with its title or path.
- [ ] Clicking a board's name opens it alone at native size, and `Volver al lienzo` restores the previous pan and zoom.
- [ ] The publication page shows the same canvas inside the existing wrapper, and the content response headers equal those of an HTML artifact.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/publication.test.ts` gains cases that `canvasDocument` escapes a board containing `"` and `</iframe>` in `srcdoc`, escapes note text, and emits the inert listing when `interactive` is false. Run `pnpm test`.
- [ ] `tests/design-canvas.browser.proof.ts` asserts in Chrome that every board's script runs, that a board `fetch` is blocked by `connect-src 'none'`, that a board reading `parent.document` throws, and that a board's origin is `null`. Run `node --import tsx tests/design-canvas.browser.proof.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet (xhigh)` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open an HTML artifact's panel preview and publication page at trunk and head. Trunk renders a design as escaped JSON, so record that and gate the head canvas render of the same design. Save `d2-regression.png`. Pass when the HTML preview and publication screenshots match pixel for pixel across trunk and head, and the head design shows every board.
- [ ] Lane 2. Open the panel preview of a three-board design at 1440 by 900. Save `d2-panel-canvas.png`. Pass when all three boards are visible after load without user input.
- [ ] Lane 3. Pan by drag and zoom with ctrl wheel around a board corner. Save `d2-pan-zoom.png`. Pass when the corner under the cursor stays within 2 px of its start position after zoom.
- [ ] Lane 4. Open one board in focus view, then press Escape. Save `d2-focus.png`. Pass when the focused board renders at its declared `w` and `h` and Escape restores the prior transform.
- [ ] Lane 5. Switch pages on a canvas with two pages. Save `d2-pages.png`. Pass when only the selected page's boards and notes are visible.
- [ ] Lane 6. Tab through every canvas control. Save `d2-keyboard.png`. Pass when each control receives a visible focus ring and activates with Enter or Space.
- [ ] Lane 7. Open the publication page as an invited viewer. Save `d2-viewer.png`. Pass when the viewer sees the canvas and the content response carries `previewPolicy` and `connection-allowlist: ()`.
- [ ] Lane 8. Open the publication page with a Firefox user agent. Save `d2-inert.png`. Pass when the content is the inert listing with `script-src 'none'` and no board executes.
- [ ] Lane 9. Open the panel preview at 390 by 844. Save `d2-phone.png`. Pass when the canvas fits, controls stay reachable at 44 px or larger, and the page has no horizontal scroll.
- [ ] Lane 10. Load a board whose script calls `fetch`, opens `window.open`, and posts to `parent`. Save `d2-containment.png`. Pass when fetch and popups are blocked, no message changes the canvas, and the wrapper console shows no errors from the host.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from publication navigation to the content frame's `load` event for an HTML artifact at trunk and head. At head also the time until every board frame of a 24-board design fires `load`.
- [ ] Probe. A Playwright script on real Chrome that opens each page 20 times, alternating trunk and head servers on separate ports, reading `performance.now()` deltas from the content frame.
- [ ] Baseline. Record the trunk HTML median first.
- [ ] Rule. Fail when the head HTML median exceeds trunk by more than 10 percent, or when the 24-board design median exceeds 1500 ms. The prototype measured 385 ms for 24 boards on a static server.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 4, 5, and 9 screenshots into `.audit/design-canvas/d2-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of pan, zoom, focus, and page switching on the panel and the publication page. Save it as `.audit/design-canvas/d2-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at stack-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the D1 branch after the verdict, patch-id unchanged.
- [ ] The root appends D2 with base set to the D1 branch. The operator lands it after D1.

## Teach the skills to author and verify canvases (D3)

**Depends on.** D2.

**Files.**

- [ ] Create `skills/artifacts-design/references/canvas.md`.
- [ ] Edit `skills/artifacts-design/SKILL.md`.
- [ ] Edit `skills/artifacts/references/tool-contract.md`.
- [ ] Edit `skills/artifacts-cli/references/commands.md`.
- [ ] Edit `skills/artifacts-cli/scripts/prepare-retained.mjs`.
- [ ] Create `.agents/skills/verify-artifacts/features/design.md` and mirror it under `.claude/skills/verify-artifacts/features/`.
- [ ] Edit `.agents/skills/verify-artifacts/features/README.md`.
- [ ] Create `docs/decisions/design-canvas.md`.
- [ ] Edit `tests/cli-skills.proof.ts`.

**Build.**

- [ ] `canvas.md` gives the canvas index shape, frame sizes, 80 px gaps in a row and 120 px between rows, the board file rules, the shared 1 MiB budget, and how to embed fonts per board with `scripts/embed-fonts.mjs`.
- [ ] `prepare-retained.mjs` accepts a directory with `canvas.json` and `boards/*.html` and emits one `design` snapshot.
- [ ] `features/design.md` drives create, preview, focus, publish, and export of a design through `control.ts`.
- [ ] `docs/decisions/design-canvas.md` records why boards are files, why `srcdoc` keeps the sandbox unchanged, and what stays out of scope.

**You see.**

- [ ] `artifacts skills get artifacts-design --full` lists `references/canvas.md`.
- [ ] `node skills/artifacts-cli/scripts/prepare-retained.mjs ./my-canvas` prints a snapshot with `content.kind` `design` and one file per board.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/cli-skills.proof.ts` gains a case that the bundled skill lists `references/canvas.md`. Run `pnpm test:cli-skills`.
- [ ] `tests/design-canvas.test.ts` gains a case that `prepare-retained.mjs` output parses with `snapshotSchema`. Run `pnpm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet (xhigh)` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Prepare and create a single HTML artifact with `prepare-retained.mjs` at trunk and head. Trunk lacks canvas preparation, so record that and gate a head canvas directory through create and preview. Save `d3-regression.png`. Pass when the HTML snapshots are byte-identical and the head canvas previews every board.
- [ ] Lane 2. Run `control.ts drive design`. Save `d3-drive.png`. Pass when the recipe exits zero and saves its screenshots.
- [ ] Lane 3. Follow `canvas.md` in a fresh agent session to author a two-page, four-board canvas through MCP. Save `d3-mcp-author.png`. Pass when the first create validates and the preview shows both pages.
- [ ] Lane 4. Repeat Lane 3 through the CLI skill. Save `d3-cli-author.png`. Pass when the first create validates.
- [ ] Lane 5. Embed fonts in two boards with `embed-fonts.mjs`. Save `d3-fonts.png`. Pass when both boards render the embedded family and the total stays under 1 MiB.
- [ ] Lane 6. Prepare a directory whose board is missing from `canvas.json`. Save `d3-orphan.png`. Pass when the script exits non-zero and names the orphan file.
- [ ] Lane 7. Install the discovery skill with `artifacts skills install --global --agent claude` into a temp home. Save `d3-install.png`. Pass when the installed skill loads `canvas.md` through the CLI.
- [ ] Lane 8. Export the Lane 3 canvas and re-create it from the ZIP contents. Save `d3-roundtrip.png`. Pass when the new revision SHA-256 equals the original.
- [ ] Lane 9. Run `verify-retained.ts` against the published Lane 3 canvas. Save `d3-retained.png`. Pass when the result is `passed`.
- [ ] Lane 10. Read `docs/decisions/design-canvas.md` and check each claim against D1 and D2 code. Save `d3-decision.png`. Pass when every claim cites a file that supports it.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of `prepare-retained.mjs` for a single HTML file at trunk and head, and at head for a 32-board canvas directory.
- [ ] Probe. `hyperfine --warmup 3 --runs 20` on each input, trunk and head interleaved.
- [ ] Baseline. Record the trunk single-file median first.
- [ ] Rule. Fail when the head single-file median exceeds trunk by more than 10 percent, or when the 32-board median exceeds 500 ms.

**Review gate.** None. D3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the D2 branch after the verdict, patch-id unchanged.
- [ ] The root appends D3 with base set to the D2 branch. The operator lands the chain bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

The prototype answered one question. Can a canvas of artboards render inside the existing content document without loosening its policy? It can.

The throwaway server at `/private/tmp/claude-501/-Users-argote-Documents-dev-artifacts/55f003ee-99b9-4cad-ad5d-ff6ed30b1135/scratchpad/proto/server.mjs` copies `documentPolicy` and `previewPolicy` from `apps/publication/src/document.ts` verbatim. It serves a wrapper and a content document that holds N boards as `srcdoc` iframes with `sandbox="allow-scripts"`. The probe `probe.mjs` in the same folder drove Chrome 156 through Playwright 1.64. It was not committed, so it has no branch or SHA.

Measured results follow.

- Every board's script ran under `frame-src 'none'`, so `srcdoc` frames are not blocked by that directive.
- Each board inherited `connect-src 'none'`. Its `fetch` was blocked and logged as a CSP violation.
- Each board had origin `null` and could not read `parent.document`.
- All boards fired their report in 349 ms for 3 boards, 368 ms for 12, and 385 ms for 24, with zero `securitypolicyviolation` events in the host.
- The 24-board screenshot is `shot-24.png` in the same folder.

Unproven items follow. The prototype did not test the inert renderer in Firefox, pinch zoom on a touch device, or boards near the 1 MiB limit. D2 lanes 8, 9, and the perf block cover them.

## Appendix B. Alternatives rejected

- A trusted wrapper hosting one iframe per board, each loading `/content/<board>`. It needs a nonce script in the wrapper, a new route in both the panel and publication, and one backend read per board. The `srcdoc` design needs none of these.
- A new board table or object storage. Boards fit the existing files array, its limits, and its export, so new storage adds a lifecycle with no benefit at this size.
- The claude.ai Design Component format with `<x-dc>`, `data-props`, and a properties panel. That format exists to support in-browser editing, which this program excludes.
- Shadow DOM boards without frames. Board scripts would share one global scope and could reach each other.

## Appendix C. Risks

- `control-ui` from `cursor-team-kit` is not installed on this host. All lanes drive through `verify-artifacts` and Playwright instead. Every owner records this in the PR body.
- The 1 MiB budget is shared across all boards. Font embedding per board multiplies its cost. D3's `canvas.md` must state the budget and suggest one shared font subset. D3 lane 5 watches it.
- A future Chrome may start applying `frame-src` to `srcdoc`. D2's browser proof fails first in that case, because it asserts that boards run.
- Many live board scripts can cost CPU on a large canvas. D2's perf block sets the 1500 ms budget. A later program can pause offscreen boards if lanes show jank.
- Pan and zoom handlers inside the content frame must not steal Escape or Tab from the wrapper. D2 lane 6 watches it.

## Appendix D. Links and reading list

- Read `docs/decisions/artifacts.md`, `docs/decisions/artifact-document-design.md`, and `docs/decisions/catppuccin-blue.md` before editing.
- Read `apps/publication/src/document.ts` and `apps/publication/src/http.ts` before D2.
- The reference experience is the claude.ai Design canvas the operator linked. This program copies its canvas model of boards, order, notes, and pages, not its editor.
- D1 gets `.claude/skills/how/SKILL.md` for the schema. D2 gets `.claude/skills/interrogate/SKILL.md` for the containment design before code-ready.
- Keep the decision trail per `.claude/skills/show-me-your-work/SKILL.md` under `.audit/design-canvas/trail.md`.

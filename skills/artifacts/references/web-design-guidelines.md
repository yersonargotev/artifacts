# Interface guidelines for HTML artifacts

Use these checks for visual authoring and review. Apply only the checks relevant to the artifact. Keep the requested content and behavior central.

## Accessible, resilient interfaces

- Use semantic headings, buttons, links, and tables. Label controls and icon buttons. Give meaningful images alternative text.
- Make every action keyboard accessible. Keep focus visible and unobscured. Restore focus after dismissing overlays.
- Announce asynchronous status changes without interrupting reading. Pair errors with a useful next action.
- Provide click and keyboard alternatives for gestures. Keep essential information available without hover.
- Preserve zoom and paste. Associate input labels with their controls. Use suitable input types.
- Support narrow viewports, empty results, and long content. Let flex children shrink. Wrap text before hiding overflow.
- Reserve image dimensions. Defer below-fold media. Batch layout reads and writes. Paginate or virtualize long lists when needed.
- Use tabular numerals for comparisons and `Intl` for localized values. Keep units attached to numbers.
- Set native controls to the document's color scheme. Keep hover, active, and focus states distinguishable.
- Avoid motion that blocks interaction. Provide pause controls for extended autoplay and a reduced-motion alternative.

## Motion and interaction detail

Adapt motion to repetition and purpose. Frequent actions should respond immediately. Add animation when it explains a state change or spatial relationship.

Prefer interruptible CSS transitions with named properties. Start around 100 to 160 ms for press feedback and 125 to 250 ms for small overlays. Use an ease-out curve for entry. Anchor popover transforms to their trigger and center modal transforms.

Prefer `transform` and `opacity` for movement. Avoid `transition: all`, large blur effects, and entrance scaling from zero. Keep feedback subtle enough that labels remain readable.

Under `prefers-reduced-motion: reduce`, remove decorative movement and retain immediate state feedback. Gate hover effects with `(hover: hover) and (pointer: fine)`. Do not make content wait for an entrance animation.

## Adapt to the Artifacts sandbox

Keep input-driven calculations in document memory. Use labeled controls without a form submission workflow. Do not imply that an in-document control saves a retained revision or publishes an artifact.

Keep filters and tabs local to the document. Do not depend on host URL synchronization, router packages, persistent storage, network requests, or external fonts. Inline required assets within the snapshot budget.

## Check the result

Inspect the generated document at a narrow and a wide viewport when browser tools are available. Exercise its main controls with keyboard and pointer input. Check long labels, empty results, focus visibility, and reduced motion where applicable.

For a requested audit, identify each issue by element or source location and state its correction. Distinguish source inspection from browser verification. Do not turn ordinary artifact delivery into an unsolicited audit report.

## Sources

Adapted on 2026-10-14 from [Emil Kowalski's design engineering skill](https://raw.githubusercontent.com/emilkowalski/skills/refs/heads/main/skills/emil-design-eng/SKILL.md) and [Vercel's web design guidelines skill](https://raw.githubusercontent.com/vercel-labs/agent-skills/refs/heads/main/skills/web-design-guidelines/SKILL.md).

The accessibility and interface checks incorporate Vercel's Web Interface Guidelines `command.md` as local guidance. Its remote command workflow and output format are not required. The sandbox adaptations are specific to Artifacts.

License notices are retained in [Third-party notices](../THIRD-PARTY-NOTICES.md).

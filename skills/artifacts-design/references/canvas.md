# Author a design canvas

Create a retained `design` snapshot when several HTML boards belong in one canvas. Each board is a complete self-contained HTML document. The canvas supplies placement, page selection, notes, pan, zoom, and a focus view. The calling MCP or CLI skill owns saving and publication.

## Compose the boards

1. Choose a frame size for each board. Common starting sizes are 1440 by 900 for desktop, 390 by 844 for a phone, and 768 by 1024 for a tablet. These are authoring conventions, not schema limits.
2. Place boards in a row with 80 px between their edges. Start another row 120 px below the tallest board in the preceding row. Coordinates are canvas pixels, and boards can use different sizes.
3. Write each board under `boards/` as one UTF-8 `.html` file. Inline its styles, scripts, images, and fonts. Files retained beside a board are downloads, not relative executable assets.
4. Choose one visual direction for the canvas and apply its tokens and typography inside each board. The canvas ground follows the viewer's light or dark theme independently.
5. Define `canvas.json` with the exact index below. Keep snapshot metadata outside the index.

```json
{
	"v": 1,
	"boards": {
		"boards/Desktop.html": { "x": 0, "y": 0, "w": 1440, "h": 900, "title": "Desktop", "page": "overview" },
		"boards/Phone.html": { "x": 1520, "y": 0, "w": 390, "h": 844, "title": "Phone", "page": "overview" },
		"boards/Detail.html": { "x": 0, "y": 0, "w": 1440, "h": 900, "title": "Detail", "page": "detail" },
		"boards/DetailPhone.html": { "x": 1520, "y": 0, "w": 390, "h": 844, "title": "Detail phone", "page": "detail" }
	},
	"order": ["boards/Desktop.html", "boards/Phone.html", "boards/Detail.html", "boards/DetailPhone.html"],
	"notes": {
		"review": { "x": 0, "y": 1020, "w": 390, "text": "Review both layouts.", "page": "overview" }
	},
	"pages": [
		{ "id": "overview", "name": "Overview" },
		{ "id": "detail", "name": "Detail" }
	]
}
```

The first page opens initially. Boards and notes without `page` appear on the first page when pages exist. Without pages, every board and note appears together. A page can reuse the coordinates of another page.

## Index reference

The index and its nested entries reject unknown fields. The complete rules are:

| Field | Rule |
| --- | --- |
| `v` | Required integer `1`. |
| `boards` | Required object with at most 32 entries. Every key matches `^boards/[A-Za-z0-9_][A-Za-z0-9_.-]*\.html$`. Names are case-sensitive and flat. |
| Board `x`, `y` | Required finite numbers from -1,000,000 to 1,000,000 inclusive. Fractions are accepted. |
| Board `w`, `h` | Required finite numbers from 40 to 8000 inclusive. Fractions are accepted. |
| Board `title` | Optional string of 1 to 256 characters. The board path is the display fallback. |
| Board `page` | Optional ID that names a declared page. |
| `order` | Required array of 1 to 32 board paths. It names every board exactly once and contains no other path. Its order controls rendering. |
| `notes` | Optional object with at most 200 entries. Each key is an ID. |
| Note `x`, `y`, `text` | Coordinates use the board coordinate limits. `text` is a required string rendered as escaped text, not HTML. |
| Note `w`, `page` | Optional width from 40 to 8000 and an optional declared page ID. |
| `pages` | Optional array of at most 32 objects with required `id` and `name`. IDs are unique. `name` contains 1 to 256 characters. |
| ID | 1 to 40 ASCII letters, digits, underscores, or hyphens. `__proto__` is rejected. |

Every indexed board has a matching snapshot file with the same `path`, `mediaType: "text/html"`, `encoding: "utf8"`, and the complete HTML in `data`. A snapshot has at most 32 files total, including other retained downloads. The directory preparer rejects every unindexed entry in `boards/`, missing boards, directories, symbolic links, and invalid UTF-8. The snapshot contract itself permits other unindexed attachments.

## Embed fonts within the shared budget

Run the real font helper once for each board after completing its HTML:

```sh
node <design-skill-directory>/scripts/embed-fonts.mjs my-canvas/boards/Desktop.html
node <design-skill-directory>/scripts/embed-fonts.mjs my-canvas/boards/Phone.html
```

For the CLI, resolve `<design-skill-directory>` with `artifacts skills path artifacts-design`. The helper selects bundled Latin font subsets from actual CSS declarations and embeds `data:` WOFF2 faces. It rewrites the board in place and is safe to rerun.

Use one small, consistent selection of bundled families and styles across boards. Each board needs its own embedded font bytes because each iframe is an independent document. A subset cannot be shared through an attachment URL. Three families add about 135 KB per board, so repeated embedding can exhaust the canvas budget. Prefer one family and only the styles the board uses when many boards share one revision. The helper checks one board's 1 MiB limit. The preparer and server check the combined revision.

The shared limit is 1,048,576 decoded bytes. It includes serialized snapshot metadata, UTF-8 index text, every file path and media type, and every decoded file body. Whitespace in `canvas.json` counts. The 1 MiB limit applies to all boards together, not to each board separately.

## Save the canvas

For MCP, send one complete snapshot to `artifacts_create` or `artifacts_update`:

```js
{
	metadata: { title: 'Product layouts', description: 'Desktop and phone review.' },
	content: { kind: 'design', text: JSON.stringify(index) },
	files: boardPaths.map((path) => ({ path, mediaType: 'text/html', encoding: 'utf8', data: boardHtml[path] }))
}
```

Here `index`, `boardPaths`, and `boardHtml` come from your completed source files. Read the saved revision back through `artifacts_read` before reporting persistence.

For the CLI, keep `canvas.json` and `boards/*.html` in one directory. Run the bundled preparer:

```sh
node <cli-skill-directory>/scripts/prepare-retained.mjs ./my-canvas > snapshot.json
artifacts create --snapshot snapshot.json
```

Resolve `<cli-skill-directory>` with `artifacts skills path artifacts-cli`. Use the script at that returned path so its installed contracts dependency resolves. The preparer preserves the index text and board HTML and sorts snapshot files by path. Canvas rendering still follows `order`. It emits a validated snapshot on stdout, uses the directory basename as `metadata.title`, and sets `metadata.description` to `""`. Edit those metadata fields in the emitted JSON before saving when the task calls for a specific title or description. The directory form accepts exactly one positional argument. The named-option form prepares retained-verification configuration and keeps its separate contract.

## Check the retained canvas

Open the exact saved revision in the authenticated panel. Confirm all boards fit on the initial page, select each page, and open a board through its name button. Focus view shows that board at its declared width and height and enables its controls. **Volver al lienzo** returns to the prior pan and zoom. Escape also returns when a canvas control has keyboard focus. After interacting inside a board, use **Volver al lienzo** to return. For Escape, first use Shift+Tab to move focus back to the canvas controls. Embedded boards remain inert in the overview.

Check publication through the protected URL returned by `artifacts_publish`. In unsupported browsers, the canvas displays an inert listing of board source. Rendering uses nested opaque `srcdoc` iframes with `sandbox="allow-scripts"` and the existing content policy. Board scripts can still consume renderer time or briefly perturb focus. The canvas is not an absolute keyboard isolation boundary.

Export retains the index as `content.json` and boards as `files/boards/*.html`. To recreate a snapshot, use the manifest's `metadata`, preserve `content.json` as `content.text`, and reconstruct each file using its declared encoding. The ZIP manifest sorts files by path, matching the directory preparer. Snapshot digests preserve the original `files` array order, so keep that order from an independent saved read when comparing digests after recreation. A directory preparer also derives new metadata. Restore the manifest metadata and original file order before comparing snapshot digests.

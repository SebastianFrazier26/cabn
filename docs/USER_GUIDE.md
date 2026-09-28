# cabn player's guide

cabn turns a folder of files into a small cottagecore world you can walk around. Every **world** is one project. Inside it, **stone fountains** are folders, **portal arches** are files, and bugs in those files show up as **monsters** you beat by fixing the code.

You don't need to read this first: the first world on your shelf has a guide, **Wren**, standing by the bonfire where you arrive. Walk up to her and press `Enter` (or click her) for short tips on any of the topics below. Everything she says is also in [Wren's tips](#wrens-tips) at the end of this page.

## Getting around

- **Walk** with `WASD` or the arrow keys, everywhere: the shelf, a world, and inside a file. Or **click the ground** and you walk there by yourself (a small gold sparkle marks the spot). Pressing any movement key stops a click-walk.
- **Interact** with `Enter`. It's the same key everywhere: it opens whatever you're standing at. Clicking something interactable (the cursor turns into a pointer over it) walks you there and interacts when you arrive.
- **Esc** backs out: out of a file, out of a world when you're near its bonfire, out of an open panel.

### The shelf, worlds, fountains and arches

1. **The shelf** is the hub: a wizard tower surrounded by one **cabin** per world. Walk to a cabin and press `Enter` to go into that world.
2. **A world** starts at its **bonfire**. Clearings around it hold the project's folders, each marked by a **stone fountain** and joined to the others by paths.
3. **Portal arches** ring each clearing, one per file. As you walk up to one, its opening shows a live peek of the file. Stand right at it and a bigger preview opens at the side of the screen. Press `Enter` to step inside.
4. **Inside a file** you walk down a parchment scroll of its lines; a small gold caret in the lane marks where you are. Press `Esc`, or walk back to the arch at the top and press `Enter`, to return to the world where you left it.
5. **The bonfire** is the way home: press `Enter` beside it, or `Esc` anywhere near it, to go back to the shelf.

When a text box has focus (the orb's search box, the spellbook), every key goes to it and none to the game.

## Tools

The hotbar at the bottom of the screen holds your tools. Click a slot or press its key. Inside a file, each slot also shows a short verb (Use, Look, Search, Copy, Edit, Run).

<!-- BEGIN GENERATED guide:tools (packages/engine/src/systems/guideContent.ts) -->
| Tool | Key | What it does |
| --- | --- | --- |
| Opener | `Enter` | Same as pressing Enter: step into a cabin or portal, back out at the bonfire or a file's top arch, face a monster, talk to Wren. |
| Spyglass | `L` | Lists the files in the clearing you're standing in; click one to walk straight to it. |
| Crystal orb | `F` | Searches the whole world by name, path or contents; inside a file it searches that file's lines. Ctrl/Cmd+F opens it too. |
| Bag | `B` | Inside a file: starts picking lines at your spot (Shift+Up/Down stretches the pick), and a second press tucks them into a bag slot (up to 5). |
| Quill | `Q` | Inside a file: opens the spellbook (the editor) on the line nearest you. |
| Wand | `R` | Inside a file: runs it as a simulated trace, a spark walking the code line by line. The code itself never runs unless you started a local server with --allow-exec. |
<!-- END GENERATED guide:tools -->

The time-of-day switch in the top-left corner is the one setting: **Auto** follows your clock (day from 6am to 6pm), or pin **Day** or **Night**. At night the panels switch to a dark theme too.

## Editing: the spellbook

Inside a file, press `Q` (the quill) to open the **spellbook**, a two-page book with the editor on the left and the file's errors and a quick run console on the right. The caret starts on the line nearest you.

- Save with `Ctrl+S` / `Cmd+S`. `Esc` closes the book, and asks first if you have unsaved changes.
- While the book is open, your bag slots become paste buttons; `Alt+1` to `Alt+5` (`Option` on macOS) pastes a slot at the caret.
- Your edits are kept in this browser's local storage, one save per world. An edited file gets a small ✎ marker on its arch. The spyglass panel can reset one file, or the whole world ("reset world…").

The toolbar above the book has these tools; hover one to see its shortcut for your platform:

<!-- BEGIN GENERATED guide:spellbook (packages/engine/src/systems/guideContent.ts) -->
| Tool | Shortcut (Windows/Linux / macOS) | What it does |
| --- | --- | --- |
| Run | `Ctrl+Enter` / `Cmd+Enter` | Cast (run) this file |
| Save | `Ctrl+S` / `Cmd+S` | Seal (save) the file |
| Find | `Ctrl+F` / `Cmd+F` | Find in file |
| Replace | `Ctrl+H` / `Cmd+H`, `Ctrl+Alt+F` / `Option+Cmd+F` | Find & replace (regex toggle in the panel) |
| Rename | `F2` | Rename symbol in this file |
| Format | `Shift+Alt+F` / `Shift+Option+F` | Format document |
| Comment | `Ctrl+/` / `Cmd+/` | Toggle line comment |
| Go to line | `Ctrl+G` | Go to line[:column] |
| Symbol | `Ctrl+Shift+O` / `Shift+Cmd+O` | Go to symbol in file |
| Fold all | `Ctrl+Alt+[` / `Ctrl+Option+[` | Fold every block |
| Unfold | `Ctrl+Alt+]` / `Ctrl+Option+]` | Unfold every block |
<!-- END GENERATED guide:spellbook -->

### Running a file

Press `R` (the wand) inside a file, or the book's Run tool, to start a **run**: a parchment unrolls and a spark walks the file line by line.

| Control | Key |
| --- | --- |
| Play / pause | `Space` |
| One step | `N` |
| Speed | `1`, `2` or `4` |
| Stop | `Esc` |

A run is a **simulated trace**: cabn reads the code and walks through it without executing any of it. That's the only kind of run a hosted cabn ever does. See [`cabn serve --allow-exec`](#running-code-for-real-cabn-serve---allow-exec) for the one exception.

## Monsters

Every problem cabn finds in a world's files when it builds the world becomes a monster. A monster hovers near its file's arch in the world and stands beside its line inside the file. The counter in the bottom-left corner shows how many bugs are left in the world you're in.

<!-- BEGIN GENERATED guide:monsters (packages/engine/src/systems/guideContent.ts) -->
| Monster | Error code | The bug it stands for |
| --- | --- | --- |
| Ghost | `NullTypeError` | An import or markdown link that points at a file that isn't in this world. |
| Rot-sprite | `Corrupted` | Invalid JSON, or markdown frontmatter that's opened but never closed. |
| Warded Mimic | `InvalidMode` | An undecodable byte in the text (it shows up as the replacement character, U+FFFD). |
| Gremlin | `IoError` | A bracket left open, mismatched or stray, or a string that never ends. |
| Ouroboros | `OuroborosError` | Two or more files importing each other in a circle. |
| Will-o'-Wisp | `WispNote` | A TODO, FIXME, XXX or HACK note in a comment. Harmless and never fights; remove the note and save, and it drifts away. |
<!-- END GENERATED guide:monsters -->

### New monsters (coming soon)

<!-- Added alongside the extended annotators on feat/m10-monster-taxonomy (in progress when this was written, 2026-09-28). When those species land, move each into MONSTER_GUIDE in packages/engine/src/systems/guideContent.ts (guideDoc.test.ts fails until every species has an entry) and delete this section. -->

Five more species are on their way, for new kinds of bugs cabn is learning to spot: syntax errors, leaked secrets, dead code, code smells, and bugs it can't classify. Their names are the **imp**, the **magpie**, the **skeleton**, the **bramble** and the **shade**. Which one stands for which bug will be listed in the table above once they arrive.

### Fixing code defeats monsters

1. Enter the monster's file, walk up to it and press `Enter` (or click it). A banner names the monster and shows the error. (`Esc` backs out before the book opens.)
2. The spellbook opens on the offending line. Fix the problem and save.
3. Saving re-checks every monster in that file. A fixed bug's monster fades away with a "Fixed!" sparkle. If the fix didn't take, it shrugs off the hit and gives you a hint, and the book stays open so you can try again.

Will-o'-wisps never fight: remove the `TODO` (or `FIXME`, `XXX`, `HACK`) and save, and the wisp drifts away. When the last monster in a world falls, you get a victory toast.

## Previews: pictures, sound, PDFs and web pages

- **Code and notes**: an arch shows the start of its file, with syntax colour for code and headings for markdown. The bigger preview at the side shows more.
- **Pictures** (PNG, JPEG, GIF, WebP), **audio** (MP3, WAV, OGG) and **PDFs** travel inside the world. Audio gets a waveform with play, pause and seek. A PDF shows its first page in the arch and pages through in the bigger preview and inside the file.
- **CSV and TSV** files show as a table.
- **Web pages**: a world's author can point an arch at a real web page. Walk up to it and the live page appears in the arch's opening. Click the page, or **Open in browser** in the side preview, to open it in a new tab. Only sites the author allowed can appear, and only over https.
- **Sealed chests**: a file that's too big, looks like it holds a secret, or isn't safe to show (SVG, for example, can carry scripts) stays a sealed chest that shows its name, size and the reason.

## For world authors: `cabn.json`

A `cabn.json` at the root of a project changes how its world is built. Every field is optional except the version.

```json
{
	"cabnConfigVersion": 1,
	"previews": {
		"README.md": { "kind": "image", "src": "assets/logo.png" },
		"NOTES.txt": { "kind": "text", "text": "A short blurb shown in the arch." },
		"docs/site.md": { "kind": "url", "url": "https://example.com/", "title": "Project website" }
	},
	"allowedEmbedOrigins": ["https://example.com"],
	"media": { "maxFileBytes": 10485760, "maxTotalBytes": 104857600 },
	"guide": false
}
```

- **`previews`** overrides a file's arch preview. `kind` is `image` (`src` is another file in the project), `markdown` (show a different markdown file), `text` (a short blurb, up to 2000 characters) or `url` (a live web page, with an optional `title` and `fallbackImage`). Paths are relative to the project root.
- **`allowedEmbedOrigins`** lists the exact `https://` origins a `url` preview may come from: no paths, no wildcards. A `url` preview whose origin isn't listed fails the build.
- **`media`** raises or lowers the caps on picture/audio/PDF bytes shipped in the world. The defaults are 5 MB per file and 50 MB per world; the ceiling is 25 MB / 250 MB.
- **`guide`**: `false` hides Wren. Leave it out for the default: she appears in the **first world of a shelf**, meaning the first entry in `shelf.json`'s `worlds` list (the order `cabn shelf` was given the worlds in), and in any world opened on its own without a shelf, such as `cabn serve`. She never appears in the other worlds on a shelf.

See [`packages/world-schema/README.md`](../packages/world-schema/README.md) for the full format.

## Running code for real: `cabn serve --allow-exec`

```sh
cabn serve ./my-project --allow-exec
```

`cabn serve` builds a world from a folder and serves it at `http://127.0.0.1:<port>/`, on your own machine only. Without `--allow-exec` the wand still only simulates, exactly like the hosted demo.

**`--allow-exec` runs your code for real.** Pressing `R` on a `.py`, `.js`, `.mjs` or `.ts` file then executes it on your computer with `python3` or `node`. Only use it on a folder whose code you trust. cabn limits what it can (127.0.0.1 only, a per-session token, a 10-second default timeout, capped output, no paths outside the folder), but the code itself runs with your permissions. It prints a warning banner when it starts. The [README](../README.md#cabn-serve--running-a-file-for-real-locally-only) has the details.

## Wren's tips

Everything Wren says, word for word. On macOS she names `Cmd` and `Option` where this page lists both.

<!-- BEGIN GENERATED guide:tips (packages/engine/src/systems/guideContent.ts) -->
> Well met, traveler! I'm Wren, keeper of this bonfire. Every file here is a portal and every folder a fountain. What shall I tell you about?

#### Moving

- Walk with WASD or the arrow keys. Or click the ground and you'll stroll there by yourself; any movement key stops a stroll.
- Press Enter to use whatever you're standing at. Clicking it works too: you walk over and use it when you arrive.
- The shelf holds one cabin per world. Inside a world, stone fountains mark folders and portal arches are files.
- Walk up to an arch to peek at its file, then press Enter to step inside. Esc, or the arch at the top of a file, takes you back out.
- This bonfire is the way home: press Enter beside it, or Esc nearby, to return to the shelf.

#### Tools

- The hotbar at the bottom of the screen holds your tools. Click a slot or press its key.
- Spyglass (L): Lists the files in the clearing you're standing in; click one to walk straight to it.
- Crystal orb (F): searches the whole world by name, path or contents. Inside a file it searches just that file. Ctrl/Cmd+F opens it too.
- Bag (B): inside a file, starts picking lines. Shift+Up/Down stretches the pick; B again tucks it into your bag.
- Quill (Q) opens the spellbook to edit a file. Wand (R) runs it as a gentle, simulated trace.
- The key tool (Enter) is the same as pressing Enter, for when a click is handier.

#### Monsters

- Bugs in the files take the shape of monsters. They hover by their file's arch, and stand beside their line inside the file.
- Ghost: An import or markdown link that points at a file that isn't in this world. Rot-sprite: Invalid JSON, or markdown frontmatter that's opened but never closed.
- Warded Mimic: An undecodable byte in the text (it shows up as the replacement character, U+FFFD). Gremlin: A bracket left open, mismatched or stray, or a string that never ends.
- Ouroboros: Two or more files importing each other in a circle. Will-o'-Wisp: A TODO, FIXME, XXX or HACK note in a comment. Harmless and never fights; remove the note and save, and it drifts away.
- Inside the file, walk up to a monster and press Enter (or click it). The spellbook opens on its line: fix the bug, save, and it's defeated!

#### Editing

- Inside a file, press Q to open the spellbook on the line nearest you.
- Save with Ctrl+S / Cmd+S. Esc closes the book, and asks first if you have unsaved changes.
- The book's toolbar has Find (Ctrl+F / Cmd+F), Rename (F2), Format (Shift+Alt+F / Shift+Option+F), Comment (Ctrl+/ / Cmd+/) and more. Hover a tool to see its key.
- While the book is open, bag slots become paste buttons, or press Alt/Option+1 to 5.
- Run a file with R (or Ctrl+Enter / Cmd+Enter in the book). Space plays or pauses, N steps, 1, 2 or 4 sets the speed, Esc stops.
- Edits are kept in this browser, one save per world. The spyglass can reset a single file, or the whole world.

#### Previews

- Each arch shows a live peek of its file in the opening: code, notes, pictures, even a table for CSV files.
- Stand right at an arch and a bigger preview opens at the side of the screen.
- Pictures, audio and PDFs travel with the world. Audio gets a waveform to play; PDFs page through in the bigger preview and inside the file.
- Some arches hold a real web page. Click the page in the arch, or Open in browser, to visit it in a new tab. Only sites the world's author allowed can appear.
- A file that's too big, looks secret or isn't safe to show stays a sealed chest that says why.
- The switch in the top-left corner sets the time of day: Auto follows your clock, or pin Day or Night.
<!-- END GENERATED guide:tips -->

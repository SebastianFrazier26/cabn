# cabn player's guide

cabn turns a folder of files into a small cottagecore world you can walk around. Every **world** is one project. Inside it, **stone fountains** are folders, **portal arches** are files, and bugs in those files show up as **monsters** you beat by fixing the code.

You don't need to read this first: the first world on your shelf has a guide, **Wren**, standing by the bonfire where you arrive. Walk up to her and press `Enter` (or click her) for short tips on any of the topics below. Everything she says is also in [Wren's tips](#wrens-tips) at the end of this page.

## Getting around

- **Walk** with `WASD` or the arrow keys on the shelf and in a world. Or **click the ground** and you walk there by yourself (a small gold sparkle marks the spot). Pressing any movement key stops a click-walk.
- **Interact** with `Enter` in a world or on the shelf. Clicking something interactable walks you there and interacts when you arrive. Inside a text file, `Enter` inserts a newline; click a monster or use `Alt+Enter` (`Option+Enter` on macOS) to face it.
- **Esc** backs out: out of a file, out of a world when you're near its bonfire, out of an open panel.

### The shelf, worlds, fountains and arches

1. **The shelf** is the hub: a wizard tower surrounded by one **cabin** per world. Walk to a cabin and press `Enter` to go into that world.
2. **A world** starts at its **bonfire**. Clearings around it hold the project's folders, each marked by a **stone fountain** and joined to the others by paths.
3. **Portal arches** ring each clearing, one per file. As you walk up to one, its opening shows a live peek of the file. Stand right at it and a bigger preview opens at the side of the screen. Press `Enter` to step inside.
4. **Inside a text file** you write directly on a parchment page. Click to place the caret, use arrows to move it, and type to edit. Drag or use `Shift` with arrows to select; `Ctrl+S` / `Cmd+S` saves. Press `Esc`, or click the top arch, to return to the world. Unsaved edits prompt Save & leave / Discard / Keep writing. Binary, media and sealed files stay read-only.
5. **The bonfire** is the way home: press `Enter` beside it, or `Esc` anywhere near it, to go back to the shelf.

When a text box has focus (the orb's search box, the spellbook or the file page's caret), every key goes to it and none to the game.

## Tools

### Current-world map

The minimap in the top-right shows the current world's folders, paths, files, player and undefeated monsters. Bright clearings are folders visited in this world's saved progress; unvisited clearings remain visible in a darker color. Gold marks you, cyan squares mark files, and red marks monsters at their portal or path anchors. If you walk beyond the mapped clearings, your marker stays at the nearest map edge.

Press `M`, or click **Map (M)**, for a larger centered map. Select a cyan file marker or a named destination below the map to walk to its arch using the same navigation as the spyglass. This does not open the file automatically. `M`, `Esc` or **Close** closes the larger map. Movement pauses while it is open; opening it cancels any existing click-walk. Map keys do not run while typing or while Wren is speaking. The map is hidden on the shelf and inside files, and resets when changing worlds.

The hotbar at the bottom of the screen holds your tools. Click a slot or press its key. Inside a text file, add `Alt` (`Option` on macOS) to the tool keys so plain letters can type. Each slot shows a short verb (Use, Look, Search, Copy, Edit, Run).

<!-- BEGIN GENERATED guide:tools (packages/engine/src/systems/guideContent.ts) -->
| Tool | Key | What it does |
| --- | --- | --- |
| Opener | `Enter` | Enter uses cabins, portals, the bonfire and Wren. Inside a text file, Alt/Option+Enter faces a nearby monster; click the top arch or press Esc to leave. |
| Spyglass | `L` | Lists the files in the clearing you're standing in; click one to walk straight to it. Inside a text file, use Alt/Option+L. |
| Crystal orb | `F` | Searches the whole world by name, path or contents; inside a file it searches that file's lines. Ctrl/Cmd+F opens it too; Alt/Option+F works on the page. |
| Bag | `B` | Inside a text file: Alt/Option+B copies the caret's selection, or its whole line, into a bag slot (up to 5). |
| Quill | `Q` | Inside a text file: Alt/Option+Q opens the spellbook on the same caret, edits and undo history as the page. |
| Wand | `R` | Inside a text file: Alt/Option+R runs the current buffer, including unsaved edits, as a simulated trace. Code never runs unless the local server has --allow-exec. |
<!-- END GENERATED guide:tools -->

The time-of-day switch in the top-left corner is the one setting: **Auto** follows your clock (day from 6am to 6pm), or pin **Day** or **Night**. At night the panels switch to a dark theme too.

## Editing: the spellbook

Inside a text file, press `Alt+Q` (`Option+Q` on macOS) to open the **spellbook**, a two-page book with the editor on the left and the file's errors and a quick run console on the right. It shares the page's caret, unsaved edits and undo history.

- Save with `Ctrl+S` / `Cmd+S`. `Esc` closes the book and keeps edits on the page. Leaving the file asks first if you have unsaved changes.
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

Press `Alt+R` (`Option+R` on macOS) inside a text file, or the book's Run tool, to start a **run** of the current buffer, including unsaved edits: a parchment unrolls and a spark walks the file line by line.

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
| Hex Imp | `SyntaxError` | A parse error in JavaScript, Python, CSS or HTML. TypeScript is excluded; bracket problems belong to gremlins. |
| Magpie | `LeakedSecret` | A password, API key or other secret left in the code. Remove it and rotate any real exposed credential. |
| Skeleton | `DeadCode` | An unused import or unreachable code after an unconditional exit. |
| Bramble | `CodeSmell` | Tangled code: deep nesting, long functions, duplicated blocks or leftover debug logging. |
| Shade | `UnknownBug` | A finding from an external linter or scanner that has no more specific monster class. |
<!-- END GENERATED guide:monsters -->

### Fixing code defeats monsters

1. Enter the monster's file and click it, or place the caret within two lines and press `Alt+Enter` (`Option+Enter` on macOS). A banner names the monster and shows the error. (`Esc` backs out before the book opens.)
2. The spellbook opens on the offending line. Fix the problem and save.
3. Saving re-checks every monster in that file. A fixed bug's monster fades away with a "Fixed!" sparkle. If the fix didn't take, it shrugs off the hit and gives you a hint, and the book stays open so you can try again.

Will-o'-wisps never fight: remove the `TODO` (or `FIXME`, `XXX`, `HACK`) and save, and the wisp drifts away. When the last monster in a world falls, you get a victory toast.

## Previews: pictures, sound, PDFs and web pages

- **Code and notes**: an arch shows the start of its file, with syntax colour for code and headings for markdown. The bigger preview at the side shows more.
- **Pictures** (PNG, JPEG, GIF, WebP), **audio** (MP3, WAV, OGG) and **PDFs** travel inside the world. Audio gets a waveform with play, pause and seek. A PDF shows its first page in the arch and pages through in the bigger preview and inside the file.
- **CSV and TSV** files show as a table.
- **Web pages**: a world's author can point an arch at a real web page. Approach it and the same live page moves into the side preview, where you can interact with it. Sites that refuse framing show a title card and **Open in browser** instead. Only sites the author allowed can appear, and only over https.
- **Sealed chests**: a file that's too big, looks like it holds a secret, or isn't safe to show (SVG, for example, can carry scripts) stays a sealed chest that shows its name, size and the reason.

## Signs

Wooden signposts stand beside some arches and fountains. Each one is a note the world's owner wrote. Walk up to one and a small card shows it at the side; press `Enter` or click it to read the whole sign, and `Esc` to put it down. Underlined words are links: one to a file, folder or another sign walks you there and makes it glow for a moment (it never goes in for you); one marked `↗` opens a web page in a new tab. A dashed underline means the link points at something that isn't in this world.

### Writing signs (world owners)

A sign is a `.seyn` text file kept next to the files it describes, such as `src/index.seyn` beside `src/index.ts`:

```
@near /src/index.ts
# Start here

This is the *entry point*.

- Routes live in [[routes/|the routes folder]]
- More at [[https://example.com/|the project site]]
```

`@near` says what it stands beside (a file, or a folder ending in `/`). `#` starts the title; `- ` starts a bullet; `*stars*` emphasise; `[[target|label]]` links. [`SEYN.md`](SEYN.md) has every rule.

Only on your own `cabn serve` page can you place signs from inside the world: press `P` (the signpost in the hotbar), click where it should stand, write it in the editor (the preview updates as you type), and save. It's written into your folder and appears at once. Open one of your signs to edit or delete it. Nobody else ever gets the signpost item, including visitors to a hosted world. `cabn serve --no-owner` hides it for you too.

## AI pets (bring your own key)

A pet is a small companion that follows you around a world and answers questions about its files, using **your own** account with an AI provider. Click **Pet** under the day/night switch (top left, in any world), pick a provider, paste your API key and press **Summon pet**.

| Provider | Pet | Key |
| --- | --- | --- |
| Claude (Anthropic) | Clementine, a little orange cat | yes |
| OpenAI | Onyx, a black ferret | yes |
| Gemini (Google) | Gem, a bluebird | yes |
| Ollama (local) | Lulu, a llama | no, it runs on your computer |
| Qwen (Alibaba Model Studio) | Quill, an owl | yes (pick your key's region) |
| DeepSeek | Dew, a whale that floats beside you | yes |

- **Talk to it**: click the pet, or press `Enter` when nothing else (an arch, a sign, Wren, the bonfire) is in reach. Type a question and press `Enter` (`Shift+Enter` for a new line). **Stop** cancels an answer in progress; `Esc` closes the chat.
- **What it can do**: list the world's files, read their raw text (long files in pieces), search them, and **propose edits**. It never runs code and never changes a file by itself. Files it read show under its answer; click one to walk to that file's arch.
- **Proposed edits**: the answer shows a proposal card. **Review in spellbook** opens the file with a before/after diff on the spellbook's right page. **Accept** puts the change into the file's buffer as one undoable step (it isn't saved yet: save with `Ctrl+S` / `Cmd+S` as usual, which re-checks the file's monsters); **Reject** drops it. If the file changed since the pet looked, the proposal is marked stale instead.
- **Model**: each provider has a short list; the first is the default. **Test connection** sends one tiny request, so it checks the key, the model and that your browser can reach the provider.
- **Out of credits**: the pet tells you its "communication spell has worn off" and links your provider's billing page. A wrong key, a rate limit or a network problem get their own messages.
- The pet is only in worlds: not on the shelf, and not inside a file.

**Where your key goes.** Only into this browser. By default it's kept for this tab only (session storage) and gone when you close the tab. **Remember on this device** keeps it in local storage until you press **Forget key**; the key is then only as safe as this browser profile, so prefer a key with a spending limit. Questions go straight from your browser to the provider you picked; cabn's servers, the site hosting the game and `cabn serve` never see, relay or store the key. It isn't in world saves, exports, URLs or logs, and the page never shows it again after you save it. A file an undefeated magpie is guarding (a leaked secret) is not sent to the provider at all.

**Ollama** needs no key, but it has to be reachable from the page. A world opened on your own machine works out of the box. A hosted (https) page can only reach it if Ollama allows that page's origin (`OLLAMA_ORIGINS`) and the browser allows the page to talk to your local network; Safari doesn't.

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
- **`embedCheck`**: `false` skips the build-time check for sites that refuse framing. `cabn build --offline` and `cabn serve --offline` also skip it; uploaded worlds are always converted offline.
- **`annotate`** adjusts code-smell thresholds. External ESLint JSON or SARIF results can be attached with repeatable `cabn build --findings <file>` flags.

See [`packages/world-schema/README.md`](../packages/world-schema/README.md) for the full format.

## Running code for real: `cabn serve --allow-exec`

```sh
cabn serve ./my-project --allow-exec
```

`cabn serve` builds a world from a folder and serves it at `http://127.0.0.1:<port>/`, on your own machine only. Without `--allow-exec` the wand still only simulates, exactly like the hosted demo.

**`--allow-exec` runs your code for real.** Using the wand (`Alt+R` / `Option+R`) on a `.py`, `.js`, `.mjs` or `.ts` file then executes it on your computer with `python3` or `node`. Only use it on a folder whose code you trust. cabn limits what it can (127.0.0.1 only, a per-session token, a 10-second default timeout, capped output, no paths outside the folder), but the code itself runs with your permissions. It prints a warning banner when it starts. The [README](../README.md#cabn-serve--running-a-file-for-real-locally-only) has the details.

## Wren's tips

Everything Wren says, word for word. On macOS she names `Cmd` and `Option` where this page lists both.

<!-- BEGIN GENERATED guide:tips (packages/engine/src/systems/guideContent.ts) -->
> Well met, traveler! I'm Wren, keeper of this bonfire. Every file here is a portal and every folder a fountain. What shall I tell you about?

#### Moving

- On the shelf and in a world, walk with WASD or the arrow keys. Or click the ground to stroll there. Inside a text file, click to place the caret; arrows move it and letters type.
- Press Enter to use whatever you're standing at. Clicking it works too: you walk over and use it when you arrive.
- The shelf holds one cabin per world. Inside a world, stone fountains mark folders and portal arches are files.
- Walk up to an arch to peek at its file, then press Enter to step inside. Esc, or the arch at the top of a file, takes you back out.
- This bonfire is the way home: press Enter beside it, or Esc nearby, to return to the shelf.
- The map in the top-right shows folders, paths, files, you and undefeated monsters. Bright clearings are places you've visited. Press M for a larger map, select a file to walk there, and press Esc to close. Map keys stay out of text boxes.

#### Tools

- The hotbar at the bottom of the screen holds your tools. Click a slot or press its key.
- Spyglass (L): Lists the files in the clearing you're standing in; click one to walk straight to it. Inside a text file, use Alt/Option+L.
- Crystal orb (F): searches the whole world by name, path or contents. Inside a file it searches just that file. Ctrl/Cmd+F opens it too.
- Bag (Alt/Option+B): copies the caret's selection, or its whole line, into your bag. Shift+arrows or dragging selects text.
- Quill (Alt/Option+Q) opens the spellbook on the page's caret and edits. Wand (Alt/Option+R) runs the current buffer as a gentle, simulated trace.
- Inside a text file, use Alt/Option+L for the spyglass and Alt/Option+F for the orb. Alt/Option+Enter faces a nearby monster; plain Enter inserts a newline.

#### Monsters

- Bugs in the files take the shape of monsters. They hover by their file's arch, and stand beside their line inside the file.
- Ghost: An import or markdown link that points at a file that isn't in this world. Rot-sprite: Invalid JSON, or markdown frontmatter that's opened but never closed.
- Warded Mimic: An undecodable byte in the text (it shows up as the replacement character, U+FFFD). Gremlin: A bracket left open, mismatched or stray, or a string that never ends.
- Ouroboros: Two or more files importing each other in a circle. Will-o'-Wisp: A TODO, FIXME, XXX or HACK note in a comment. Harmless and never fights; remove the note and save, and it drifts away.
- Hex Imp: A parse error in JavaScript, Python, CSS or HTML. TypeScript is excluded; bracket problems belong to gremlins. Magpie: A password, API key or other secret left in the code. Remove it and rotate any real exposed credential.
- Skeleton: An unused import or unreachable code after an unconditional exit. Bramble: Tangled code: deep nesting, long functions, duplicated blocks or leftover debug logging.
- Shade: A finding from an external linter or scanner that has no more specific monster class.
- Inside the file, click a monster or press Alt/Option+Enter with the caret within two lines of it. The spellbook opens on its line: fix the bug, save, and it's defeated!

#### Editing

- Write directly on the page, or press Alt/Option+Q to open the spellbook. Both share the caret, unsaved edits and undo history.
- Save with Ctrl+S / Cmd+S. Esc closes the book and keeps your edits on the page. Leaving the file asks Save & leave, Discard or Keep writing if edits are unsaved.
- The book's toolbar has Find (Ctrl+F / Cmd+F), Rename (F2), Format (Shift+Alt+F / Shift+Option+F), Comment (Ctrl+/ / Cmd+/) and more. Hover a tool to see its key.
- While the book is open, bag slots become paste buttons, or press Alt/Option+1 to 5.
- Run a file with Alt/Option+R (or Ctrl+Enter / Cmd+Enter in the book). Space plays or pauses, N steps, 1, 2 or 4 sets the speed, Esc stops.
- Edits are kept in this browser, one save per world. The spyglass can reset a single file, or the whole world.

#### Previews

- Each arch shows a live peek of its file in the opening: code, notes, pictures, even a table for CSV files.
- Stand right at an arch and a bigger preview opens at the side of the screen.
- Pictures, audio and PDFs travel with the world. Audio gets a waveform to play; PDFs page through in the bigger preview and inside the file.
- Some arches hold a real web page. Approach to move it into the side preview and interact there. Sites that refuse framing show a title card and Open in browser instead. Only allowed sites can appear.
- A file that's too big, looks secret or isn't safe to show stays a sealed chest that says why.
- The switch in the top-left corner sets the time of day: Auto follows your clock, or pin Day or Night.
<!-- END GENERATED guide:tips -->

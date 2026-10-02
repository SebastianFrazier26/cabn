# `.seyn` — cabn signs

A `.seyn` file is a **sign**: a short piece of owner-written documentation or
directions that stands in the world as a wooden signpost instead of becoming a
portal. It is plain text with a handful of rules — simpler than Markdown, a
little more than a `.txt`.

Signs live next to the files they describe (`src/index.seyn` beside
`src/index.ts`). The parser is `parseSeyn()` in `@cabn/world-schema`
(`packages/world-schema/src/seyn.ts`); the converter, the engine's popup and
the owner editor's live preview all use that one function.

## Example

```
@near /src/index.ts
@offset 60 -20
# Start here

This is the *entry point*. Everything else hangs off it.

- Config lives in [[/config/|the config folder]]
- The walkthrough continues on [[/docs/tour.seyn|the next sign]]
- Background reading: [[https://example.com/guide|the guide]]
```

## Structure

A file is an optional **header**, then a **body**.

### Header

Header lines come first, one per line, each starting with `@`. The header
ends at the first line that does not start with `@`.

| Line | Meaning |
| --- | --- |
| `@near <path>` | What the sign stands beside: a file (its portal arch) or a folder ending in `/` (its fountain; `/` alone is the bonfire). Same path rules as links below. |
| `@offset <dx> <dy>` | Preferred spot, in whole world pixels from the target's centre (`dx` right, `dy` down), each clamped to ±320. |

Without `@near`, a sign stands by the fountain of the folder it is stored in.
The game still chooses the final spot: if the preferred spot would cover an
arch, a path, the bonfire or another sign, the nearest clear spot is used.
Unknown `@` lines are ignored (with a warning), so future header keys will not
break older readers. If `@near` or `@offset` appears twice, the first one wins.

### Body

- **Title** — if the first non-blank body line starts with `#`, the rest of
  that line is the title. Only the first such line counts; a later `# ...`
  line is ordinary text. With no title line, the sign is titled by its file
  name.
- **Paragraphs** — runs of non-blank lines, separated by blank lines.
  Consecutive lines join with a single space.
- **Bullets** — a line starting with `- ` (dash, space) is one bullet.
  Consecutive bullet lines form one list. A bullet is exactly one line.

### Inline

- `*emphasis*` — a `*` directly followed by a non-space character, up to the
  next `*` directly preceded by a non-space character on the same paragraph or
  bullet. No nesting. An unmatched `*` is plain text.
- `[[target]]` or `[[target|label]]` — a link. The label is plain text
  (defaults to the target's name). Whitespace around the target and label is
  trimmed; a target containing whitespace is invalid.
- `\` escapes the next character when it is one of `` \ * [ ] | @ # - ``, so
  `\*` is a literal star and `\@` at the start of the body is literal text.
  Before any other character the backslash is literal.

## Link targets

| Target | Links to |
| --- | --- |
| `https://…` | A web page. Opens in a new tab (`noopener noreferrer`). No other scheme is allowed, and URLs with a user name or password are rejected. |
| `path/ending/in/` | A folder's fountain. `/` alone is the world root (the bonfire). |
| `path/to/name.seyn` | Another sign. |
| anything else | A file's portal arch. |

Paths starting with `/` are relative to the world root; anything else is
relative to the folder the sign is stored in. `.` and `..` segments are
resolved; a path that climbs above the root, contains `\`, an empty segment or
a control character is invalid. Any other `scheme:` prefix (`http:`,
`javascript:`, `mailto:`…) makes the link invalid, which also means a file
whose name contains `:` before its first `/` cannot be linked.

Invalid links, and links to things that are not in the world, render as plain
text with a note — never as a clickable link. Following an internal link walks
the player to the target and highlights it; it never enters a portal on its
own.

## Limits and safety

- At most 16 KiB (`SEYN_MAX_BYTES`). Longer input is cut off at that size.
- A UTF-8 BOM is dropped, CRLF/CR become LF, tabs become spaces, and other
  control characters are removed.
- `parseSeyn` never throws: malformed input always yields a document, with
  anything it had to drop listed in `warnings`.
- Nothing in a sign is ever interpreted as HTML. The engine renders it as
  React text nodes.

## In the bundle

`.seyn` files are not portals. The converter lists them in a separate
`signs.json` beside `world.json` (`SIGN_INDEX_FILENAME`,
`packages/world-schema/src/signs.ts`), for the same compatibility reason as
`media.json`, `monsters.json` and `embeds.json`: `world.json` is parsed
strictly by every engine ever shipped, so new fields there would make an older
engine reject the whole world. An older engine never asks for `signs.json`, so
it shows the world without signs. `CABN_VERSION` is unchanged. The engine
reads `signs.json` entry by entry, so a bad entry drops only that sign.

Each entry has the sign's path, its raw source, and the anchor the converter
resolved (a portal id or a cluster id). Sign text is also added to the
search index.

## Who can change signs

Everyone sees signs, including in hosted builds. Only the world owner can
place, edit or delete them, and only through a local `cabn serve --owner`
page, which gets the owner's toolkit (`O`) with a Place sign entry. Saves go through a loopback-only,
token-authenticated owner API that writes only `.seyn` files inside the served
folder. See the `cabn serve` section of the README.

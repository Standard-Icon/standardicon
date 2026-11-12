# The Standard Icon Set

{{count}} free SVG line icons, drawn on a 16px grid, and a small CLI that adds them to your project. MIT licensed.

> **Early version.** This is an alpha ({{version}}). Names, sizes and defaults may still change before 1.0.0, so pin the version if you depend on it.

Browse every icon at [standardicon.com](https://standardicon.com).

- **Every size.** Sizes are 16, 18, 20, 22, 24, 28, 32, 40 and 48. Lines grow with the size, like text: regular is 1.33px at 18 and 1.78px at 24.
- **Five weights.** Lines at 18px: thin 1px, regular 1.33px (the default), semibold 1.5px, bold 2px and black 2.5px.
- **Plain SVG.** Icons draw in `currentColor`, so they take the color of the text around them. No runtime, no font, no framework.
- **Works offline.** Every icon ships inside this package. No account or API key.

## Which to use

- **A React project:** use [`@standardicon/react`](https://www.npmjs.com/package/@standardicon/react). One typed component per icon, such as `<ClockIcon size={20} />`, and only the icons you import are bundled.
- **Anything else:** use this CLI to copy SVG files into your project. It's a build-time tool, so install it as a dev dependency (or run it with `npx`), never as a regular dependency.
- **An AI app that can't run commands:** the optional [`@standardicon/mcp`](https://www.npmjs.com/package/@standardicon/mcp) server.

## Install

Run it without installing:

```sh
npx standardicon@latest add arrow-up check search
```

Or add it to a project so everyone gets the same set:

```sh
npm install --save-dev standardicon
npx standardicon add arrow-up
```

Pin a version, such as `npx standardicon@{{version}}`, for repeatable builds. `@latest` picks up new icons.

## Picking a size

Pick the size from the text the icon sits beside:

| Text | Icon |
| --- | --- |
| 12 to 13px | 16 |
| 14 to 15px | 18 (the default) |
| 16 to 17px | 20 |
| 18 to 19px | 22 |
| 20 to 21px | 24 |
| Larger headings | 28 to 48 |

A sidebar title or heading in larger type needs a larger icon than the items under it.

Every size is the same 16px drawing scaled up, lines included, so one SVG file works at any size: add it once and set its `width` and `height`, or size it with CSS. You don't need a copy per size.

## Commands

### add

Writes SVG files, by default into `./icons`.

```sh
npx standardicon add arrow-up check search
npx standardicon add arrow-up --size 20 --out src/icons
npx standardicon add arrow-up check --weight thin
npx standardicon add arrow-up --size 32 --weight bold
```

`add` never silently replaces your files:

- A file that doesn't exist is created.
- A file that already matches is left alone and reported as unchanged.
- A file that exists with different content stops the whole command, and nothing is written. Run again with `--force` to overwrite it.

Use `--dry-run` to see what would happen first.

### get

Prints one SVG, for pasting inline.

```sh
npx standardicon get arrow-up --size 20
```

### search

Finds icons by meaning, name or what they look like. Use it before guessing a name. Each result says what the icon looks like, so you don't have to render it to check.

```sh
npx standardicon search delete
npx standardicon search bell with a plus
```

### from

Finds our icon for names from another set, as you'd write them in that set: `trash-2`, `Trash2`, `Trash2Icon` and older Lucide names such as `MoreHorizontal` all work. Use it when switching a project to Standard Icon.

```sh
npx standardicon from lucide x Trash2 ChevronDown MoreHorizontal
# x → close
# Trash2 → trash
# ChevronDown → chevron-down
# MoreHorizontal → more
```

Sets: lucide, phosphor, material, tabler, heroicons, radix, octicons, fluent and carbon. A name with no equivalent says so and lists the closest icons; don't substitute a different icon without checking.

### list

Prints every icon name. With `--weight`, only icons that come in that weight.

```sh
npx standardicon list
npx standardicon list --weight semibold
```

## Options

| Option | What it does |
| --- | --- |
| `--size <n>` | 16, 18, 20, 22, 24, 28, 32, 40 or 48. Default 18. Pick it from the text beside the icon (see below). |
| `--weight <w>` | thin, regular, semibold, bold or black. Default regular. |
| `--out <dir>` | Where `add` writes files. Default `./icons`. |
| `--force` | Let `add` overwrite files that differ. |
| `--dry-run` | Show what `add` would write, without writing. |
| `--json` | Print results and errors as JSON. |
| `--version`, `-v` | Print the version. |
| `--help`, `-h` | Print help. |

Semibold comes in 18 and up, bold in 32 and up, and black in 40 and up. Icons with filled shapes come in one weight, regular, as drawn: `list --weight semibold` shows which icons have every weight.

Names are kebab-case. Common other names work too, such as `external-link` for `pop-out`. An unknown name suggests the closest real ones.

## For scripts and agents

Every command takes `--json`. Errors exit with code 1, and with `--json` they print `{ "error": "...", "suggestions": [...] }` to stdout.

```sh
npx standardicon get arrow-up --json      # { "name", "size", "weight", "svg" }
npx standardicon add check --json         # { "dryRun", "files": [{ "name", "path", "size", "weight", "action", "written" }] }
npx standardicon search trash --json      # [{ "name", "category", "looks", "use", "keywords", "weights" }]
npx standardicon from lucide x --json     # [{ "from", "name", "alternatives" }], or { "from", "name": null, "suggestions" }
```

`action` is `create`, `overwrite`, `unchanged` or `conflict`.

The data is importable too:

```js
import icons from 'standardicon/icons.json' with { type: 'json' };
import { toSvg } from 'standardicon/icon';

const arrow = icons.find((icon) => icon.name === 'arrow-up');
toSvg(arrow, 24, 'semibold');
```

Agent instructions live at [standardicon.com/llms.txt](https://standardicon.com/llms.txt).

There's also an optional MCP server, [@standardicon/mcp](https://www.npmjs.com/package/@standardicon/mcp), for AI apps that can't run commands, such as Claude Desktop. Coding agents that can run commands don't need it: everything it does, this CLI does too.

## Accessibility

Give an icon-only button an accessible name with `aria-label`. Mark decorative icons next to text with `aria-hidden="true"`.

## License

MIT, for the icons and the code. Attribution isn't required, but it's appreciated. The Standard Icon name and logo aren't covered by the license.

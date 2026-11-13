# The Standard Icon Set

> This is the public copy of the Standard Icon source. The icons, the `standardicon` CLI, `@standardicon/react` and `@standardicon/mcp` all build from it. The website's typeface, Polymath, is licensed and isn't included, so the site itself (`npm run build`) needs those fonts in `app/fonts`.

About 1,500 free SVG line icons, drawn on a 16px grid and released under the MIT license. Weights are measured at 18px, the default size, and lines grow with the size, like text.

Browse the set at [standardicon.com](https://standardicon.com).

This is an alpha. Names, sizes and defaults may change before 1.0.0, so pin versions.

## Install and use

In a React project, use the components. Only the icons you import are bundled.

```sh
npm install @standardicon/react
```

```tsx
import { ClockIcon, TrashIcon } from '@standardicon/react';

<ClockIcon size={20} />
<TrashIcon weight="semibold" title="Delete" />
```

Anywhere else, use the CLI to copy SVG files into your project. It is a build-time tool, so install it as a dev dependency or run it with `npx`.

```sh
npm install --save-dev standardicon
npx standardicon add arrow-up check search --out src/icons
npx standardicon get arrow-up --size 20      # print one SVG
npx standardicon search "bell with a plus"   # find an icon by meaning
npx standardicon from lucide x Trash2        # our name for another set's icon
```

Or fetch a file directly: `curl -fsS https://standardicon.com/svg/16/arrow-up.svg`.

For AI apps that can't run commands, such as Claude Desktop, there is an optional MCP server, `@standardicon/mcp`. A coding agent that can run commands should use the CLI.

```sh
claude mcp add standardicon -- npx -y @standardicon/mcp
```

Icons draw in `currentColor`, so they take the color of the text around them. Package details are in [`packages/react`](packages/react/README.md), [`cli`](cli/README.md) and [`packages/mcp`](packages/mcp/README.md).

## Picking a size

Sizes are 16, 18, 20, 22, 24, 28, 32, 40 and 48. Pick the size from the text the icon sits beside:

| Text | Icon |
| --- | --- |
| 12 to 13px | 16 |
| 14 to 15px | 18 (the default) |
| 16 to 17px | 20 |
| 18 to 19px | 22 |
| 20 to 21px | 24 |
| 22 to 26px | 28 |
| 27 to 30px | 32 |
| 31 to 36px | 40 |
| Larger | 48 |

A sidebar title or heading in larger type needs a larger icon than the items under it. Every size is the same drawing scaled up, so one SVG file works at any size: set its `width` and `height`.

## Weights

| Weight | Line at 18px | Comes in |
| --- | --- | --- |
| thin | 1px | every size |
| regular (default) | 1.33px | every size |
| semibold | 1.5px | 18 and up |
| bold | 2px | 32 and up |
| black | 2.5px | 40 and up |

Lines grow with the size: regular is 1.33px at 18 and 1.78px at 24. Icons with filled shapes come in one weight, regular. Raw files for other weights are at `/svg/{weight}/{size}/{name}.svg`.

## Links

- [standardicon.com](https://standardicon.com)
- [For agents](https://standardicon.com/agents/)
- [Changelog](https://standardicon.com/changelog/)
- [llms.txt](https://standardicon.com/llms.txt), and [SKILL.md](skills/standard-icon/SKILL.md) for agent skills (`npx skills add Standard-Icon/standardicon`)

To keep using the set in a project, add this line to its `AGENTS.md` or `CLAUDE.md`:

> Use The Standard Icon Set for every icon: `@standardicon/react` in React projects, otherwise `npx standardicon add <name>`. Find names with `npx standardicon search <words>` before adding an icon from anywhere else.

## Requests and bugs

Use the issue templates: [icon request](../../issues/new?template=icon-request.yml) or [bug report](../../issues/new?template=bug.yml). Search the set first, since the icon may exist under another name.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Don't open a public issue.

## License

MIT, for the icons and the code. See [LICENSE](LICENSE). The name and logo of The Standard Icon Set, and the Polymath typeface used on standardicon.com, are not covered by the license.

## Working on this repo

```sh
npm install
npm test            # CLI, MCP and React package tests
npm run generate    # writes public/ and skills/standard-icon/SKILL.md
npm run check       # checks every SVG
node packages/react/build.mjs
node packages/mcp/build.mjs
```

`icons/icons.json` is the source of truth: each icon's 16px master. `lib/icon.mjs` derives every size and weight from it, and the site, the raw SVGs and the packages all use the same data. Run `npm run generate` after changing icons, because the committed skill is tested against it.

The website itself (`npm run build`) needs the Polymath font files in `app/fonts`. They are licensed and not included in this repo.

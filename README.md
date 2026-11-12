# The Standard Icon Set

> This is the public copy of the Standard Icon source. The icons, the `standardicon` CLI, `@standardicon/react` and `@standardicon/mcp` all build from it. The website's typeface, Polymath, is licensed and isn't included, so the site itself (`npm run build`) needs those fonts in `app/fonts`.

The source for [standardicon.com](https://standardicon.com): SVG line icons drawn on a 16px grid, in five weights from thin to black. Regular, the default, is a 1.33px line at 18px, the default size, and lines grow with the size. MIT licensed.

`icons/icons.json` is the single source of truth. It holds each icon's 16px master. Every size is that drawing scaled up, lines included, and the weight sets the line at 16px, so `lib/icon.mjs` derives every size and weight from it. The site, the raw SVG files, and the CLI all use this data, so they always match.

The site is a Next.js app, exported as static files and served by nginx. `npm run build` first runs `scripts/generate.mjs`, which writes the raw SVGs, `icons.json`, the agent files, and the CLI package into `public/`, then exports everything to `out/`.

## Preview

```sh
npm install
npm run dev   # http://localhost:4173
```

## Ship the icons

```sh
npm run ship                # everything pink in Figma goes live on standardicon.com
npm run ship -- --dry-run   # sync and test the deploy build only, publishing nothing
npm run ship -- --no-sync   # ship what's already synced
```

`ship` syncs every pink icon, then builds the last commit plus the new icons in a clean copy, which is exactly what the server will build, and stops if that fails. Then it commits only the icon data (`icons.json`, records, issues and history), publishes the preview, pushes to `main` (which deploys standardicon.com in a minute or three), and rebuilds the local site. Other uncommitted work stays out.

The same thing is one click away: **Ship live** in the workbench's Tools tab, and **Ship live to standardicon.com** in the Figma plugin. Both stream the output as it runs.

## Update the icons from Figma

The icons are drawn in the [`mak icons` Figma file](https://www.figma.com/design/5OZ0QO2xXZJH2OYmTagAW5/mak-icons). Each category is a top-level frame on the first page with a `<category> icons` group inside. An icon is ready to ship when its component set has a solid 4px `#ff4fd8` border.

```sh
npm run sync              # pull every ready icon, then report what changed
npm run sync -- --build   # the same, then build the site
npm run sync -- --changed # only export what changed in Figma since the last sync
npm run sync -- --only tag,tag-plus-overlay   # only these icons, including new ones
```

The sync reads the file through Figma's API, exports each category as SVG, and runs the importer. It reports icons added, removed, redrawn, or moved, and any that lost their weights to filled shapes. It also writes `.sync/review.html`, which shows every added or redrawn icon before and after, at each size and weight. Check that, then commit and push. Pushing to `main` deploys the site.

Every drawing is kept. Whenever an icon's shape changes in Figma, released or not, the sync adds a version to `icons/history/<name>.json`, and the workbench shows them under History on each icon. `npm run history -- <name>` lists them. `npm run history -- --backfill` filled in the versions saved in git before the history existed; it only needs running once.

### Approving in the workbench

Press **Approve** (or `A`) on an icon in the workbench to ship it without opening Figma. The approval covers the drawing as it is now: the next sync releases it as if its border were pink, and if it's redrawn afterwards it waits for a fresh approval. **Needs revision** in the workbench does the reverse. Dashed orange in Figma means the same thing, so either one marks it.

The workbench can't edit Figma itself, so borders follow through the **Workbench** plugin. Install it once from Figma's menu: Plugins → Development → Import plugin from manifest, then pick `figma-plugin/manifest.json`. Leave it open while you work, with the workbench running:

- Every few seconds it turns approved icons pink, icons marked for revision dashed orange, and either one taken back to blue. Without it, approvals still ship, and the sync lists the ones that aren't pink in Figma yet.
- It works the other way too: change a border by hand and the workbench follows. Pink approves, dashed orange marks the icon for revision (and files its issue), and blue takes both back. Other looks, such as halfway through a change, are ignored, and the plugin leaves a border you've just changed alone for a minute.
- **Sync all** runs a full sync, then builds the site. **Sync selected** does the same for just the icons selected in Figma: select icons, any part of one, or whole category frames. The sync's output streams into the plugin.

It needs a Figma personal access token with read access to files. Set `FIGMA_TOKEN`, or on macOS save it to the Keychain once:

```sh
security add-generic-password -U -s standardicon-figma -a figma -w <token>
```

How the importer handles Figma's drawing:

- **Badge icons**, such as `folder-x-overlay`, are drawn as a Subtract of the parent outline and a Cutout. The importer rebuilds them from the parent's strokes, clipped where the badge sits, so every weight still works. A badge without a parent icon needs its base outline in `scripts/badge-bases.json`.
- **An icon that can't be converted** keeps its last published version, or stays out if it was never published, and the report says why. Inside- or outside-aligned strokes are the usual cause: use centre-aligned strokes.
- **Filled shapes** lock an icon to regular weight, unless its record has `fillApproved` because the fill is deliberate, such as a dot. File-type icons (`file-*`) may always have small filled labels, like the letters on `file-pdf`. A fill over 8px across is still flagged.

## Workbench

```sh
npm run workbench   # http://localhost:4180
```

A local tool for working on the set. It isn't part of the site or the package, and only listens on this machine.

On your other devices it's at `https://<this-mac>.<tailnet>.ts.net:4180`, shared over Tailscale with `tailscale serve --bg --https=4180 http://127.0.0.1:4180` (once; it survives restarts). Only devices on your tailnet can open it. The workbench accepts changes from that address as well as from localhost, and from nowhere else. Its startup line prints the address.

- **Compare:** every icon in Figma, ready or not, beside its closest match in each comparison set. Click one to overlay them on the pixel grid, together or alone (keys `0` to `3`). Matches are guessed until you pick one or mark a set as having no equivalent. Both are saved to the icon's record. You can edit its status, flags, keywords, and notes in the same panel. **Needs revision** marks the icon and files an issue in one click, and closing that issue clears the mark.
- **Records:** every icon that exists, is planned, or was decided against, with the rules. Search it first to see if a concept already exists.
- **Issues:** every question and to-do, with its history. Adding a note to an icon files one automatically. Create, comment, decide, and close them here. Each has its own link, and the Activity view shows everything that's happened.
- **Tools:** run the sync, the build, and the SVG checker, and read the last sync's report and audit.

Run `npm run sync` first so it can see icons that aren't ready and their Figma borders.

SF Symbols are rendered from the copy in macOS into `.workbench/`, which git ignores. Apple's license doesn't allow redistributing them, so those files must never ship. Lucide is a dev dependency only. Use the overlays to compare, not to trace.

### Records

Each icon has one file in `icons/records/<name>.json`, holding what people decided about it: status (`active`, `planned`, `covered`, `dropped`), flags, notes, keywords, approved fills, its parent and canonical shapes, and its match in each comparison set. What Figma can tell us (its border, section, and whether it's drawn) isn't stored. It's read at each sync and merged in, and the pink border alone still decides what's released.

Use the workbench, or this command, which needs no server and is the way in for agents:

```sh
npm run icon -- find "paper plane"      # does this concept exist?
npm run icon -- get home
npm run icon -- list --flag weak-read --section gaps
npm run icon -- gaps lucide
npm run icon -- set home flags+=weak-read
npm run icon -- revise home              # flags it and files an issue; --undo reverses both
npm run icon -- compare drafting-compass sf compass.drawing
npm run icon -- note home "Redrawn with a lower roof"
npm run icon -- issues --open
npm run icon -- issue new "Redraw tags" --icons tags,tag --by morgan
npm run icon -- stream --as figma-agent  # what's new since this agent last checked
npm run icon -- issue tags-redraw owner=figma-agent --by figma-agent
npm run icon -- comment tags-redraw "Shrunk both tags" --by figma-agent
```

Run `npm run icon` for the full list. The workbench serves the same operations at `/api/records`, `/api/find`, `/api/gaps/<set>`, `/api/issues`, and `/api/issues/stream?as=<name>`.

Each sync brings the records in line with Figma. A new set gets a record, a planned icon that appears becomes active, and a set renamed in Figma moves its record and keeps the old name in `formerNames`. If a name's Figma ID changes, the sync reports it and leaves the record alone.

Also in `icons/`: `RULES.md` has the drawing rules, `AUDIT.md` specifies the construction checks each sync runs (it only reports for now), and `issues/` has one file per issue, each holding its own history. Each agent's place in the stream is kept in `.workbench/`, which git ignores.

### Comparing with another set

Add `workbench/sets/<id>.json`, and it appears as a column, an overlay, and a filter. A folder of SVGs needs only this:

```json
{ "id": "my-set", "title": "My Set", "kind": "svg", "dir": "path/to/svgs", "color": "#8e4ec6", "grid": 24, "matchLine": true, "license": "MIT", "usage": "For comparing only." }
```

`"off": true` starts a set hidden in the overlay. `words` maps this set's names onto the other set's, such as `"heart": "favorite"`.

The open sets drawn at small sizes come from `npm run workbench:sets` (or `-- octicons tabler` for some): Octicons and Fluent at 16, Carbon, Radix at 15, Heroicons Micro, Phosphor regular, Material Symbols outlined, and Tabler outline. It downloads each package into a temporary folder, copies only its SVGs into `.workbench/sets/<id>/` (git ignores it), and names them plainly. Restart the workbench afterwards.

No set's geometry is ever traced.

## Deploy

The site runs on makserve as `standardicon.com`, on port 3027. To deploy by hand:

```sh
makserve deploy standardicon.com
```

### Preview

`npm run preview` publishes the latest local commit to https://preview.standardicon.com, behind a password. The username is `preview`, and the password is in the Keychain under `standardicon-preview`. It pushes to the private `standardicon-preview` repo, which deploys by itself, and adds the password and port there, so nothing about the preview touches this repo's site or `main`. Uncommitted changes aren't included.

## Type

The site uses Polymath by OH no Type Company, under a web license for one site with up to 500,000 monthly visitors. Serve the font files in `app/fonts` unmodified. They must come out of this repo before it's ever made public, and they aren't covered by the MIT license, which applies to the icons and the code. Don't generate images with Polymath in a script: the license only allows images a licensed user makes personally.

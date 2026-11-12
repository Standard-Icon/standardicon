# mak icons: drawing rules

For Morgan and for any agent drawing in the Figma file `5OZ0QO2xXZJH2OYmTagAW5`. Figma is the source of truth for drawings. `AUDIT.md` lists how these rules are checked.

## Originals only

- Draw everything from scratch. No set's geometry is ever traced or copied, whether Lucide, SF Symbols, Material or anything else. Comparison sets are for finding gaps and checking what a concept should show.
- SF Symbols is reference only and can't be redistributed. Its renders stay in a gitignored cache.
- Keep brand logos out of the MIT set.
- Ask before changing how an existing icon is drawn. Size, centring and consistency passes only scale, move or re-cut. Never change `robot`: it's Morgan's signature icon.

## File structure

- One top-level frame per category on Page 1, holding a label and a `<category> icons` wrap of component sets. Frames sit in one row at y 3200, so they can grow downward.
- One component set per icon, with a single variant, `Size=16`. That's the only drawing: every other size (18 to 48) is scaled from it when the site is built. The 18 to 24 variants were instances of the 16 and were removed in 2026-11.
- To use an icon bigger in Figma, scale a 16 instance. Scaling also scales its line, which is how the planned weights grow with size.
- Each frame has guides for the 16px icons: edges and 4px insets. The sets are narrower now, so the guides need redrawing.
- The set's border says where it stands, 4px, outside, radius 11:

| Border | Colour | Meaning |
|---|---|---|
| Pink | `#FF4FD8` | Approved. Only this ships. The same as approving it in the workbench. |
| Blue | `#4F4FFF` | New, waiting for review |
| Dashed orange | `#FFB000`, dashed 10/5 | Needs revision. The same as marking it in the workbench. |

These are the only three. The old gray (still to refine) and solid orange (new UI icon) stages became dashed orange.

The Workbench plugin in Figma keeps these in step with the workbench while it's open: approving turns an icon pink, marking it turns it dashed orange, and taking either back returns it to blue. Changing a border by hand in Figma does the same in the workbench, so either side can decide.

## Naming

- Kebab-case. Search names, former names and keywords first, so one concept doesn't get two names.
- Variants are `<parent>-<modifier>` using the parent's exact name, and sit straight after the parent in this order: plus, minus, check, x, search, lock, off, then the rest.
- Object families share one prefix (`message-*`). Descriptive siblings (`cloud-rain`) and UI pieces (`popover-*`) are separate icons, not variants.
- Our words, not another set's: `person` not `user`, `close` not `x`.

## Geometry

- 1px centred strokes, round caps and joins. The one exception is chevrons, which keep a miter join. Folders are round like everything else.
- Live strokes only. No union, subtract or intersect, because Figma exports booleans as filled shapes, and that blocks the 1.25px and 1.5px weights. Bottom-right badges are the one exception, below.
- Rounded rectangles are live RECTANGLE nodes with a corner radius, never flattened, unless a cut forces it. Circles are ELLIPSE nodes or closed paths.
- Fills only for small deliberate parts: dots of radius 0.5–0.75 and the like. Each needs `fillApproved` on its record. The `file-*` labels are approved as a family.
- No rotations or flips on shapes. Save them at their final position.
- Visible bounds centred in the 16 frame within 0.25, moving in 0.5px steps to stay on the pixel grid. Deliberately off-centre: `align-object-top`, `align-object-bottom`, `align-object-left`, `align-object-right`.
- About 12px on the longest side, up to about 14.5 for wide subjects. Small glyphs such as arrows, chevrons, `close`, `plus` and `minus` are meant to be smaller.
- Every icon master's bottom layer is `icon-grid`: a locked instance of the **Icon grid** component (in the `icon grid` frame), showing the pixel grid, the 12px drawing square and the 13.33px keyline circle. It's for drawing against, not part of the icon: the sync strips it before the change check and the audit, and the importer skips it, shown or hidden. The Workbench plugin shows or hides them all, and adds one to new icons when it opens. Don't draw inside it or unlock it.
- Every icon size has two layout grids in Figma: a 1px pixel grid and the 12px drawing area, shaded pink. Layout grids never export. Shift+G shows or hides them, and the Workbench plugin adds them to new icons when it opens.
- Keylines: a circle looks smaller than a square of the same width, so round icons are drawn bigger. Square icons fill the 12px square (outer edge 2 to 14, centreline 2.5 to 13.5). Round icons fill a circle about 11% wider: 13.33px to the outer edge, centreline radius 6.17 around (8, 8), so they reach into the margin to about 1.33. The workbench's icon grid shows both. Most round icons are still drawn to the square's 11px circle and need to grow.
- Put straight horizontal and vertical strokes on .5 coordinates where you can.
- Separate strokes need at least 1px of visible gap: 2 between centrelines.
- At 1.5px weight nothing may leave the 16 frame, so keep centrelines within 0.75–15.25.

## Badges

Three types. Each is a name suffix: `tag-plus-overlay`, `tag-plus-cutout`, `tag-plus-integrated`.

- **Overlay badge:** a bordered 5.4×5.4 square at the bottom right with the mark inside. Specified below.
- **Cutout badge:** no square. A mark 4.5 long, centred at (11.75, 11.75), with the parent's outline cut away within 4.25 of that centre. Live strokes, no boolean.
- **Integrated badge:** the mark inside the shape, with nothing cut.

### Overlay badge

Used by `-plus`, `-minus`, `-check`, `-x`, `-search`, `-lock`, `-key`, `-shield`, `-star` and `-settings`. A badge is an overlay: swapping parent and variant must leave the parent exactly where it was.


Built from components, so every badge stays the same and a parent edit follows through. Don't draw one by hand.

- The master has two children at (0, 0): `Body`, an instance of the parent's `Size=16`, and `Overlay badge`, an instance of a component from the `overlay badges` frame.
- Each component is 16×16 and holds `Cutout`, a white 5.4×5.4 rectangle with radius 1 at (9.55, 9.55); `Badge border`, a live rectangle in the same place with a 1px centred stroke and no fill; and the glyph.
- Glyph: centred at (12.25, 12.25). Longest side 2.25 for x, plus and minus, 2.5 for check, 2.6 for the rest.
- `Cutout` only hides the parent in Figma. The sync drops it and cuts the parent's strokes at its edge, so the exported icon has no white and no boolean.
- Keep the names `Body`, `Overlay badge`, `Cutout` and `Badge border`. The sync finds them by name.
- - Keep the names `Body`, `Cutout` and `Badge border`. The site's sync finds them by name and cuts the strokes at the cutout's edge. Don't name a boolean `Body` for anything else.

## Slashes

Used by `-off` icons and the like. No booleans.

- Slash: one straight stroke, usually (3,13) to (13,3), left uncut.
- Split every other stroke where its centreline comes within 1.75 of the slash. Round caps leave about 0.75 of visible gap.
- Filled dots stay unless they sit wholly inside that band.
- If a shape is flattened to be cut, restore its corner radii by matching vertices.
- Centre `-off` icons as a whole, slash included.

## Figma API gotchas

- Setting a vector's `vectorPaths` resets its line ends and joins (and any per-point corner radius). Save `strokeCap`, `strokeJoin` and `cornerRadius` before rewriting a path and set them back after. Missing this sharpened 109 round icons in 2026-11.

- Assigning `vectorPaths` resets stroke cap to NONE and join to MITER. Set them back.
- `figma.subtract` uses layer order: bottom is the base. Check that `Cutout` ended up last.
- Boolean nodes have no `constraints` property.
- Removing a node invalidates it, so read what you need first.

## Canonical shapes

Reuse these exactly when a concept includes them. Don't redraw them. To resize, scale the points uniformly and keep the stroke at 1px. Positions are the Size=16 master as of November 2026. If the source icon has changed, it wins over this file.

| Canonical | Source icon | Geometry |
|---|---|---|
| Page | `file` | 12px tall with the stroke. Outline 8.89×11 at (3.56, 2.5), fold 3.22×3.26 at (9.09, 2.65). Any icon on the page scales with it around (8, 8). |
| Square bubble | `message` | 11×9.97 at (2.5, 3.21): `M3.5 3.21H12.5C12.77 3.21 13.02 3.32 13.21 3.5C13.39 3.69 13.5 3.94 13.5 4.21V10.4C13.5 10.66 13.39 10.92 13.21 11.1C13.02 11.29 12.77 11.4 12.5 11.4H7C7 11.4 6.97 12.44 6.3 12.89C5.63 13.35 4.66 13.13 4.66 13.13C4.66 13.13 5.07 12.65 5.03 12.1C5 11.55 4.5 11.4 4.5 11.4H3.5C3.23 11.4 2.98 11.29 2.79 11.1C2.61 10.92 2.5 10.66 2.5 10.4V4.21C2.5 3.94 2.61 3.69 2.79 3.5C2.98 3.32 3.23 3.21 3.5 3.21Z` |
| Round bubble | `message-oval` | 12.09×10.99 at (1.96, 2.51), enlarged by Morgan in 2026-11: `M8 2.507C4.594 2.507 1.957 4.704 1.957 7.561C1.957 9.099 2.726 10.527 4.044 11.406C4.044 12.285 3.715 12.944 3.275 13.493C4.484 13.493 5.583 13.054 6.352 12.395C6.901 12.505 7.45 12.615 8 12.615C11.405 12.615 14.042 10.417 14.042 7.561C14.042 4.704 11.405 2.507 8 2.507Z`. Cutout badges stop it 4.25 from (11.75, 11.75); `message-oval-off` cuts it 1.75 either side of the slash. |
| Folder | `folder` | Body 11.66×9.72 at (2.17, 3.14): `M11.66 1.3V9.72H0V0H5.1L6.48 1.3H11.66Z`, local coordinates, with vertex radii 1.33 at the right and bottom-left corners and the tab's inner bend, 0.67 at the top-left corner and tab top. Tab line at (2.17, 4.44): `M6.8 0L5.83 0.65H0`. |
| Open book | `book-open` | Two 5.49×10.03 halves at (2.49, 2.91) and (8, 2.91). Right half, local: `M5.49 0.76C5.49 0.34 5.15 0 4.74 0H1.52C0.68 0 0 0.68 0 1.52V10.03L0.63 9.4C1.2 8.83 1.97 8.51 2.77 8.51H4.74C5.15 8.51 5.49 8.17 5.49 7.75V0.76Z`. The left half mirrors it. |
| Closed book | `book-closed` | 10×11.6 at (3, 2.2): `M4.5 11.2H4.29C3.58 11.2 3 11.78 3 12.5C3 13.21 3.58 13.79 4.29 13.79H13C13 13.79 12.62 13.52 12.62 12.5C12.62 11.47 13 11.2 13 11.2V2.2L4.5 2.2M13 11.2H8.25H4.5M4.5 11.2V2.2M4.5 2.2H4C3.73 2.2 3.48 2.3 3.29 2.49C3.1 2.68 3 2.93 3 3.2V12.5`. Glyphs centre at x≈8.97. |
| Calendar | `calendar` | Rectangle 9.57×9.42 radius 1 at (3.21, 3.69). `M3.21 6.03H12.78M5.82 2.94V4.48M10.17 2.94V4.48` |
| Map pin | `map-pin` | `M8 13.35C8 13.35 12.5 10.7 12.5 7C12.5 5.8 12.02 4.66 11.18 3.81C10.33 2.97 9.19 2.5 8 2.5C6.8 2.5 5.66 2.97 4.81 3.81C3.97 4.66 3.5 5.8 3.5 7C3.5 10.7 8 13.35 8 13.35Z`, plus a circle r 1.5 at (8, 7). |
| Phone | `phone` | `M4.5 2.5H5.27C5.7 2.5 6.09 2.77 6.22 3.18L6.78 4.85C6.91 5.24 6.79 5.67 6.47 5.93L5.5 6.75C6.2 8.4 7.6 9.8 9.25 10.5L10.06 9.52C10.32 9.2 10.75 9.08 11.14 9.21L12.81 9.77C13.22 9.9 13.5 10.29 13.5 10.72V11.5C13.5 12.03 13.28 12.53 12.91 12.91C12.53 13.28 12.03 13.5 11.5 13.5C6.5 13.2 2.8 9.5 2.5 4.5C2.5 3.96 2.71 3.46 3.08 3.08C3.46 2.71 3.96 2.5 4.5 2.5Z` |
| Heart | `heart` | `M8 13C8 13 2.5 9.8 2.5 6.1C2.5 4.3 3.9 3 5.5 3C6.6 3 7.5 3.6 8 4.5C8.5 3.6 9.4 3 10.5 3C12.1 3 13.5 4.3 13.5 6.1C13.5 9.8 8 13 8 13Z` |
| Pencil | `edit` | 9.86×9.86 at (2.93, 3.21), local: `M0 9.86L3.07 9.36L9.33 3.11C9.67 2.77 9.86 2.3 9.86 1.82C9.86 1.34 9.67 0.87 9.33 0.53C8.99 0.19 8.53 0 8.04 0C7.56 0 7.1 0.19 6.76 0.53L0.5 6.79L0 9.86Z`. Ferrule at (9.27, 4.62): `M0 0L2.11 2.11`. Any writing tool is this pencil, except `pen`, `brush` and `highlighter`. |
| Clipboard | `clipboard-check` | Board 9×10 radius 1 at (3.5, 3.5), an open path leaving a gap in the top edge for the clip. Clip: 5.11×2 at (5.45, 2.53). |
| Person | `person` | Scale k, centre x cx, shoulder baseline B. Head: circle r 1.5k centred at (cx, B−4.5k). Shoulders: `M0 1.75C0.25 0.5 1.1 0 2.25 0C3.4 0 4.25 0.5 4.5 1.75`, scaled by k, placed at (cx−2.25k, B−1.75k). Standalone: k 1.5, B 12.5, cx 8. Open shoulders, never a closed body. |
| Face | `face-smile` | Circle r 5.6 at (8, 8). Eyes: filled dots r 0.6 at (6, 6.74) and (10, 6.74). Change only the mouth and brows. |
| Star | `star-half` | Live STAR node: 5 points, inner radius 0.53, box 12.914×12.914 at (1.543, 2.043). Small version: the same node at scale 0.391. |
| Letter A | `translate` | For height h, width 0.969h. Apex at top centre. Crossbar at 0.6786h, from w/5.5 to w−w/5.5. Source, 5.5×5.68: `M0 5.68L2.75 0L5.5 5.68M1 3.85H4.5` |
| Chevron | `chevron-down` | 8×2.6: `M0 0L4 2.6L8 0`. Round caps, miter join. Use wherever a chevron stands alone, including `<` and `>` in code icons, scaled proportionally. |
| Plug | `connect` | Body 7×6 at (4.5, 4.83), prongs at x 6 and 10 from y 2.33 to 4.33, cord from (8, 10.83) to (11.5, 13.33) with radius 1.5. Copy its visible layers. Use a small version with the same silhouette where a plug is a detail, as in `cable`. |
| Search | `search` | 11×11 at (2.5, 2.5), ring and handle. Use wherever a search icon appears. |
| Arrow | `arrow-up` | `M8 12.5V3.5M12 7.5L8 3.5L4 7.5`: arms at 45°. In a circle (`arrow-up-circle`): shaft 4.7, arms 2.01. To a line (`arrow-to-top`): shaft 7, arms 2.94, line 6.375, 3 between tip and line. |
| Alignment | `align-object-top` | A 1px guide line plus rectangle bars with radius 0.5. |
| Cloud | `cloud` | `M4.74 12.5C3.92 12.5 3.13 12.19 2.52 11.62C1.92 11.06 1.55 10.29 1.49 9.47C1.44 8.65 1.69 7.83 2.21 7.19C2.73 6.55 3.75 6.21 4.56 6.1C4.85 5.3 5.39 4.62 6.09 4.15C6.79 3.68 7.62 3.45 8.46 3.48C9.3 3.51 10.12 3.8 10.78 4.32C11.45 4.84 11.93 5.56 12.16 6.37C12.89 6.54 13.26 6.89 13.7 7.49C14.15 8.08 14.37 8.82 14.32 9.56C14.27 10.31 13.96 11.01 13.44 11.55C12.93 12.08 12.24 12.42 11.49 12.5H4.74Z` |

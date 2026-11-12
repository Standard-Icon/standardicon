# mak icons: geometry audit

Checks to run at each sync, from the Figma REST file JSON (`geometry=paths`) and the exported SVGs. Results are derived, stored in `.sync`, not in records. The rules behind them are in `RULES.md`.

Severity:
- **error**: blocks release if the set has the pink border. On any other set it's only reported.
- **warn**: reported, never blocks.

Output one row per finding: `{ icon, check, severity, detail }`. Add the audit to the sync report, and to each icon's page in the workbench.

## Definitions

- **Master**: the `Size=16` variant of a component set. Coordinates are relative to it (absolute minus the master's `absoluteBoundingBox`).
- **Leaf**: a descendant that is VECTOR, RECTANGLE, ELLIPSE, STAR, POLYGON or LINE.
- **Badge icon**: the master has a direct child named `Body`, an INSTANCE of its parent, with an INSTANCE named `Overlay badge` beside it.
- **Base**: `Body` and its leaves.
- **Visible bounds**: union of `absoluteRenderBounds` over the master's direct children. Include a badge's `Body`, `Badge border` and glyph. Skip nulls, and skip children with `visible: false`.
- **Centreline bounds**: for geometry not exposed by render bounds, use `absoluteBoundingBox`.
- Exempt lists below are by name. An icon can also opt out with a record flag `audit-ok:<check id>`, which a person adds on purpose.

## Structure

| Id | Severity | Check |
|---|---|---|
| — | info | The `icon-grid` layer in each master (an instance of the Icon grid component) is removed before the audit runs, so no check sees it. |
| S1 | error | The set has exactly one variant, `Size=16`. Every other size is scaled from it when the site is built. |
| S2 | error | The variant frame is 16×16 within 0.01. |
| S3 | — | Retired in 2026-11, when the 18 to 24 variants (instances of the 16) were removed. |
| S4 | error | Name matches `^[a-z0-9]+(-[a-z0-9]+)*$`, and is unique across the file. |
| S5 | warn | The set is inside a category frame's `<name> icons` child. Loose top-level sets are reported as outside the frames. |
| S6 | warn | Border is one of the three: pink `#FF4FD8` approved, blue `#4F4FFF` new, dashed orange `#FFB000` needs revision (each channel within 0.01), weight 4, OUTSIDE. Orange is always dashed, and only orange is. |

## Node types and paint

| Id | Severity | Check |
|---|---|---|
| N1 | error | In a master, only leaves, BOOLEAN_OPERATION, GROUP and FRAME. No TEXT, no IMAGE fills, no `isMask`, no effects, `opacity` 1, blend mode normal or pass-through. Known exceptions: `spinner` has a wrapper FRAME, and `wifi-lock` uses an INSTANCE of `wifi` in its master. That's the only INSTANCE in any master, and the only FRAME is `spinner`'s. |
| N2 | error | No BOOLEAN_OPERATION except `Body` on a badge icon and a UNION that is `Body.children[0]`. Nesting deeper than that is an error. |
| N3 | error | No visible stroke or fill paint other than solid black (each channel ≤ 0.01, opacity ≥ 0.99). Exception: `spinner` has a deliberate gradient stroke. |
| N4 | warn | Hidden paints (`visible: false`) on leaves, fills and strokes. They're harmless but stale. |
| N5 | error | Every leaf's `relativeTransform` has a linear part equal to identity, each value within 0.0001. No rotation or flip. |
| N6 | warn | Hidden layers (`visible: false`) in a master. They don't export, and instances can't be reset through them. The other geometry checks skip hidden layers. |

## Strokes

| Id | Severity | Check |
|---|---|---|
| K1 | error | Every stroked leaf in a master has `strokeWeight` 1 within 0.001. |
| K2 | error | Every stroked leaf inside the 18, 20, 22 and 24 instances has `strokeWeight` 1 within 0.001. |
| K3 | error | `strokeAlign` is CENTER on stroked leaves. Exception: `robot`, whose inside strokes import correctly and must not be changed. |
| K4 | warn | Open vector paths have `strokeCap: ROUND`. Exempt names starting `chevron` and `caret`, and anything a person marks `audit-ok:K4`. RECTANGLE and ELLIPSE are skipped, because their cap value doesn't matter. Expect noise on the first run: 441 NONE/MITER and 331 NONE/ROUND leaves exist today, mostly rectangles and closed shapes, so check closed-path exclusion first. |

## Position and size

| Id | Severity | Check |
|---|---|---|
| P1 | warn | Non-badge icons: centre of visible bounds within 0.30 of (8,8) on each axis. 0.25 is an accepted leftover. Exempt: `align-object-top`, `align-object-bottom`, `align-object-left`, `align-object-right`. |
| P2 | error | Visible bounds inside the frame: x and y ≥ −0.01, x+w and y+h ≤ 16.01. |
| P3 | warn | At 1.5px weight, visible bounds grown by 0.25 on each side still fit in 0–16. Exempt: `robot`. |
| P4 | warn | Longest side of the visible bounds is 10.5–14.6. Exempt small glyphs: names starting `arrow-`, `chevron`, `corner-`, `grip-`, `skip-`, `move-`; plus `close`, `plus`, `minus`, `multiply`, `check`, `dot`, `pause`, `more-vertical`, `apps`, `widget-small`, `play`, `stop`, `person`, `guest`. On today's file about 74 icons fall under 10.5, nearly all small glyphs. The ones left are worth a look, not automatically wrong. |

## Badges

Only for badge icons. Tolerances are in 16px units.

| Id | Severity | Check |
|---|---|---|
| B1 | error | `Overlay badge` has a child named `Cutout`, RECTANGLE, filled, no stroke. 5.4×5.4 within 0.01, at (9.55, 9.55) within 0.01, corner radius 1 within 0.01. |
| B2 | error | `Overlay badge` has a child `Badge border`, RECTANGLE, 5.4×5.4 and (9.55, 9.55) within 0.01, corner radius 1, 1px CENTER stroke, no fill. |
| B3 | error | Glyph is the remaining children of `Overlay badge`. Bounding-box centre within 0.10 of (12.25, 12.25). |
| B4 | warn | Glyph's longest side by suffix, within 0.10: `x`, `plus`, `minus` 2.25; `check` 2.5; `search`, `lock`, `key`, `shield`, `star`, `settings` 2.6. |
| B5 | error | Overlay: the base matches the parent icon. Same number of leaves. Each leaf's type, position and size within 0.02, and path data equal after rounding to 2 decimals. Parent comes from the record. If none is set, use the name minus the suffix, then `badge-bases.json`. |
| B6 | error | No fill-only parts of the parent left outside `Body`. The tag hole belongs inside the base. |
| B7 | warn | A set whose name has a badge suffix and whose parent exists, but has no `Body`, is listed. Top-right and inside-the-shape patterns are valid (`person-plus`, `folder-plus`, `file-plus`, `calendar-plus`), so don't treat them as wrong. |

## Slashes

For names ending `-off`, plus `unplug`, `unpin` and `clear-format`.

| Id | Severity | Check |
|---|---|---|
| L1 | warn | There's one straight two-point stroke of length ≥ 9, within 8° of 45°. Treat the longest as the slash. |
| L2 | warn | Every other stroke's sampled centreline (at least 32 samples per segment) stays at least 1.70 from the slash segment. Rule is 1.75, with a tolerance of 0.05. Skip fill-only dots unless they're wholly inside the band. |

Not slash icons, don't check them: `prohibit`, `close`, `arrow-*`, `feather`, `leaf`, `auto-fix`, `percent`, `exposure`, `slash`, `slash-circle`.

## Fills

| Id | Severity | Check |
|---|---|---|
| F1 | error | Pink sets only: any fill-only leaf, other than `Cutout`, needs `fillApproved` on its record, its name in `solid-parts.mjs`, or a family rule (`file-*` labels). |
| F2 | warn | Fill-only leaves over 1.8 on their longest side, on sets without approval. Listed for review. Today's list includes `more`, `dot`, `toggle-on`, `radio-selected`, `progress`, `stop-circle`, `breakpoint`, `battery-*`, `calendar-day`, `calendar-week`, `opacity`, `mask`, `eclipse`, `circle-half`, `compare-split`, `star-half`. |

## Export

| Id | Severity | Check |
|---|---|---|
| E1 | error | Exported SVG for a pink set has no `<mask>`, `<clipPath>`, `<filter>`, `<text>`, `<image>`, white fill or other stray colour. This is `scripts/check-svgs.mjs`. |
| E2 | error | After clipping, a badge icon's SVG has no filled outline paths from its `Body`. |
| E3 | warn | Rendered at weights 1 and 1.5, ink stays inside the viewBox. |

## Not audited

These stay a human call. They're too subjective, or too noisy to automate:
- Whether an icon reads clearly at 16px.
- Clearance between separate strokes. Most close spots are deliberate joins.
- Pixel-grid alignment.
- Canonical drift, beyond the badge overlay check. If you want it later, compare leaves against the `canonical` record field, as B5 does for parents.

## State of the file on 8 November 2026

Dry run in the Figma plugin against all 1,546 sets:

- **Clean:** P2, K1, S4, N2, N5 (after baking `download`, `sparkles`, `american-football`), B1–B4 (after fixing `filter-x` and `list-plus`, `list-minus`, `list-x`).
- **K2:** the first REST audit found real unreset strokes on `storage`, `film`, `cash-register`, `car`, `snowflake` and `microscope`, which the dry run had missed by checking masters only. Reset the same day.
- **K3:** only `robot`.
- **N3:** only `spinner` (gradient). N4 finds 15 hidden paints, mostly hidden fills. Harmless.
- **P1, off-centre over 0.30:** `login`, `system`, `home`, `sparkles`, `generate`, `speech`, `wifi-lock`, `play`, `headphones`, `smart-home`, `cigarette`. `play` may be deliberate optical centring. None are fixed.
- **P4, over 14.6:** `iso`, `font-size`, `small-caps`.
- **Not run in that dry run:** S1–S3 instance details, S6, K4, P3, B5–B7, L1–L2, F1, E1–E3.

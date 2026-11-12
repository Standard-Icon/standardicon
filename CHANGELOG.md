# Changelog

## 0.3.0-alpha.3 (2026-11-12)

### Added

- Nine icons: `city`, `cutlery`, `team`, `soup`, `salad`, `carrot`, `broccoli`, `leafy-greens` and `egg-fried`.

### Changed

- `pizza` is a pie with one slice missing and pepperoni, which reads better at small sizes.
- Every package's npm description starts with "The Standard Icon Set", so `npm search "standard icon"` finds it.
- The agent instructions run `npx standardicon@latest` from npm.
- Keywords: street for `road`, shopping list and groceries for `clipboard-list` and `basket`, people and group for `team`, utensils for `cutlery`.

## 0.3.0-alpha.2 (2026-11-12)

### Changed

- **Weights are measured at 18px**, the default size, so the default icon has a 1.33px line. Regular is now 1.18px at 16 and 1.78px at 24. The weight names and numbers are the same.
- **Search** matches whole words and word starts, never the middle of a word (`city` no longer finds `opacity`). When no icon matches every word, it returns the icons that match the most, and plainer names rank first (`user` finds `person`).

### Added

- **Picking a size:** the CLI help, READMEs, MCP server and agent instructions say which icon size goes with which text size.
- The READMEs and agent instructions say to use `@standardicon/react` in React projects, to install the CLI as a dev dependency, and that one SVG file works at every size.

## 0.3.0-alpha.1 (2026-11-12)

Nothing is promised before 1.0.0, but this release changes defaults, so read it before upgrading from 0.1.0 or 0.2.0-alpha.1.

### Changed

- **New weights.** Lines at 18px, the default size: thin 1px, regular 1.33px (the default), semibold 1.5px, bold 2px and black 2.5px. Medium is gone: today's regular is the old medium, and the old regular is now thin.
- **Lines grow with the size**, like text. Every size is the 16px drawing scaled up, so regular is 1.18px at 16, 1.33px at 18 and 1.78px at 24. Sizes used to keep a 1px line.
- **The default size is 18**, the size for navigation, toolbars and buttons. It was 16. Without a size, heavy weights still start at their smallest size: semibold at 18, bold at 32, black at 40.
- Icons with filled shapes come in one weight, regular, as drawn. Many that were limited because of a small dot (such as `alert-octagon`) now come in every weight.
- 1,507 icons, up from 669 in 0.1.0. Round icons grow to a 13.33px circle and square ones fill the 12px square.

### Added

- **`@standardicon/react`**: one component per icon, such as `<ClockIcon size={24} weight="semibold" />`. The types refuse sizes and weights that don't exist, and each component's description says what the icon looks like.
- **`standardicon from <set> <names>`** gives our icon for names from Lucide, Phosphor, Material, Tabler, Heroicons, Radix, Octicons, Fluent and Carbon, as written in code (`Trash2`, `MoreHorizontal`).
- **Descriptions.** `search` shows what each icon looks like and when to use it, and finds icons by their description ("bell with a plus").
- **`@standardicon/mcp`**, an optional MCP server for AI apps that can't run commands.

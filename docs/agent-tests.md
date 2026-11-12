# Agent tests

How an outside agent finds and uses the set, given one sentence and no help. Run one after each release:

1. `npm run agent-test` resets the test project (`~/Sites/si-test`) and prints a brief for a random app. `-- --app email` picks one.
2. Start a fresh agent in the test project's Addy project and give it the brief word for word. Don't start it from this repo, where it would see the source. The brief never names a package, so finding the set is part of the test.
3. Watch it. Note how it found the set, which package and icons it chose, the sizes it used against its text sizes, and anything it worked around.
4. Add a note below, and fix what it found.

## Runs

### 2026-11-12 · email client · 0.3.0-alpha.3

- **Found it:** `npm search standardicon` listed all three packages; it chose `@standardicon/react` and pinned the alpha. Its memory was confirmed empty first.
- **Used:** 36 icons, all from the set, picked from the type definitions' descriptions. Sizes matched the pairing table (18 beside 13px text, 20–24 in toolbars, 40–48 for empty states).
- **Problems:** `send` reads like the letter A at 18, beside "Sent". Starred stars are outlines filled with CSS.
- **To fix:** redraw `send` tilted about 45°. Filled variants (issue `filled-variants-for-toggle-icons`).

### 2026-11-12 · music player · 0.3.0-alpha.3

- **Found it:** went straight to `@standardicon/react`. Memory was later found to hold nothing, so this was a good guess from the name.
- **Used:** 23 icons, 18px and up, with a weight switcher in settings (Semibold's minimum of 18 kept every icon at 18 or larger).
- **Problems:** filled the liked heart and play buttons with CSS.
- **To fix:** filled variants. The brief now rules out memories, notes and other folders.

### 2026-11-12 · project tracker · 0.3.0-alpha.2

- **Found it:** npm searches for "standard icon" and "standard-icons" found other packages; it took a web search and then "standardicon".
- **Used:** 35 icons; a status set built from circles, `more` for "no priority". 16px beside 12–13px text, as the table says.
- **To fix:** done in alpha.3: every package's description starts with "The Standard Icon Set", with "standard icon(s)" keywords.

### 2026-11-12 · recipe app · 0.3.0-alpha.1

- **Found it:** read the local repo, which outside agents can't; later briefs forbid it.
- **Blocker:** the agent instructions ran the CLI from standardicon.com, which is offline behind the splash. Fixed: they run `npx standardicon@latest` from npm.
- **Problems:** search missed utensils, soup, salad, people and shopping list (all drawn but unapproved, or missing keywords); `city` matched `opacity`; drumstick, pizza and egg read poorly at 18.
- **To fix:** done: approved the food icons and `team`, added keywords, fixed search, redrew pizza.

#!/usr/bin/env node
// Writes everything that isn't a page into public/: raw SVGs, the JSON index, agent files, and the CLI package.
// Runs before `next dev` and `next build`. Pages live in app/.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { LIMITS, MIN_SIZE, PAIRING, SIZES, WEIGHTS, sizesFor, toSvg } from '../lib/icon.mjs';
import { BRAND, CLI, COUNT, NAME, ORIGIN, TARBALL, categories, categoryTitle, icons, inCategory } from '../lib/site.mjs';
import { VERSION, packEntry, stagePackage, weightsOf } from '../cli/package.mjs';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');

rmSync(PUBLIC, { recursive: true, force: true });

const write = (path, content) => {
  const full = join(PUBLIC, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};

// Raw SVGs, including the other names an icon answers to
// Regular, the default, lives at /svg/{size}/{name}.svg. Other weights live at /svg/{weight}/{size}/{name}.svg.
// Semibold starts at 18, bold at 32, and black at 40.
for (const icon of icons) {
  for (const weight of weightsOf(icon)) {
    const dir = weight === 'regular' ? 'svg' : `svg/${weight}`;
    for (const size of sizesFor(weight)) {
      const svg = toSvg(icon, size, weight) + '\n';
      write(`${dir}/${size}/${icon.name}.svg`, svg);
      for (const alias of icon.aliases) write(`${dir}/${size}/${alias}.svg`, svg);
    }
  }
}

// Icons whose larger sizes can't be derived by scaling. The grid fetches these when the size changes.
write('sizes.json', JSON.stringify(Object.fromEntries(icons.filter((i) => i.sizes).map((i) => [i.name, { 16: i.body, ...i.sizes }]))));

write('icons.json', JSON.stringify({
  name: NAME,
  version: VERSION,
  license: 'MIT',
  count: COUNT,
  sizes: SIZES,
  weights: WEIGHTS,
  minSize: MIN_SIZE,
  url: `${ORIGIN}/svg/{size}/{name}.svg`,
  weightUrl: `${ORIGIN}/svg/{weight}/{size}/{name}.svg`,
  notes: 'body is the inner markup of the icon on its 16px grid, as drawn (thin). Every size is that drawing scaled up, lines included. weights lists the weights an icon comes in, and the weights table gives each line in pixels at 18px, the default size: a weight sets stroke-width on every stroked element, as that line scaled to the 16px grid. looks says what an icon looks like, use when to use it, and matches its name in other sets. minSize gives the smallest size a weight comes in. Fetch the url for a complete SVG. Icons use currentColor.',
  icons: icons.map(packEntry),
}));

// Agent instructions
const howTo = `## Install

Pick whichever fits the project. None of them needs an account or an API key.

In a React project, use the components. Only the icons you import are bundled:

    npm install @standardicon/react
    import { ClockIcon } from '@standardicon/react';   // <ClockIcon size={20} />

Otherwise, add icons to the project as SVG files. The CLI is a build-time tool: run it with npx, or install it with npm install --save-dev, never as a regular dependency.

    ${CLI} add arrow-up check search --out src/icons

Print one SVG, for pasting inline:

    ${CLI} get arrow-up --size 20

Pick a lighter or heavier line with --weight. ${LIMITS}

    ${CLI} add arrow-up check --weight thin
    ${CLI} add arrow-up --size 32 --weight bold

Find an icon by meaning. Use this before guessing a name:

    ${CLI} search delete

Without Node, fetch a file directly:

    curl -fsS ${ORIGIN}/svg/16/arrow-up.svg -o arrow-up.svg

## Use

- Sizes are ${SIZES.join(', ')}. The default is 18, for 14 to 15px text: navigation, toolbars, buttons and most UI.
- Pick the size from the text it sits beside, every time. ${PAIRING} A sidebar title or heading in larger type needs a larger icon than the items under it.
- Every size is the 16px drawing scaled up, so lines grow with the icon, like text. One SVG file works at any size: set its width and height (or CSS width and height) instead of adding the same icon once per size.
- Weights are thin (a 1px line at 18px), regular (1.33px, the default), semibold (1.5px), bold (2px), and black (2.5px). ${LIMITS} Icons with filled shapes come in one weight, regular: \`${CLI} list --weight semibold\` shows which icons have every weight. Raw files for other weights are at /svg/{weight}/{size}/{name}.svg.
- To switch a project from another set, \`${CLI} from lucide x trash-2 ChevronDown\` gives our name for each of theirs. It knows Lucide, Phosphor, Material, Tabler, Heroicons, Radix, Octicons, Fluent, and Carbon names.
- Icons draw in \`currentColor\`. Set the color with the CSS \`color\` property on the icon or its parent.
- When an icon has meaning on its own, such as an icon-only button, give it an accessible name with \`aria-label\` on the button.
- Decorative icons next to text should have \`aria-hidden="true"\`.
- Names are kebab-case. Common other names also work, such as \`external-link\` for \`pop-out\`.
- If nothing fits, don't draw a replacement in this style. Tell the user which icon is missing.`;

// Proves to the MCP Registry that standardicon.com owns the com.standardicon names. The private half of
// the key is in the Keychain as standardicon-mcp-registry.
write('.well-known/mcp-registry-auth', readFileSync(join(ROOT, 'site/mcp-registry-auth'), 'utf8'));

write('llms.txt', `# ${NAME}

> ${COUNT} free SVG line icons, drawn on a 16px grid. MIT licensed.

${howTo}

## Files

- [Every icon as JSON](${ORIGIN}/icons.json): names, categories, keywords, and SVG markup
- [Every icon name and keyword](${ORIGIN}/llms-full.txt): plain text that is easy to search
- [Agent skill](${ORIGIN}/SKILL.md): save this to make the set available in future sessions
- [Raw SVG](${ORIGIN}/svg/16/arrow-up.svg): the pattern is /svg/{size}/{name}.svg, or /svg/{weight}/{size}/{name}.svg for thin, semibold, bold, and black
- [License](${ORIGIN}/LICENSE.txt): MIT

## Categories

${categories.map((c) => `- [${categoryTitle(c)}](${ORIGIN}/categories/${c}/): ${inCategory(c).length} icons`).join('\n')}
`);

write('llms-full.txt', `# ${NAME}: every icon

${COUNT} icons. Each line is the name followed by what it can mean. Fetch one at ${ORIGIN}/svg/{size}/{name}.svg.

${categories.map((c) => `## ${categoryTitle(c)}\n\n${inCategory(c).map((i) => `${i.name}: ${i.keywords.filter((k) => k !== i.category).join(', ')}`).join('\n')}`).join('\n\n')}
`);

write('SKILL.md', `---
name: standard-icon
description: Add SVG icons to a project from The Standard Icon Set. Use when a UI needs an icon, or when the user asks for icons, an icon button, or a replacement for an icon library.
---

# ${NAME}

${COUNT} SVG line icons, drawn on a 16px grid. MIT licensed.

${howTo}

Search with \`${CLI} search <word>\`, then add what you need. Check for an existing icons folder first and put new files there, in the format the project already uses.
`);

// Static files
cpSync(join(ROOT, 'site/og.png'), join(PUBLIC, 'og.png'));
cpSync(join(ROOT, 'site/og-splash.png'), join(PUBLIC, 'og-splash.png')); // The preview for links shared before launch.
cpSync(join(ROOT, 'LICENSE'), join(PUBLIC, 'LICENSE.txt'));
const logoFile = readFileSync(join(ROOT, 'site/logo-mark.svg'), 'utf8');
const logo = logoFile.match(/<path[^>]*\/>/)[0].replace('fill="black"', 'fill="#fff"');
// The globe alone reads at this size. Fit it inside a 25px square, centred on the 32px icon.
const [, , logoWidth, logoHeight] = logoFile.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const logoScale = 25 / Math.max(logoWidth, logoHeight);
write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${BRAND}"/><g transform="translate(${(32 - logoWidth * logoScale) / 2} ${(32 - logoHeight * logoScale) / 2}) scale(${logoScale})">${logo}</g></svg>
`);

// CLI package, served as a tarball so npx works without an npm account
const pkgDir = join(ROOT, '.pack');
rmSync(pkgDir, { recursive: true, force: true });
stagePackage(pkgDir, icons);
const tarball = execFileSync('npm', ['pack', '--silent'], { cwd: pkgDir, encoding: 'utf8' }).trim().split('\n').pop();
renameSync(join(pkgDir, tarball), join(PUBLIC, TARBALL));
rmSync(pkgDir, { recursive: true, force: true });

console.log(`Generated public files for ${COUNT} icons.`);

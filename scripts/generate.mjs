#!/usr/bin/env node
// Writes everything that isn't a page into public/: raw SVGs, the JSON index, agent files, and the CLI package.
// Runs before `next dev` and `next build`. Pages live in app/.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { MIN_SIZE, SIZES, WEIGHTS, sizesFor, toSvg } from '../lib/icon.mjs';
import { howTo, skillMd } from '../lib/skill.mjs';
import { BRAND, COUNT, NAME, ORIGIN, TARBALL, categories, categoryTitle, icons, inCategory } from '../lib/site.mjs';
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

// Proves to the MCP Registry that standardicon.com owns the com.standardicon names. The private half of
// the key is in the Keychain as standardicon-mcp-registry.
write('.well-known/mcp-registry-auth', readFileSync(join(ROOT, 'site/mcp-registry-auth'), 'utf8'));

// RFC 9116. Matches SECURITY.md: reports go through GitHub's private vulnerability reporting. Expires must
// be under a year away, so each build moves it forward.
write('.well-known/security.txt', `Contact: https://github.com/Standard-Icon/standardicon/security/advisories/new
Expires: ${new Date(Date.now() + 330 * 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}
Policy: https://github.com/Standard-Icon/standardicon/blob/main/SECURITY.md
Preferred-Languages: en
Canonical: ${ORIGIN}/.well-known/security.txt
`);

write('llms.txt', `# ${NAME}

> ${COUNT} free SVG line icons, drawn on a 16px grid. MIT licensed.

${howTo}

## Files

- [Every icon as JSON](${ORIGIN}/icons.json): names, categories, keywords, and SVG markup
- [Every icon name and keyword](${ORIGIN}/llms-full.txt): plain text that is easy to search
- [Agent skill](${ORIGIN}/SKILL.md): save this to make the set available in future sessions
- [Raw SVG](${ORIGIN}/svg/16/arrow-up.svg): the pattern is /svg/{size}/{name}.svg, or /svg/{weight}/{size}/{name}.svg for thin, semibold, bold, and black
- [License](${ORIGIN}/LICENSE.txt): MIT
- [Changelog](${ORIGIN}/changelog/): what changed in each release

## Categories

${categories.map((c) => `- [${categoryTitle(c)}](${ORIGIN}/categories/${c}/): ${inCategory(c).length} icons`).join('\n')}
`);

write('llms-full.txt', `# ${NAME}: every icon

${COUNT} icons. Each line is the name followed by what it can mean. Fetch one at ${ORIGIN}/svg/{size}/{name}.svg.

${categories.map((c) => `## ${categoryTitle(c)}\n\n${inCategory(c).map((i) => `${i.name}: ${i.keywords.filter((k) => k !== i.category).join(', ')}`).join('\n')}`).join('\n\n')}
`);

// The skill is also committed at skills/standard-icon/SKILL.md so `npx skills add Standard-Icon/standardicon` finds it.
write('SKILL.md', skillMd());
mkdirSync(join(ROOT, 'skills/standard-icon'), { recursive: true });
writeFileSync(join(ROOT, 'skills/standard-icon/SKILL.md'), skillMd());

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

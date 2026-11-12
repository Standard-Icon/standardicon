// Builds the data the MCP server ships with: every icon the site shows, with its keywords and the
// description from its record, plus a copy of the renderer the site and CLI use, so all three draw identical SVGs.
// Run `node packages/mcp/build.mjs` (from anywhere) before testing or publishing.
import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
// The site's data module reads files relative to the repo root.
process.chdir(root);
const { weightsFor } = await import('../../lib/icon.mjs');
const { categories, categoryTitle, icons } = await import('../../lib/site.mjs');
// Descriptions live in each icon's record (icons/records/<name>.json), where the workbench edits them.
const { readRecord } = await import('../../lib/records.mjs');
const descriptions = Object.fromEntries(icons.map((icon) => [icon.name, readRecord(icon.name)]).filter(([, record]) => record?.looks));

const missing = icons.filter((icon) => !descriptions[icon.name]).map((icon) => icon.name);
if (missing.length) console.warn(`No description yet for ${missing.length} icons: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`);

const data = {
  categories: categories.map((category) => ({ category, title: categoryTitle(category), count: icons.filter((i) => i.category === category).length })),
  icons: icons.map((icon) => ({
    name: icon.name,
    category: icon.category,
    aliases: icon.aliases,
    keywords: icon.keywords,
    weights: weightsFor(icon),
    looks: descriptions[icon.name]?.looks ?? '',
    use: descriptions[icon.name]?.use ?? '',
    body: icon.body,
    ...(icon.sizes ? { sizes: icon.sizes } : {}),
  })),
};

writeFileSync(join(here, 'data.json'), JSON.stringify(data));
copyFileSync(join(root, 'lib', 'icon.mjs'), join(here, 'icon.mjs'));
console.log(`Built packages/mcp/data.json: ${data.icons.length} icons in ${data.categories.length} categories.`);

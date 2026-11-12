// Builds the `standardicon` npm package into a folder. generate.mjs packs that folder into the tarball the
// site serves, and the CLI tests run the CLI from it, so what's tested is what ships.
//
// Only these files go in the package. Never add font files: Polymath is licensed for standardicon.com only.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIZES, WEIGHTS, weightsFor } from '../lib/icon.mjs';
import { readRecord } from '../lib/records.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export const PACKAGE_NAME = 'standardicon';
export const HOMEPAGE = 'https://standardicon.com';

// The public copy of this repo (npm run public-repo). package.json gets `repository` and `bugs` from it.
// npm trusted publishing needs `repository` to match the repo that publishes.
export const REPOSITORY = 'https://github.com/Standard-Icon/standardicon';

// The version lives in the root package.json and nowhere else. scripts/release.mjs changes it.
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const WEIGHT_NAMES = Object.keys(WEIGHTS);
export const weightsOf = weightsFor;

// Other sets an icon's equivalent can be looked up in, by their own names (`standardicon from lucide x`).
// The matches come from the workbench, checked by hand. Only open sets are named: never Iconic (a paid set)
// or SF Symbols (Apple's terms). scripts/audit-repo.mjs allows these names here and nowhere else.
export const MATCH_SETS = ['lucide', 'phosphor', 'material', 'tabler', 'heroicons', 'radix', 'octicons', 'fluent', 'carbon'];

// What an icon looks like and when to use it, and its match in each other set, from its record.
function described(name) {
  const record = readRecord(name) ?? {};
  const matches = Object.fromEntries(MATCH_SETS.map((set) => [set, record.compare?.[set]]).filter(([, match]) => typeof match === 'string'));
  // Further names in a set that also mean this icon, such as Lucide's trash-2 beside trash.
  const also = Object.fromEntries(MATCH_SETS.map((set) => [set, record.compareAlso?.[set]]).filter(([, list]) => list?.length));
  return { ...(record.looks ? { looks: record.looks } : {}), ...(record.use ? { use: record.use } : {}), ...(Object.keys(matches).length ? { matches } : {}), ...(Object.keys(also).length ? { also } : {}) };
}

// Old names other sets still accept, so `from lucide MoreHorizontal` finds ellipsis's match. Lucide's
// package exports each old name from its current icon's file. Only names that differ are kept.
const kebab = (name) => name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').replace(/([0-9])([A-Za-z])/g, '$1-$2').toLowerCase();
export function renames() {
  const lucide = join(ROOT, 'node_modules/lucide-static/dist/esm/lucide-static.mjs');
  if (!existsSync(lucide)) return {};
  const map = {};
  for (const [, old, current] of readFileSync(lucide, 'utf8').matchAll(/default as (\w+) \} from '\.\/icons\/([a-z0-9-]+)\.mjs'/g)) {
    if (kebab(old) !== current) map[kebab(old)] = current;
  }
  return { lucide: map };
}

// How an icon appears in published JSON: the CLI's icons.json and the site's /icons.json.
export const packEntry = (icon) => {
  const { name, category, aliases, keywords, body, sizes } = icon;
  return { name, category, aliases, keywords, ...described(name), weights: weightsOf(icon), body, ...(sizes ? { sizes } : {}) };
};

export function packageJson({ count, version = VERSION }) {
  return {
    name: PACKAGE_NAME,
    version,
    description: `The Standard Icon Set: ${count} SVG line icons, in ${SIZES.length} sizes and ${WEIGHT_NAMES.length} weights, with a CLI that copies them into a project: run it with npx or install it as a dev dependency. For React, use @standardicon/react. Works offline.`,
    keywords: ['standard icon', 'standard icons', 'standard-icon', 'standard-icons', 'the standard icon set', 'icons', 'icon', 'svg', 'svg-icons', 'icon-set', 'stroke-icons', 'line-icons', 'ui', 'cli'],
    homepage: HOMEPAGE,
    ...(REPOSITORY ? { repository: { type: 'git', url: `git+${REPOSITORY}.git` }, bugs: { url: `${REPOSITORY}/issues` } } : {}),
    license: 'MIT',
    author: 'Morgan Knutson',
    type: 'module',
    bin: { [PACKAGE_NAME]: 'cli.mjs' },
    exports: {
      './icons.json': './icons.json',
      './icon': './icon.mjs',
      './package.json': './package.json',
    },
    files: ['cli.mjs', 'icon.mjs', 'icons.json', 'renames.json'],
    engines: { node: '>=18' },
  };
}

// The README's {{count}} and {{version}} are filled in here, so the numbers are always current.
export function readme({ count, version = VERSION }) {
  return readFileSync(join(HERE, 'README.md'), 'utf8').replaceAll('{{count}}', String(count)).replaceAll('{{version}}', version);
}

// Writes the package into dir. icons are the source icons, as lib/site.mjs exports them.
export function stagePackage(dir, icons, { version = VERSION } = {}) {
  const count = icons.length;
  mkdirSync(dir, { recursive: true });
  cpSync(join(HERE, 'cli.mjs'), join(dir, 'cli.mjs'));
  cpSync(join(ROOT, 'lib/icon.mjs'), join(dir, 'icon.mjs'));
  cpSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'));
  writeFileSync(join(dir, 'icons.json'), JSON.stringify(icons.map(packEntry)));
  writeFileSync(join(dir, 'renames.json'), JSON.stringify(renames()));
  writeFileSync(join(dir, 'README.md'), readme({ count, version }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson({ count, version }), null, 2) + '\n');
  return dir;
}

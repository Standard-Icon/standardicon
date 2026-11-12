// Builds @standardicon/react: one React component per icon, from the same 16px drawings and weights the site,
// CLI and MCP server use, so <ClockIcon size={24} /> draws exactly what `standardicon get clock --size 24` prints.
// Run `node packages/react/build.mjs` (from anywhere) before testing or publishing. It writes dist/, which git ignores.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
process.chdir(root); // The site's data module reads files relative to the repo root.
const { MIN_SIZE, SIZES, WEIGHTS, DEFAULT_SIZE, DEFAULT_WEIGHT, hasWeights, strokeFor } = await import('../../lib/icon.mjs');
const { icons } = await import('../../lib/site.mjs');
const { readRecord } = await import('../../lib/records.mjs');

// clock → ClockIcon, skip-back-10 → SkipBack10Icon.
export const componentName = (name) => `${name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}Icon`;

// An icon's markup as [tag, props] pairs, with SVG attribute names as React spells them.
const camel = (attr) => attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function parts(body) {
  const out = [];
  for (const [, tag, attrs] of body.matchAll(/<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*\/>/g)) {
    const props = {};
    for (const [, key, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) props[camel(key)] = value;
    out.push([tag, props]);
  }
  const elements = body.match(/<\w+/g)?.length ?? 0;
  if (out.length !== elements) throw new Error(`Couldn't read every element of an icon body: ${body.slice(0, 120)}`);
  return out;
}

const seen = new Map();
const entries = icons.map((icon) => {
  const component = componentName(icon.name);
  if (seen.has(component)) throw new Error(`${icon.name} and ${seen.get(component)} would both be ${component}.`);
  seen.set(component, icon.name);
  const record = readRecord(icon.name) ?? {};
  return { name: icon.name, component, fixed: !hasWeights(icon), parts: parts(icon.body), looks: record.looks, use: record.use };
});

const runtime = `import { createElement, forwardRef } from 'react';

const SIZES = ${JSON.stringify(SIZES)};
const WEIGHTS = ${JSON.stringify(WEIGHTS)};
// Each weight's line in the drawing's 16px units: the line at 18px, scaled to the 16px grid.
const STROKES = ${JSON.stringify(Object.fromEntries(Object.keys(WEIGHTS).map((w) => [w, strokeFor(w)])))};
const MIN_SIZE = ${JSON.stringify(MIN_SIZE)};
const ONE_WEIGHT = ['thin', 'regular'];
const fits = (weight, size) => size >= (MIN_SIZE[weight] ?? 0);
const heaviestFor = (size) => Object.keys(WEIGHTS).filter((weight) => fits(weight, size)).pop();
const smallestFor = (weight) => SIZES.find((size) => fits(weight, size));
// Without a size: ${DEFAULT_SIZE}, the size for navigation, toolbars and buttons, or the smallest size the weight comes in.
const defaultFor = (weight) => Math.max(${DEFAULT_SIZE}, smallestFor(weight));
const warned = new Set();
function warn(message) {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return;
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(\`@standardicon/react: \${message}\`);
}

// Every size is the 16px drawing scaled up, so lines grow with the icon. The weight sets the line at 18px.
function createIcon(name, parts, fixed) {
  const Icon = forwardRef(function StandardIcon({ size, weight = ${JSON.stringify(DEFAULT_WEIGHT)}, title, ...rest }, ref) {
    let w = weight;
    if (!Object.hasOwn(WEIGHTS, w)) {
      warn(\`"\${w}" isn't a weight. Use \${Object.keys(WEIGHTS).join(', ')}. Drawing \${name} in regular.\`);
      w = 'regular';
    }
    if (fixed && !ONE_WEIGHT.includes(w)) {
      warn(\`\${name} comes in one weight, regular, because it has filled shapes. Drawing it in regular.\`);
      w = 'regular';
    }
    const s = size ?? defaultFor(w);
    if (!SIZES.includes(s)) warn(\`\${s} isn't one of the sizes (\${SIZES.join(', ')}). Drawing \${name} at \${s} anyway.\`);
    if (!fits(w, s)) {
      const lighter = heaviestFor(s);
      warn(\`\${w} comes in \${smallestFor(w)} and up, so \${name} at \${s} is drawn in \${lighter}.\`);
      w = lighter;
    }
    const width = fixed ? undefined : STROKES[w];
    const labelled = Boolean(title || rest['aria-label'] || rest['aria-labelledby']);
    return createElement(
      'svg',
      { xmlns: 'http://www.w3.org/2000/svg', width: s, height: s, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': labelled ? undefined : true, role: labelled ? 'img' : undefined, ...rest, ref },
      title ? createElement('title', null, title) : null,
      ...parts.map(([tag, props], i) => createElement(tag, width && props.stroke === 'currentColor' ? { key: i, ...props, strokeWidth: width } : { key: i, ...props })),
    );
  });
  Icon.displayName = ${'`${name}`'};
  return Icon;
}
`;

const doc = (entry) => {
  const lines = [entry.looks, entry.use, entry.fixed ? 'Comes in one weight, regular, because it has filled shapes.' : null, `Standard Icon name: ${entry.name}.`].filter(Boolean);
  return `/** ${lines.join(' ').replace(/\*\//g, '* /')} */`;
};

const js = runtime + '\n' + entries.map((e) => `${doc(e)}\nexport const ${e.component} = /*#__PURE__*/ createIcon(${JSON.stringify(e.name)}, ${JSON.stringify(e.parts)}, ${e.fixed});`).join('\n') + '\n';

const sizeUnion = SIZES.join(' | ');
const dts = `import type { ReactElement, RefAttributes, SVGProps } from 'react';

/** Each weight's line at 18px, the default size: thin ${WEIGHTS.thin}, regular ${WEIGHTS.regular} (the default), semibold ${WEIGHTS.semibold}, bold ${WEIGHTS.bold}, black ${WEIGHTS.black}. Lines grow with the size. */
export type Weight = ${Object.keys(WEIGHTS).map((w) => `'${w}'`).join(' | ')};
export type Size = ${sizeUnion};
/** The sizes a weight comes in: ${Object.entries(MIN_SIZE).map(([w, min]) => `${w} from ${min}`).join(', ')}. */
export type SizeFor<W extends Weight> = ${Object.entries(MIN_SIZE).sort((a, b) => b[1] - a[1]).map(([w, min]) => `W extends '${w}' ? ${SIZES.filter((s) => s >= min).join(' | ')} :`).join(' ')} Size;

type SvgProps = Omit<SVGProps<SVGSVGElement>, 'ref' | 'children' | 'width' | 'height'> & {
  /** Names the icon for screen readers. Without a title or aria-label, the icon is hidden from them. */
  title?: string;
};
export type IconProps<W extends Weight = 'regular'> = SvgProps & { weight?: W; size?: SizeFor<W> };
/** An icon drawn entirely in lines: every weight, with heavier ones from larger sizes. */
export type IconComponent = (<W extends Weight = 'regular'>(props: IconProps<W> & RefAttributes<SVGSVGElement>) => ReactElement | null) & { displayName?: string };
/** An icon with filled shapes: one weight, regular, at every size. */
export type OneWeightIconComponent = ((props: SvgProps & { weight?: 'thin' | 'regular'; size?: Size } & RefAttributes<SVGSVGElement>) => ReactElement | null) & { displayName?: string };

${entries.map((e) => `${doc(e)}\nexport declare const ${e.component}: ${e.fixed ? 'OneWeightIconComponent' : 'IconComponent'};`).join('\n')}
`;

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'index.js'), js);
writeFileSync(join(here, 'dist', 'index.d.ts'), dts);
console.log(`Built packages/react/dist: ${entries.length} components, ${entries.filter((e) => e.fixed).length} in one weight.`);

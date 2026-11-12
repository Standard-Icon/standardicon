// Checks the generated SVGs in public/svg before a release. Icons must be plain shapes painted with
// currentColor, so they take on the color of the text around them on any background. This catches
// what Figma exports can leave behind: masks, clip paths, white shapes faking cutouts, hardcoded
// colors, opacity, ids, and inline styles.
//
// Run `npm run generate` first. Exits with 1 if any file breaks a rule.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG_DIR = join(ROOT, 'public/svg');

const ELEMENTS = new Set(['svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'g']);

const ATTRIBUTES = new Set([
  'xmlns', 'width', 'height', 'viewBox',
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'fill-rule', 'clip-rule',
]);

// Paint is either nothing or the text color. Anything else won't follow the surrounding color.
const PAINT = new Set(['none', 'currentColor']);
const WHITE = /^(#fff(f)?|#ffffff(ff)?|white|rgba?\(\s*255\s*,\s*255\s*,\s*255\b.*)$/i;

// Elements that only make sense in a broken or decorated export. Named so the message says why.
const WHY = {
  mask: 'a mask (convert the cutout to a real subtraction)',
  clipPath: 'a clip path (flatten it in Figma)',
  defs: 'a <defs> block',
  use: 'a <use> reference',
  image: 'an embedded image',
  style: 'a <style> block',
  filter: 'a filter',
  linearGradient: 'a gradient',
  radialGradient: 'a gradient',
  pattern: 'a pattern',
  text: 'text (outline it in Figma)',
};

function* svgFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* svgFiles(full);
    else if (entry.name.endsWith('.svg')) yield full;
  }
}

function check(svg, size) {
  const problems = [];
  const tags = svg.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g);
  let root = true;
  for (const [, tag, attrs] of tags) {
    if (WHY[tag]) problems.push(`has ${WHY[tag]}`);
    else if (!ELEMENTS.has(tag)) problems.push(`has an unexpected <${tag}>`);

    for (const [, name, value] of attrs.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (name === 'fill' || name === 'stroke') {
        if (WHITE.test(value)) problems.push(`has a white ${name} (${value}), which won't follow the text color and disappears on light backgrounds`);
        else if (!PAINT.has(value)) problems.push(`has a hardcoded ${name} color (${value}); use currentColor`);
      } else if (/opacity$/.test(name)) {
        problems.push(`has ${name}="${value}"`);
      } else if (name === 'style') {
        problems.push(`has an inline style (${value})`);
      } else if (name === 'id' || name === 'class') {
        problems.push(`has ${name}="${value}", which can collide when icons are inlined together`);
      } else if (name.includes(':') && name !== 'xmlns:xlink') {
        problems.push(`has a namespaced attribute (${name})`);
      } else if (!ATTRIBUTES.has(name)) {
        problems.push(`has an unexpected attribute (${name}="${value}")`);
      }
    }

    if (root) {
      root = false;
      if (tag !== 'svg') problems.push('does not start with <svg>');
      // Every size is the 16px drawing scaled up: the viewBox stays 16 and the width and height give the size.
      else if (size && !(attrs.includes('viewBox="0 0 16 16"') && attrs.includes(`width="${size}"`) && attrs.includes(`height="${size}"`))) problems.push(`isn't the 16px drawing shown at its ${size}px folder's size`);
    }
  }
  if (/<!--/.test(svg)) problems.push('has a comment');
  if (/<\?xml|<!DOCTYPE/.test(svg)) problems.push('has an XML or DOCTYPE header');
  return [...new Set(problems)];
}

if (!existsSync(SVG_DIR)) {
  console.error('No SVGs found in public/svg. Run `npm run generate` first.');
  process.exit(1);
}

// Aliases are copies of the same SVG, and every size and weight comes from the same source, so group
// by problem and icon to keep the report short.
const byProblem = new Map();
let files = 0;
for (const file of svgFiles(SVG_DIR)) {
  files++;
  const rel = relative(SVG_DIR, file);
  const parts = rel.split('/');
  const name = parts.pop().replace(/\.svg$/, '');
  const size = Number(parts.at(-1)) || null;
  for (const problem of check(readFileSync(file, 'utf8'), size)) {
    if (!byProblem.has(problem)) byProblem.set(problem, new Map());
    const icons = byProblem.get(problem);
    if (!icons.has(name)) icons.set(name, []);
    icons.get(name).push(parts.join('/'));
  }
}

if (!byProblem.size) {
  console.log(`Checked ${files} SVGs. All clean.`);
  process.exit(0);
}

const broken = new Set();
for (const [problem, icons] of byProblem) {
  console.log(`\n${icons.size} icon${icons.size === 1 ? '' : 's'} ${problem}:`);
  for (const [name, where] of icons) {
    broken.add(name);
    const shown = where.slice(0, 4).join(', ') + (where.length > 4 ? `, and ${where.length - 4} more` : '');
    console.log(`  ${name}  (${shown})`);
  }
}
console.log(`\nChecked ${files} SVGs. ${broken.size === 1 ? '1 icon needs' : `${broken.size} icons need`} fixing.`);
process.exit(1);

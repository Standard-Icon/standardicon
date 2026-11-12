// node packages/react/build.mjs && node --test packages/react/react.test.mjs
// Renders the built components and checks them against the renderer the site, CLI and MCP server use.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
process.chdir(root);
const { SIZES, WEIGHTS, hasWeights, sizesFor, toSvg } = await import('../../lib/icon.mjs');
const { icons } = await import('../../lib/site.mjs');
const components = await import('./dist/index.js');
const { componentName } = await import('./build.mjs');

const render = (Component, props = {}) => renderToStaticMarkup(createElement(Component, props));
// The parts of an SVG that matter, in order: each element's tag, geometry, and line width.
const shape = (svg) => [...svg.matchAll(/<(path|circle|rect|ellipse|line)\b([^>]*)\/?>/g)].map(([, tag, attrs]) => {
  const get = (key) => attrs.match(new RegExp(`\\s${key}="([^"]*)"`))?.[1] ?? null;
  return [tag, get('d') ?? [get('cx'), get('cy'), get('r'), get('x'), get('y'), get('width'), get('height'), get('x1'), get('y1')].join(','), get('stroke-width')];
});
const box = (svg) => svg.match(/<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"[^>]*viewBox="([^"]+)"/)?.slice(1).join(' ');

const warnings = [];
const realWarn = console.warn;
console.warn = (message) => warnings.push(message);
after(() => { console.warn = realWarn; });

describe('components', () => {
  test('every icon is a component with the expected name', () => {
    for (const icon of icons) assert.equal(typeof components[componentName(icon.name)], 'object', icon.name);
    const exported = Object.keys(components).filter((key) => key.endsWith('Icon'));
    assert.equal(exported.length, icons.length);
  });

  test('every icon draws exactly what the CLI draws, at every size and weight it comes in', () => {
    for (const icon of icons) {
      const Component = components[componentName(icon.name)];
      const weights = hasWeights(icon) ? Object.keys(WEIGHTS) : ['regular'];
      for (const weight of weights) {
        for (const size of [sizesFor(weight)[0], 48]) {
          const ours = render(Component, { size, weight });
          const cli = toSvg(icon, size, weight);
          assert.deepEqual(shape(ours), shape(cli), `${icon.name} ${size} ${weight}`);
          assert.equal(box(ours), box(cli), `${icon.name} ${size} ${weight}`);
        }
      }
    }
  });

  test('defaults are 18px regular, hidden from screen readers', () => {
    const svg = render(components.ArrowUpIcon);
    assert.match(svg, /width="18" height="18" viewBox="0 0 16 16"/);
    assert.match(svg, /stroke-width="1.182"/);
    assert.match(svg, /aria-hidden="true"/);
  });

  test('a title names the icon instead of hiding it', () => {
    const svg = render(components.ArrowUpIcon, { title: 'Up' });
    assert.match(svg, /<title>Up<\/title>/);
    assert.match(svg, /role="img"/);
    assert.doesNotMatch(svg, /aria-hidden/);
  });

  test('other props reach the svg', () => {
    const svg = render(components.ArrowUpIcon, { className: 'x', style: { color: 'red' }, 'data-test': 'y' });
    assert.match(svg, /class="x"/);
    assert.match(svg, /style="color:red"/);
    assert.match(svg, /data-test="y"/);
  });

  test('a weight too heavy for the size steps down, with a warning', () => {
    warnings.length = 0;
    const svg = render(components.ArrowUpIcon, { size: 16, weight: 'bold' });
    assert.match(svg, /stroke-width="1.182"/);
    assert.ok(warnings.some((w) => /bold comes in 32 and up/.test(w)));
  });

  test('without a size, a heavy weight uses the smallest size it comes in', () => {
    assert.match(render(components.ArrowUpIcon, { weight: 'black' }), /width="40"/);
  });

  test('an icon with filled shapes stays as drawn, and warns on a heavier weight', () => {
    const fixed = icons.find((icon) => !hasWeights(icon));
    if (!fixed) return;
    warnings.length = 0;
    const Component = components[componentName(fixed.name)];
    assert.doesNotMatch(render(Component, { size: 32, weight: 'bold' }), /stroke-width/);
    assert.ok(warnings.some((w) => /one weight, regular/.test(w)));
  });
});

describe('types', () => {
  const work = mkdtempSync(join(tmpdir(), 'standardicon-react-types-'));
  after(() => rmSync(work, { recursive: true, force: true }));

  test('impossible combinations fail to compile, and good ones pass', () => {
    const fixed = icons.find((icon) => !hasWeights(icon));
    const file = join(work, 'check.tsx');
    writeFileSync(file, `import { ArrowUpIcon${fixed ? `, ${componentName(fixed.name)} as Fixed` : ''} } from '${join(here, 'dist', 'index.js')}';
export const good = [<ArrowUpIcon />, <ArrowUpIcon size={24} weight="semibold" />, <ArrowUpIcon weight="black" size={48} className="a" />, <ArrowUpIcon title="Up" />];
// @ts-expect-error semibold starts at 18
export const a = <ArrowUpIcon weight="semibold" size={16} />;
// @ts-expect-error black starts at 40
export const b = <ArrowUpIcon weight="black" size={32} />;
// @ts-expect-error not a size
export const c = <ArrowUpIcon size={17} />;
// @ts-expect-error not a weight
export const d = <ArrowUpIcon weight="medium" />;
${fixed ? `// @ts-expect-error one weight\nexport const e = <Fixed weight="bold" size={32} />;\nexport const f = <Fixed size={24} />;` : ''}
`);
    const tsc = join(root, 'node_modules', '.bin', 'tsc');
    execFileSync(tsc, ['--noEmit', '--strict', '--jsx', 'react-jsx', '--module', 'esnext', '--moduleResolution', 'bundler', '--skipLibCheck', '--types', 'react', '--typeRoots', join(root, 'node_modules', '@types'), file], { cwd: root, stdio: 'pipe' });
  });
});

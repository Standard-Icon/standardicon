// node packages/react/build.mjs && node --test packages/react/shake.test.mjs
// Proves tree-shaking: a bundle that imports one icon contains that icon and no other.
// No esbuild is installed, so this bundles with the webpack and terser that ship inside Next
// (a dev dependency of the site), in production-style settings: ESM, minified, react external.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { after, describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist', 'index.js');
const require = createRequire(join(here, '..', '..', 'package.json'));
const work = mkdtempSync(join(tmpdir(), 'standardicon-shake-'));
after(() => rmSync(work, { recursive: true, force: true }));

const webpack = require('next/dist/compiled/webpack/webpack.js');
webpack.init?.();
const terser = require('next/dist/compiled/terser/bundle.min.js');

// Bundles `import { <names> } from dist/index.js` and returns the minified code.
const bundle = async (names, label) => {
  const entry = join(work, `${label}.mjs`);
  writeFileSync(entry, `import { ${names.join(', ')} } from ${JSON.stringify(dist)};\nconsole.log(${names.join(', ')});\n`);
  const stats = await new Promise((resolve, reject) => {
    webpack.webpack({
      mode: 'production',
      entry,
      externals: { react: 'react' },
      output: { path: join(work, label), filename: 'out.js' },
      optimization: { minimize: false },
    }, (error, result) => (error ? reject(error) : resolve(result)));
  });
  assert.ok(!stats.hasErrors(), stats.toString({ all: false, errors: true }));
  const { code } = await terser.minify(readFileSync(join(work, label, 'out.js'), 'utf8'), { compress: { passes: 2 }, mangle: true, module: true });
  return { code, bytes: Buffer.byteLength(code), gzip: gzipSync(code).length };
};

// The first path of an icon in the built file, which no other icon shares.
const source = readFileSync(dist, 'utf8');
const pathOf = (name) => source.match(new RegExp(`export const ${name} = [^\\n]*?"d":"([^"]+)"`))[1];

describe('tree shaking', () => {
  test('one icon bundles that icon and no other', async () => {
    const one = await bundle(['ClockIcon'], 'one');
    console.log(`1 icon: ${one.bytes} B minified, ${one.gzip} B gzipped`);
    assert.ok(one.code.includes(pathOf('ClockIcon')), 'the imported icon is in the bundle');
    for (const other of ['TrashIcon', 'BellIcon', 'AlarmClockIcon']) {
      assert.ok(!one.code.includes(pathOf(other)), `${other} path data is not in the bundle`);
      assert.ok(!one.code.includes(other), `${other} is not in the bundle`);
    }
    assert.ok(one.bytes < 8_000, `${one.bytes} B minified is over the 8 KB ceiling`);
    assert.ok(one.gzip < 4_000, `${one.gzip} B gzipped is over the 4 KB ceiling`);
  });

  test('the bundle grows with each icon imported', async () => {
    const one = await bundle(['ClockIcon'], 'one-again');
    const names = ['ClockIcon', 'TrashIcon', 'BellIcon', 'AlarmClockIcon', 'ArrowUpIcon'];
    const five = await bundle(names, 'five');
    console.log(`5 icons: ${five.bytes} B minified, ${five.gzip} B gzipped`);
    for (const name of names) assert.ok(five.code.includes(pathOf(name)), `${name} is in the bundle`);
    assert.ok(five.bytes > one.bytes);
    assert.ok(five.bytes < one.bytes + 5 * 2_500, 'five icons cost about five icons, not the whole set');
  });
});

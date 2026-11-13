// node --test cli/cli.test.mjs
// Builds the package the way generate.mjs does, then runs the real CLI from it. Paths go through
// node:path, so these pass on Windows too.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { MIN_SIZE, SIZES, WEIGHTS, bodyFor, hasWeights, scaleBody, sizesFor, strokeFor, toSvg, weighBody } from '../lib/icon.mjs';
import { skillMd } from '../lib/skill.mjs';
import { icons } from '../lib/site.mjs';
import { HOMEPAGE, REPOSITORY, VERSION, packEntry, packageJson, stagePackage } from './package.mjs';

const work = mkdtempSync(join(tmpdir(), 'standardicon-test-'));
after(() => rmSync(work, { recursive: true, force: true }));
const pkg = stagePackage(join(work, 'pkg'), icons);
// The set may have no regular-only icon right now, so a made-up one covers that rule.
const filled = { name: 'test-filled-dot', category: 'symbols', aliases: [], keywords: ['dot'], body: '<circle cx="8" cy="8" r="3" fill="currentColor"/>' };
const withFilled = stagePackage(join(work, 'with-filled'), [...icons, filled]);
let runs = 0;

// Runs the CLI in a fresh folder, and parses stdout when --json was passed.
function cli(args, { cwd, from = pkg } = {}) {
  const dir = cwd ?? join(work, `run-${++runs}`);
  mkdirSync(dir, { recursive: true });
  const result = spawnSync(process.execPath, [join(from, 'cli.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  const json = args.includes('--json') && result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
  return { code: result.status, out: result.stdout, err: result.stderr, json, dir };
}

const plain = icons.find((icon) => icon.name === 'arrow-up');
const aliased = icons.find((icon) => icon.aliases.length);

describe('rendering', () => {
  test('weights are lines at 18px, written in the drawing\'s 16px units, and regular is the default', () => {
    assert.match(toSvg(plain, 16, 'thin'), /stroke-width="0.889"/);
    assert.equal(toSvg(plain), toSvg(plain, 18, 'regular'));
    assert.match(toSvg(plain), /width="18" height="18" viewBox="0 0 16 16"/);
    assert.match(toSvg(plain), /stroke-width="1.182"/);
  });

  test('every size is the 16px drawing scaled up, so lines grow with it', () => {
    for (const size of SIZES) {
      const svg = toSvg(plain, size);
      assert.match(svg, new RegExp(`width="${size}" height="${size}" viewBox="0 0 16 16"`));
      assert.match(svg, /stroke-width="1.182"/);
    }
  });

  test('scaleBody still scales coordinates, for tools that draw at a size', () => {
    assert.equal(scaleBody('<path d="M1 2L3 4" stroke="currentColor"/>', 32), '<path d="M2 4L6 8" stroke="currentColor"/>');
    assert.equal(scaleBody('<circle cx="8" cy="8" r="2.5"/>', 24), '<circle cx="12" cy="12" r="3.75"/>');
  });

  test('a size drawn by hand is used instead of scaling', () => {
    // A sample icon, since whether the set has one drawn by hand right now changes as it's redrawn.
    const drawn = { name: 'sample', body: '<path d="M2 2H14" stroke="currentColor"/>', sizes: { 24: '<path d="M3 3H21" stroke="currentColor"/>' } };
    assert.equal(bodyFor(drawn, 24), drawn.sizes[24]);
    assert.notEqual(bodyFor(drawn, 32), drawn.sizes[24]);
  });

  test('weights set stroke-width on stroked elements only', () => {
    const body = '<path d="M0 0" stroke="currentColor"/><path d="M1 1" fill="currentColor"/>';
    assert.equal(weighBody(body, 'regular'), '<path d="M0 0" stroke="currentColor" stroke-width="1.182"/><path d="M1 1" fill="currentColor"/>');
    for (const weight of Object.keys(WEIGHTS)) {
      assert.match(toSvg(plain, sizesFor(weight)[0], weight), new RegExp(`stroke-width="${strokeFor(weight)}"`));
    }
    assert.throws(() => weighBody(body, 'heavy'), /Unknown weight/);
  });

  test('heavy weights refuse sizes below their minimum', () => {
    for (const [weight, min] of Object.entries(MIN_SIZE)) {
      assert.throws(() => toSvg(plain, SIZES[SIZES.indexOf(min) - 1], weight));
      assert.doesNotThrow(() => toSvg(plain, min, weight));
    }
  });

  test('icons with filled shapes come in one weight, drawn as they are', () => {
    assert.throws(() => toSvg(filled, 18, 'semibold'), /one weight, regular/);
    assert.equal(toSvg(filled), toSvg(filled, 18, 'thin'));
    assert.doesNotMatch(toSvg(filled), /stroke-width/);
    assert.deepEqual(packEntry(filled).weights, ['thin', 'regular']);
    assert.deepEqual(packEntry(plain).weights, Object.keys(WEIGHTS));
  });

  test('every icon renders at every size and weight it claims', () => {
    for (const icon of icons) {
      for (const weight of packEntry(icon).weights) {
        for (const size of sizesFor(weight)) {
          const svg = toSvg(icon, size, weight);
          assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), `${icon.name} ${size} ${weight}`);
          assert.doesNotMatch(svg, /NaN|undefined/, `${icon.name} ${size} ${weight}`);
        }
      }
    }
  });
});

describe('names', () => {
  test('names are kebab-case and unique, and aliases never collide', () => {
    const seen = new Map();
    for (const icon of icons) {
      for (const label of [icon.name, ...icon.aliases]) {
        assert.match(label, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${icon.name}: "${label}"`);
        assert.ok(!seen.has(label), `"${label}" belongs to both ${seen.get(label)} and ${icon.name}`);
        seen.set(label, icon.name);
      }
    }
  });
});

describe('package', () => {
  test('package.json is complete and carries the root version', () => {
    const json = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    assert.deepEqual(json, packageJson({ count: icons.length }));
    assert.equal(json.version, VERSION);
    assert.equal(json.license, 'MIT');
    assert.equal(json.homepage, HOMEPAGE);
    assert.equal(json.bin.standardicon, 'cli.mjs');
    assert.ok(json.description.startsWith(`The Standard Icon Set: ${icons.length} `));
    assert.ok(json.keywords.length);
    assert.equal(Boolean(json.repository), Boolean(REPOSITORY));
    for (const file of json.files) assert.ok(existsSync(join(pkg, file)), file);
  });

  test('the package holds only what it should, and never a font', () => {
    assert.deepEqual(readdirSync(pkg).sort(), ['LICENSE', 'README.md', 'cli.mjs', 'icon.mjs', 'icons.json', 'package.json', 'renames.json']);
  });

  test('the README has its numbers filled in and matches the sizes', () => {
    const text = readFileSync(join(pkg, 'README.md'), 'utf8');
    assert.doesNotMatch(text, /\{\{/);
    assert.ok(text.includes(`${icons.length} free SVG line icons`));
    assert.ok(text.includes(SIZES.slice(0, -1).join(', ') + ' and ' + SIZES.at(-1)));
  });
});

describe('cli', () => {
  test('--version and -v print the version', () => {
    for (const args of [['--version'], ['-v'], ['list', '--version']]) {
      const run = cli(args);
      assert.equal(run.code, 0);
      assert.equal(run.out.trim(), VERSION);
    }
    assert.deepEqual(cli(['--version', '--json']).json, { version: VERSION });
  });

  test('help lists every command', () => {
    const run = cli(['--help']);
    assert.equal(run.code, 0);
    for (const word of ['add', 'get', 'search', 'list', '--force', '--dry-run', '--version']) assert.ok(run.out.includes(word), word);
    assert.equal(cli([]).code, 0);
  });

  test('get prints one SVG, and JSON says what it is', () => {
    const run = cli(['get', 'arrow-up', '--size', '24']);
    assert.equal(run.code, 0);
    assert.equal(run.out.trim(), toSvg(plain, 24));
    assert.deepEqual(cli(['get', 'arrow-up', '--size=20', '--weight', 'semibold', '--json']).json, { name: 'arrow-up', size: 20, weight: 'semibold', svg: toSvg(plain, 20, 'semibold') });
    assert.equal(cli(['get', 'arrow-up', '--json']).json.weight, 'regular');
  });

  test('an alias finds its icon', () => {
    const run = cli(['get', aliased.aliases[0], '--json']);
    assert.equal(run.json.name, aliased.name);
  });

  test('an unknown name exits 1 and suggests real names', () => {
    const run = cli(['get', 'arow-up']);
    assert.equal(run.code, 1);
    assert.match(run.err, /Did you mean arrow-up/);
    const json = cli(['get', 'arow-up', '--json']);
    assert.equal(json.code, 1);
    assert.equal(json.json.suggestions[0], 'arrow-up');
    const names = new Set(icons.map((icon) => icon.name));
    for (const name of json.json.suggestions) assert.ok(names.has(name));
  });

  test('an alias misspelled suggests the icon it belongs to', () => {
    const alias = aliased.aliases.find((a) => a.length > 6) ?? aliased.aliases[0];
    const typo = alias.slice(0, -1) + (alias.endsWith('x') ? 'y' : 'x');
    if (icons.some((icon) => icon.name === typo || icon.aliases.includes(typo))) return;
    assert.ok(cli(['get', typo, '--json']).json.suggestions.includes(aliased.name));
  });

  test('bad sizes, weights, options and commands exit 1', () => {
    for (const args of [['get', 'arrow-up', '--size', '17'], ['get', 'arrow-up', '--weight', 'heavy'], ['get', 'arrow-up', '--weight', 'bold', '--size', '16'], ['get', 'arrow-up', '--nope'], ['get', 'arrow-up', '--size'], ['nope'], ['get'], ['add'], ['search']]) {
      const run = cli(args);
      assert.equal(run.code, 1, args.join(' '));
      assert.ok(run.err.trim(), args.join(' '));
    }
  });

  test('a heavy weight without --size uses its smallest size', () => {
    assert.equal(cli(['get', 'arrow-up', '--weight', 'bold', '--json']).json.size, MIN_SIZE.bold);
  });

  test('search ranks by meaning, and an empty JSON result is not an error', () => {
    const run = cli(['search', 'arrow', 'up']);
    assert.equal(run.code, 0);
    assert.equal(run.out.split('\n')[0].split(/\s+/)[0], 'arrow-up');
    const json = cli(['search', 'arrow', '--json']);
    assert.ok(json.json.every((row) => row.name && row.category && Array.isArray(row.keywords) && Array.isArray(row.weights) && 'looks' in row && 'use' in row));
    const none = cli(['search', 'zzzzqqq', '--json']);
    assert.deepEqual([none.code, none.json], [0, []]);
    assert.equal(cli(['search', 'zzzzqqq']).code, 1);
  });

  test('search shows what an icon looks like, and finds it by its description', () => {
    const described = icons.map(packEntry).find((icon) => icon.looks);
    if (!described) return;
    const run = cli(['search', described.name]);
    assert.ok(run.out.split('\n').some((line) => line.startsWith(described.name) && line.includes(described.looks)));
    const word = described.looks.toLowerCase().split(/[^a-z]+/).find((w) => w.length > 5 && !described.name.includes(w) && !described.keywords.some((k) => k.includes(w)));
    if (word) assert.ok(cli(['search', word, '--json']).json.some((row) => row.name === described.name));
  });

  test('search matches whole words or their starts, and falls back to the most words matched', () => {
    const names = (q) => cli(['search', ...q.split(' '), '--json']).json.map((row) => row.name);
    assert.ok(!names('city').includes('opacity'), 'city must not match the middle of opacity');
    if (icons.some((i) => i.name === 'person')) {
      assert.equal(names('user')[0], 'person');
      assert.equal(names('person zzzzportrait')[0], 'person');
    }
  });

  test('from finds our icon for another set\'s names, as that set writes them', () => {
    const matched = icons.map(packEntry).find((icon) => icon.matches?.lucide && icon.matches.lucide !== icon.name);
    if (!matched) return;
    const pascal = matched.matches.lucide.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
    for (const asked of [matched.matches.lucide, pascal, `${pascal}Icon`]) {
      const [row] = cli(['from', 'lucide', asked, '--json']).json;
      assert.ok(row.name === matched.name || row.alternatives.includes(matched.name), `${asked} → ${row.name}`);
    }
    const [none] = cli(['from', 'lucide', 'zzzz-qqqq', '--json']).json;
    assert.equal(none.name, null);
    assert.equal(cli(['from', 'nosuchset', 'x']).code, 1);
    assert.equal(cli(['from', 'lucide']).code, 1);
  });

  test('list prints every name, or only those in a weight', () => {
    assert.equal(cli(['list']).out.trim().split('\n').length, icons.length);
    const heavy = cli(['list', '--weight', 'semibold', '--json']).json;
    assert.equal(heavy.length, icons.filter(hasWeights).length);
    const mixed = cli(['list', '--weight', 'semibold', '--json'], { from: withFilled }).json;
    assert.ok(!mixed.includes(filled.name) && mixed.includes('arrow-up'));
  });

  test('an icon in one weight refuses a heavier one', () => {
    const run = cli(['get', filled.name, '--weight', 'semibold', '--size', '18'], { from: withFilled });
    assert.equal(run.code, 1);
    assert.match(run.err, /one weight, regular/);
    assert.equal(cli(['get', filled.name], { from: withFilled }).code, 0);
  });
});

describe('cli add', () => {
  test('writes files into ./icons, under the real name for an alias', () => {
    const run = cli(['add', 'arrow-up', aliased.aliases[0]]);
    assert.equal(run.code, 0);
    assert.equal(readFileSync(join(run.dir, 'icons', 'arrow-up.svg'), 'utf8'), toSvg(plain, 18) + '\n');
    assert.ok(existsSync(join(run.dir, 'icons', `${aliased.name}.svg`)));
    assert.deepEqual(run.out.trim().split('\n'), [join('icons', 'arrow-up.svg'), join('icons', `${aliased.name}.svg`)]);
  });

  test('--out takes nested folders', () => {
    const run = cli(['add', 'check', '--out', join('src', 'assets', 'icons'), '--size', '24']);
    assert.equal(run.code, 0);
    assert.ok(existsSync(join(run.dir, 'src', 'assets', 'icons', 'check.svg')));
  });

  test('--json reports every file and what happened to it', () => {
    const first = cli(['add', 'check', 'arrow-up', 'check', '--json']);
    assert.equal(first.code, 0);
    assert.equal(first.json.dryRun, false);
    assert.deepEqual(first.json.files.map((f) => [f.name, f.action, f.written, f.path]), [['check', 'create', true, join('icons', 'check.svg')], ['arrow-up', 'create', true, join('icons', 'arrow-up.svg')]]);
    const again = cli(['add', 'check', '--json'], { cwd: first.dir });
    assert.deepEqual(again.json.files.map((f) => [f.action, f.written]), [['unchanged', false]]);
  });

  test('refuses to replace a file that differs, and writes nothing', () => {
    const first = cli(['add', 'check']);
    const path = join(first.dir, 'icons', 'check.svg');
    writeFileSync(path, 'mine');
    const run = cli(['add', 'arrow-up', 'check'], { cwd: first.dir });
    assert.equal(run.code, 1);
    assert.match(run.err, /--force/);
    assert.equal(readFileSync(path, 'utf8'), 'mine');
    assert.ok(!existsSync(join(first.dir, 'icons', 'arrow-up.svg')), 'a refused batch writes nothing');
    const json = cli(['add', 'check', '--json'], { cwd: first.dir });
    assert.equal(json.code, 1);
    assert.equal(json.json.files[0].action, 'conflict');
  });

  test('--force overwrites', () => {
    const first = cli(['add', 'check']);
    const path = join(first.dir, 'icons', 'check.svg');
    writeFileSync(path, 'mine');
    const run = cli(['add', 'check', '--force', '--json'], { cwd: first.dir });
    assert.equal(run.code, 0);
    assert.equal(run.json.files[0].action, 'overwrite');
    assert.equal(readFileSync(path, 'utf8'), toSvg(icons.find((i) => i.name === 'check')) + '\n');
  });

  test('--dry-run writes nothing', () => {
    const run = cli(['add', 'check', '--dry-run']);
    assert.equal(run.code, 0);
    assert.match(run.out, /would create/);
    assert.ok(!existsSync(join(run.dir, 'icons')));
    const json = cli(['add', 'check', '--dry-run', '--json']);
    assert.deepEqual([json.json.dryRun, json.json.files[0].written], [true, false]);
  });

  test('an icon in one weight stops a heavier batch', () => {
    const run = cli(['add', 'arrow-up', filled.name, '--weight', 'semibold', '--size', '18'], { from: withFilled });
    assert.match(run.err, /one weight, regular/);
    assert.equal(run.code, 1);
    assert.ok(!existsSync(join(run.dir, 'icons')));
  });
});

// `npx skills add Standard-Icon/standardicon` reads this committed copy. Run `npm run generate` to refresh it.
test('the committed skill matches what generate.mjs writes', () => {
  const committed = join(import.meta.dirname, '..', 'skills', 'standard-icon', 'SKILL.md');
  assert.ok(existsSync(committed), 'skills/standard-icon/SKILL.md is missing. Run npm run generate.');
  assert.equal(readFileSync(committed, 'utf8'), skillMd(), 'skills/standard-icon/SKILL.md is out of date. Run npm run generate.');
});

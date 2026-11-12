// node --test scripts/changelog.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { bumpFor, diffIcons, fromReport, merge, parse, render, sectionsOf, writeUnreleased } from './changelog.mjs';

const dir = mkdtempSync(join(tmpdir(), 'changelog-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const icon = (name, body = '<path d="M1 1L2 2"/>', extra = {}) => ({ name, category: 'actions', aliases: [], body, ...extra });
const none = { added: [], removed: [], renamed: [], redrawn: [], moved: [] };

test('diffIcons finds added, removed, redrawn and moved icons, and ignores tiny shifts', () => {
  const before = [icon('a'), icon('b'), icon('c'), icon('d')];
  const after = [icon('a', '<path d="M1.001 1L2 2"/>'), icon('b', '<path d="M1 1L5 5"/>'), { ...icon('c'), category: 'files' }, icon('e')];
  assert.deepEqual(diffIcons(before, after), { added: ['e'], removed: ['d'], renamed: [], redrawn: ['b'], moved: ['c (actions → files)'] });
});

test('a removed name kept as an alias is a rename', () => {
  const changes = diffIcons([icon('old')], [icon('new', undefined, { aliases: ['old'] })]);
  assert.deepEqual([changes.added, changes.removed, changes.renamed], [[], [], [['old', 'new']]]);
});

test('fromReport pairs the renames the records saw', () => {
  const report = { added: ['new', 'fresh'], removed: ['old'], redrawn: [], moved: [], records: { renamed: ['old → new', 'elsewhere → unrelated'] } };
  assert.deepEqual(fromReport(report), { added: ['fresh'], removed: [], renamed: [['old', 'new']], redrawn: [], moved: [] });
});

test('merge folds several syncs into one release', () => {
  const first = { ...none, added: ['a', 'b'], removed: ['x'], renamed: [['p', 'q']], redrawn: ['r'] };
  const second = { ...none, added: ['x'], removed: ['b'], renamed: [['a', 'a2'], ['q', 'q2']], redrawn: ['a2', 's'] };
  assert.deepEqual(merge(first, second), { added: ['a2'], removed: [], renamed: [['p', 'q2']], redrawn: ['r', 's'], moved: [] });
});

test('render and parse round-trip', () => {
  const changes = { added: ['a', 'b'], removed: ['c'], renamed: [['d', 'e']], redrawn: ['f'], moved: ['g (actions → files)'] };
  assert.deepEqual(parse(render(changes)), changes);
  assert.equal(render(none), 'No icon changes.');
});

test('the bump follows the versioning rules', () => {
  assert.equal(bumpFor({ ...none, removed: ['a'] }), 'major');
  assert.equal(bumpFor({ ...none, renamed: [['a', 'b']] }), 'major');
  assert.equal(bumpFor({ ...none, added: ['a'] }), 'minor');
  assert.equal(bumpFor({ ...none, redrawn: ['a'] }), 'patch');
});

test('writeUnreleased creates the file, then merges into the same section', () => {
  const file = join(dir, 'CHANGELOG.md');
  writeUnreleased({ ...none, added: ['a'] }, file);
  writeUnreleased({ ...none, added: ['b'], redrawn: ['a'] }, file);
  const { sections } = sectionsOf(readFileSync(file, 'utf8'));
  assert.deepEqual(sections.map((s) => s.title), ['Unreleased']);
  assert.deepEqual(parse(sections[0].body).added, ['a', 'b']);
  assert.deepEqual(parse(sections[0].body).redrawn, []);
});

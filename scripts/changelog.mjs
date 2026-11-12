#!/usr/bin/env node
// Turns icon changes into changelog entries. See docs/RELEASING.md.
//
//   npm run changelog                      print what the last sync changed (.sync/report.json)
//   npm run changelog -- --since v1.0.0    print what changed since a git tag, by comparing icons/icons.json
//   npm run changelog -- --write           also merge it into the Unreleased section of CHANGELOG.md
//
// Each sync replaces .sync/report.json, so run this with --write after every sync you plan to release,
// or use --since <last release tag> once before releasing, which sees every sync at once.
// scripts/release.mjs turns Unreleased into the new version's section.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGELOG = join(ROOT, 'CHANGELOG.md');
export const UNRELEASED = 'Unreleased';

const HEADINGS = { removed: 'Removed', renamed: 'Renamed', added: 'Added', redrawn: 'Redrawn', moved: 'Moved' };
const empty = () => ({ added: [], removed: [], renamed: [], redrawn: [], moved: [] });

// ---- Collecting changes ----

// Shapes that differ by less than 0.01px are the same drawing. Mirrors the check in scripts/sync.mjs.
const NUM = /-?\d*\.?\d+(?:e-?\d+)?/g;
const drawing = (icon) => [icon.body, ...Object.values(icon.sizes ?? {})].join('|');
function sameShape(a, b) {
  const A = drawing(a), B = drawing(b);
  if (A === B) return true;
  if (A.replace(NUM, '#') !== B.replace(NUM, '#')) return false;
  const x = A.match(NUM), y = B.match(NUM);
  return x.length === y.length && x.every((v, i) => Math.abs(+v - +y[i]) < 0.01);
}

// A removed name that reappears as a new icon's alias, or that the records say was renamed, is a rename.
function pairRenames(changes, renamedHints = []) {
  const pairs = renamedHints.map((line) => line.split(' → ').map((s) => s.trim())).filter(([from, to]) => to && changes.removed.includes(from) && changes.added.includes(to));
  for (const [to, aliases] of changes.addedAliases ?? []) {
    for (const from of aliases) if (changes.removed.includes(from) && !pairs.some((p) => p[0] === from)) pairs.push([from, to]);
  }
  const from = new Set(pairs.map((p) => p[0])), to = new Set(pairs.map((p) => p[1]));
  return {
    added: changes.added.filter((n) => !to.has(n)),
    removed: changes.removed.filter((n) => !from.has(n)),
    renamed: pairs,
    redrawn: changes.redrawn,
    moved: changes.moved,
  };
}

export function diffIcons(before, after) {
  const old = new Map(before.map((i) => [i.name, i]));
  const now = new Map(after.map((i) => [i.name, i]));
  const added = after.filter((i) => !old.has(i.name));
  return pairRenames({
    added: added.map((i) => i.name),
    addedAliases: added.map((i) => [i.name, i.aliases ?? []]),
    removed: before.filter((i) => !now.has(i.name)).map((i) => i.name),
    redrawn: after.filter((i) => old.has(i.name) && !sameShape(i, old.get(i.name))).map((i) => i.name),
    moved: after.filter((i) => old.has(i.name) && old.get(i.name).category !== i.category).map((i) => `${i.name} (${old.get(i.name).category} → ${i.category})`),
  });
}

export function fromReport(report, icons = []) {
  const byName = new Map(icons.map((i) => [i.name, i]));
  return pairRenames(
    { ...report, addedAliases: report.added.map((n) => [n, byName.get(n)?.aliases ?? []]) },
    report.records?.renamed ?? [],
  );
}

// ---- Merging into Unreleased ----

// Applies newer changes on top of older ones, so several syncs read as one release.
export function merge(older, newer) {
  const out = empty();
  const rename = new Map(older.renamed.map(([from, to]) => [to, from]));
  let added = [...older.added];
  let removed = [...older.removed];
  for (const [from, to] of newer.renamed) {
    if (added.includes(from)) added = added.map((n) => (n === from ? to : n));
    else if (rename.has(from)) {
      rename.set(to, rename.get(from));
      rename.delete(from);
    } else rename.set(to, from);
  }
  for (const name of newer.added) {
    // Removed and back again within one release: to anyone upgrading, it was redrawn at most.
    if (removed.includes(name)) removed = removed.filter((n) => n !== name);
    else added.push(name);
  }
  for (const name of newer.removed) {
    if (added.includes(name)) added = added.filter((n) => n !== name);
    else if (rename.has(name)) {
      removed.push(rename.get(name));
      rename.delete(name);
    } else removed.push(name);
  }
  out.added = [...new Set(added)];
  out.removed = [...new Set(removed)];
  out.renamed = [...rename].map(([to, from]) => [from, to]).filter(([from, to]) => from !== to);
  out.redrawn = [...new Set([...older.redrawn, ...newer.redrawn])].filter((n) => !out.added.includes(n) && !out.removed.includes(n));
  const moved = new Map([...older.moved, ...newer.moved].map((line) => [line.split(' ')[0], line]));
  out.moved = [...moved.values()];
  return out;
}

// ---- Markdown ----

const item = (key, value) => (key === 'renamed' ? `- \`${value[0]}\` → \`${value[1]}\` (the old name still works until the next major version)` : key === 'moved' ? `- \`${value.split(' ')[0]}\` ${value.slice(value.indexOf(' ') + 1)}` : `- \`${value}\``);

export function render(changes) {
  const sections = Object.entries(HEADINGS)
    .filter(([key]) => changes[key].length)
    .map(([key, title]) => `### ${title}\n\n${[...changes[key]].sort((a, b) => String(a).localeCompare(String(b))).map((v) => item(key, v)).join('\n')}`);
  return sections.length ? sections.join('\n\n') : 'No icon changes.';
}

export function parse(markdown) {
  const changes = empty();
  for (const [key, title] of Object.entries(HEADINGS)) {
    const block = markdown.match(new RegExp(`### ${title}\\n\\n([\\s\\S]*?)(?=\\n### |$)`));
    if (!block) continue;
    for (const line of block[1].split('\n').filter((l) => l.startsWith('- '))) {
      const names = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (key === 'renamed') changes.renamed.push([names[0], names[1]]);
      else if (key === 'moved') changes.moved.push(`${names[0]} ${line.slice(line.indexOf('`', 3) + 2)}`);
      else changes[key].push(names[0]);
    }
  }
  return changes;
}

// What the changes mean for the version number, by the rules in docs/RELEASING.md.
export const bumpFor = (changes) => (changes.removed.length || changes.renamed.length ? 'major' : changes.added.length ? 'minor' : 'patch');

const FILE_HEAD = '# Changelog\n\nIcon changes in each release of The Standard Icon Set. Versioning rules are in docs/RELEASING.md.\n';
const SECTION = /^## (.+)$/m;

// Splits CHANGELOG.md into its head and its ## sections.
export function sectionsOf(text) {
  const start = text.search(SECTION);
  if (start < 0) return { head: text.trimEnd() + '\n', sections: [] };
  const sections = text.slice(start).split(/^(?=## )/m).map((block) => ({ title: block.match(SECTION)[1].trim(), body: block.replace(SECTION, '').trim() }));
  return { head: text.slice(0, start).trimEnd() + '\n', sections };
}
export const joinSections = ({ head, sections }) => `${head}\n${sections.map((s) => `## ${s.title}\n\n${s.body}\n`).join('\n')}`;

export function writeUnreleased(changes, file = CHANGELOG) {
  const doc = sectionsOf(existsSync(file) ? readFileSync(file, 'utf8') : FILE_HEAD);
  const current = doc.sections.find((s) => s.title === UNRELEASED);
  const merged = current ? merge(parse(current.body), changes) : changes;
  const section = { title: UNRELEASED, body: render(merged) };
  doc.sections = current ? doc.sections.map((s) => (s === current ? section : s)) : [section, ...doc.sections];
  writeFileSync(file, joinSections(doc));
  return merged;
}

// ---- Command line ----

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const since = args[args.indexOf('--since') + 1];
  const readIcons = (text) => JSON.parse(text);
  const current = readIcons(readFileSync(join(ROOT, 'icons/icons.json'), 'utf8'));
  let changes;
  if (args.includes('--since')) {
    if (!since) throw new Error('--since needs a git ref, such as v1.0.0.');
    changes = diffIcons(readIcons(execFileSync('git', ['show', `${since}:icons/icons.json`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })), current);
  } else {
    const path = join(ROOT, '.sync/report.json');
    if (!existsSync(path)) {
      console.error('No sync report yet. Run npm run sync, or pass --since <git ref>.');
      process.exit(1);
    }
    const report = JSON.parse(readFileSync(path, 'utf8'));
    console.error(`From the sync at ${report.at}.`);
    changes = fromReport(report, current);
  }
  const shown = args.includes('--write') ? writeUnreleased(changes) : changes;
  console.log(render(shown));
  console.error(`\nThese changes call for a ${bumpFor(shown)} version.${args.includes('--write') ? ' Merged into the Unreleased section of CHANGELOG.md.' : ''}`);
}

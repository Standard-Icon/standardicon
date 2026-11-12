// Every drawing an icon has had, one file per icon in icons/history/<name>.json.
// The sync adds a version whenever an icon's shape changes in Figma, released or not,
// so a redraw never loses what it replaced. `npm run history -- --backfill` fills in
// the versions saved in git before this existed.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORY = join(ROOT, 'icons/history');
const fileFor = (name) => join(HISTORY, `${name}.json`);

// Ignore differences under 0.01px, which come from icons moving on the canvas.
const NUM = /-?\d*\.?\d+(?:e-?\d+)?/g;
const shapeOf = (icon) => [icon.body, ...Object.values(icon.sizes ?? {})].join('|');
export function sameShape(a, b) {
  const A = shapeOf(a), B = shapeOf(b);
  if (A === B) return true;
  if (A.replace(NUM, '#') !== B.replace(NUM, '#')) return false;
  const x = A.match(NUM) ?? [], y = B.match(NUM) ?? [];
  return x.length === y.length && x.every((v, i) => Math.abs(+v - +y[i]) < 0.01);
}

export function historyOf(name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !existsSync(fileFor(name))) return [];
  return JSON.parse(readFileSync(fileFor(name), 'utf8')).versions;
}

const save = (name, versions) => {
  mkdirSync(HISTORY, { recursive: true });
  writeFileSync(fileFor(name), JSON.stringify({ name, versions }, null, 1) + '\n');
};

const versionOf = (icon, at, source, released) => ({
  at,
  source,
  released,
  body: icon.body,
  ...(icon.sizes ? { sizes: icon.sizes } : {}),
  ...(icon.solidParts ? { solidParts: icon.solidParts } : {}),
});

// Adds a version for each icon whose shape differs from its latest one. A version that was a
// draft and has since shipped unchanged is marked released rather than added again.
export function record(icons, { at = new Date().toISOString(), source = 'figma', released = () => false } = {}) {
  const changed = [];
  for (const icon of icons) {
    const versions = historyOf(icon.name);
    const last = versions.at(-1);
    const shipped = released(icon);
    if (last && sameShape(last, icon)) {
      if (shipped && !last.released) {
        last.released = true;
        save(icon.name, versions);
      }
      continue;
    }
    versions.push(versionOf(icon, at, source, shipped));
    save(icon.name, versions);
    changed.push(icon.name);
  }
  return changed;
}

// Rebuilds every file from a list of dated snapshots, oldest first. Existing versions are kept and merged in by date.
export function rebuild(snapshots) {
  const byName = new Map();
  for (const name of existsSync(HISTORY) ? readdirSync(HISTORY).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []) {
    byName.set(name, historyOf(name));
  }
  for (const { at, source, released, icons } of snapshots) {
    for (const icon of icons) {
      const list = byName.get(icon.name) ?? [];
      list.push(versionOf(icon, at, source, released));
      byName.set(icon.name, list);
    }
  }
  let count = 0;
  for (const [name, list] of byName) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    const kept = [];
    for (const version of list) {
      const last = kept.at(-1);
      if (last && sameShape(last, version)) {
        last.released ||= version.released;
        continue;
      }
      kept.push(version);
    }
    save(name, kept);
    count += kept.length;
  }
  return { icons: byName.size, versions: count };
}

export function renameHistory(from, to) {
  if (!existsSync(fileFor(from))) return;
  const versions = [...historyOf(to), ...historyOf(from)].sort((a, b) => a.at.localeCompare(b.at));
  if (from === to) return;
  save(to, versions);
  unlinkSync(fileFor(from)); // its versions now live under the new name
}

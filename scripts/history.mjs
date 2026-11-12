#!/usr/bin/env node
// Icon drawing history.
//   npm run history -- <name>       list an icon's versions
//   npm run history -- --backfill   add the versions saved before the history existed: every
//                                   commit of icons/icons.json, then the current files.
// The sync adds new versions on its own, so the backfill is only needed once.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyOf, rebuild } from '../lib/history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const args = process.argv.slice(2);

if (args.includes('--backfill')) {
  const snapshots = [];
  const commits = git('log', '--reverse', '--format=%H %cI', '--', 'icons/icons.json').trim().split('\n').filter(Boolean);
  for (const row of commits) {
    const [hash, at] = row.split(' ');
    try {
      const icons = JSON.parse(git('show', `${hash}:icons/icons.json`));
      if (Array.isArray(icons)) snapshots.push({ at, source: `git ${hash.slice(0, 7)}`, released: true, icons });
    } catch {
      console.log(`  Skipped ${hash.slice(0, 7)}: not readable`);
    }
  }
  // Uncommitted work: the released list, then everything in Figma including drafts.
  for (const [file, released] of [['icons/icons.json', true], ['.sync/all-icons.json', false]]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    snapshots.push({ at: statSync(path).mtime.toISOString(), source: file.startsWith('.sync') ? 'figma' : 'working copy', released, icons: JSON.parse(readFileSync(path, 'utf8')) });
  }
  const { icons, versions } = rebuild(snapshots);
  console.log(`Read ${snapshots.length} snapshots. History now has ${versions} versions across ${icons} icons.`);
} else if (args[0]) {
  const versions = historyOf(args[0]);
  if (!versions.length) console.log(`No history for ${args[0]}.`);
  for (const [i, v] of versions.entries()) console.log(`${i + 1}. ${v.at.slice(0, 16).replace('T', ' ')}  ${v.source}${v.released ? '  released' : ''}`);
} else {
  console.log('Usage: npm run history -- <name> | --backfill');
}

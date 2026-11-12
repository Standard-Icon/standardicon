#!/usr/bin/env node
// Ships the icons: everything pink in Figma goes live on standardicon.com, and on the preview site first.
//   npm run ship               sync, test the deploy build, commit the icon data, publish the preview, push live
//   npm run ship -- --dry-run  sync and test the deploy build only. Nothing is committed or published.
//   npm run ship -- --no-sync  ship what's already synced, without reading Figma again
//
// Only the icon data is committed (icons.json, records, issues and the drawing history). Any other
// uncommitted work stays out, so the deploy builds the last commit's code with the new icons. That's what the
// test build checks, in a clean copy, before anything leaves this Mac. Pushing to main deploys the site.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DATA = ['icons/icons.json', 'icons/records', 'icons/issues', 'icons/history'];
const DRY = process.argv.includes('--dry-run');
const SYNC = !process.argv.includes('--no-sync');
const started = Date.now();

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const step = (text) => console.log(`\n▸ ${text}`);
function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n✗ ${[command, ...args].join(' ')} failed. Nothing was published.`);
    process.exit(result.status ?? 1);
  }
}

if (git('branch', '--show-current') !== 'main') {
  console.error('Ship from main, which is what deploys.');
  process.exit(1);
}

if (SYNC) {
  step('Syncing every pink icon from Figma');
  run('npm', ['run', 'sync']);
}

// The deploy builds the last commit plus this commit's icon data. Build exactly that, in a clean copy.
step('Testing the deploy build: the last commit with the new icons');
const copy = mkdtempSync(join(tmpdir(), 'ship-'));
try {
  run('git', ['worktree', 'add', '--detach', '--quiet', copy, 'HEAD']);
  for (const path of DATA) {
    if (!existsSync(join(ROOT, path))) continue;
    rmSync(join(copy, path), { recursive: true, force: true });
    cpSync(join(ROOT, path), join(copy, path), { recursive: true });
  }
  // Next.js won't build through a linked node_modules, so clone it. On APFS a clone is instant and takes no space.
  execFileSync('cp', ['-cR', join(ROOT, 'node_modules'), join(copy, 'node_modules')]);
  run('npm', ['run', 'build'], copy);
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', copy], { cwd: ROOT });
  rmSync(copy, { recursive: true, force: true });
}

const changed = git('status', '--porcelain', '--', ...DATA);
const icons = JSON.parse(execFileSync('node', ['-e', 'process.stdout.write(String(require("./icons/icons.json").length))'], { cwd: ROOT, encoding: 'utf8' }));
if (DRY) {
  console.log(`\n✓ Dry run: the deploy build works with ${icons} icons. ${changed ? `${changed.split('\n').length} icon data files would be committed.` : 'Nothing new to commit.'} Nothing was published.`);
  process.exit(0);
}

if (changed) {
  step('Committing the icon data');
  run('git', ['add', '--', ...DATA]);
  const before = (() => { try { return JSON.parse(git('show', 'HEAD:icons/icons.json')).length; } catch { return 0; } })();
  const diff = icons - before;
  run('git', ['commit', '--quiet', '-m', `Ship ${icons} icons (${diff >= 0 ? '+' : ''}${diff}) from Figma`, '--', ...DATA]);
} else {
  console.log('\nNo icon changes since the last commit.');
}

const ahead = Number(git('rev-list', '--count', '@{u}..HEAD'));
if (!ahead) {
  console.log(`\n✓ Already live: standardicon.com has these ${icons} icons. Took ${Math.round((Date.now() - started) / 1000)}s.`);
  process.exit(0);
}

step('Publishing the preview');
run('npm', ['run', 'preview']);

step('Pushing live');
run('git', ['push', '--quiet', 'origin', 'main']);

step('Rebuilding the local site to match');
run('npm', ['run', 'build']);

console.log(`\n✓ Shipped ${icons} icons. standardicon.com updates in a minute or three, and the preview is up now. Took ${Math.round((Date.now() - started) / 1000)}s.`);

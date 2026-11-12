#!/usr/bin/env node
// Publishes the public copy of this repo to github.com/Standard-Icon/standardicon.
//
//   npm run public-repo              copy the last commit (minus the private paths) and push it
//   npm run public-repo -- --dry-run show what would be copied and left out, without pushing
//
// This repo can't simply be made public: its history holds the licensed Polymath fonts and other private
// files, and anyone could recover them from old commits. So the public repo has its own history. Each run
// copies the files of HEAD here, minus PRIVATE, into a clone of the public repo and commits them as one
// change. Only committed files are copied, so uncommitted work never leaks.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = 'https://github.com/Standard-Icon/standardicon.git';
const WORK = join(ROOT, '.public-repo');
const dryRun = process.argv.includes('--dry-run');

// Never public. Paths are prefixes of tracked files.
export const PRIVATE = [
  'app/fonts/', // Polymath is licensed for standardicon.com only
  'workbench/fetch-iconic.mjs', // Iconic is a paid set, compared against privately
  'workbench/sets/iconic.json',
  'workbench/sets/sf.json', // SF Symbols' license doesn't allow redistributing them
  'workbench/sf-render.swift',
  'LAUNCH.html', // launch planning
  'launch-progress.json',
  'icons/issues/', // design discussions
];
const isPrivate = (file) => PRIVATE.some((p) => file === p || file.startsWith(p));

const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const sha = git(['rev-parse', '--short', 'HEAD']);
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const files = tracked.filter((f) => !isPrivate(f));
const left = tracked.filter(isPrivate);

// Nothing licensed may slip through under another path.
const fonts = files.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));
if (fonts.length) throw new Error(`Font files would be published: ${fonts.join(', ')}`);

console.log(`HEAD ${sha}: ${files.length} files go public, ${left.length} stay private.`);
for (const p of PRIVATE) console.log(`  private: ${p} (${left.filter((f) => f === p || f.startsWith(p)).length})`);
if (dryRun) process.exit(0);

// A clone of the public repo, kept between runs in .public-repo (git ignores it).
if (!existsSync(join(WORK, '.git'))) {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  try {
    git(['clone', '--quiet', REMOTE, WORK]);
  } catch {
    git(['init', '--quiet', '-b', 'main'], WORK);
    git(['remote', 'add', 'origin', REMOTE], WORK);
  }
}

// Replace everything but .git with HEAD's public files, read from git so the working copy doesn't matter.
for (const entry of readdirSync(WORK)) if (entry !== '.git') rmSync(join(WORK, entry), { recursive: true, force: true });
for (const file of files) {
  const out = join(WORK, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));
}

// The site's typeface isn't here, so say so where people look first.
const readme = join(WORK, 'README.md');
writeFileSync(readme, readFileSync(readme, 'utf8').replace(/\n/, `\n\n> This is the public copy of the Standard Icon source. The icons, the \`standardicon\` CLI, \`@standardicon/react\` and \`@standardicon/mcp\` all build from it. The website's typeface, Polymath, is licensed and isn't included, so the site itself (\`npm run build\`) needs those fonts in \`app/fonts\`.\n`));

git(['add', '-A'], WORK);
if (!git(['status', '--porcelain'], WORK)) {
  console.log('The public repo already matches. Nothing to push.');
  process.exit(0);
}
git(['-c', 'user.name=Morgan Knutson', '-c', 'user.email=m@rgan.co', 'commit', '--quiet', '-m', `Sync from ${sha}`], WORK);
git(['push', '--quiet', 'origin', 'HEAD:main'], WORK);
console.log(`Pushed ${sha} to ${REMOTE.replace(/\.git$/, '')}.`);

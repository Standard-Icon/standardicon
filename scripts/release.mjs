#!/usr/bin/env node
// Sets one version number across everything that carries one. See docs/RELEASING.md.
//
//   npm run release -- 1.2.0             set the version and date the changelog
//   npm run release -- 1.2.0 --dry-run   show what would change, without writing
//
// The version lives in the root package.json. Everything else reads it from there at build time: the CLI
// package and its README, /icons.json on the site, and the tarball. This script also updates the lockfile,
// any package under packages/ (such as a future @standardicon/react) and its dependencies on the others,
// and turns CHANGELOG.md's Unreleased section into this version's. It doesn't commit, tag, or publish.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGELOG, UNRELEASED, joinSections, sectionsOf } from './changelog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
if (!version || !SEMVER.test(version)) {
  console.error('Give the new version, such as: npm run release -- 1.2.0\nA prerelease looks like 1.0.0-rc.1. Rules for choosing one are in docs/RELEASING.md.');
  process.exit(1);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const changes = [];
const save = (path, content) => {
  changes.push(relative(ROOT, path));
  if (!dryRun) writeFileSync(path, content);
};
const saveJson = (path, json) => save(path, JSON.stringify(json, null, 2) + '\n');

const rootPkg = join(ROOT, 'package.json');
const root = readJson(rootPkg);
const previous = root.version;
if (previous === version) {
  console.error(`The version is already ${version}.`);
  process.exit(1);
}
saveJson(rootPkg, { ...root, version });

// The lockfile repeats the root version.
const lockPath = join(ROOT, 'package-lock.json');
if (existsSync(lockPath)) {
  const lock = readJson(lockPath);
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  saveJson(lockPath, lock);
}

// Packages published alongside the CLI. They move together, and depend on each other at the same version.
const packagesDir = join(ROOT, 'packages');
const ours = (name) => name === 'standardicon' || name.startsWith('@standardicon/');
if (existsSync(packagesDir)) {
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    const path = join(packagesDir, entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(path)) continue;
    const pkg = readJson(path);
    pkg.version = version;
    for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
      for (const dep of Object.keys(pkg[field] ?? {})) if (ours(dep)) pkg[field][dep] = `^${version}`;
    }
    saveJson(path, pkg);
    // An MCP Registry entry beside the package carries the version too, once for itself and once per package.
    const server = join(packagesDir, entry.name, 'server.json');
    if (existsSync(server)) {
      const entryJson = readJson(server);
      entryJson.version = version;
      for (const listed of entryJson.packages ?? []) if (ours(listed.identifier)) listed.version = version;
      saveJson(server, entryJson);
    }
  }
}

// CHANGELOG.md: Unreleased becomes this version, dated today.
if (existsSync(CHANGELOG)) {
  const doc = sectionsOf(readFileSync(CHANGELOG, 'utf8'));
  const unreleased = doc.sections.find((s) => s.title === UNRELEASED);
  if (unreleased) {
    unreleased.title = `${version} (${new Date().toISOString().slice(0, 10)})`;
    save(CHANGELOG, joinSections(doc));
  } else console.warn('CHANGELOG.md has no Unreleased section. Run npm run changelog -- --since <last tag> --write first if icons changed.');
} else console.warn('No CHANGELOG.md yet. Run npm run changelog -- --write to start one.');

console.log(`${dryRun ? 'Would change' : 'Changed'} ${previous} → ${version} in:\n${changes.map((c) => `  ${c}`).join('\n')}`);
if (!dryRun) {
  console.log(`
Next:
  npm test && npm run build
  git commit -am "Release ${version}"
  git tag v${version}
  git push && git push origin v${version}     the release workflow publishes on the tag`);
}

#!/usr/bin/env node
// Downloads the open comparison sets into .workbench/sets/<id>/, one plain name.svg per icon, which git ignores.
// They're for comparing in the workbench only: never ship them or trace them.
// Run with `npm run workbench:sets` (or `-- octicons tabler` for some), then restart the workbench.
//
// Each set comes from its published npm package (or, for Radix, its GitHub repo), unpacked into an empty
// temporary folder. Only SVG files are read from it; nothing in it is run.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.workbench/sets');

// from: npm package name, or a tarball URL. folders: where its SVGs are inside, in order; later ones win.
// pick: turns a file name into the icon's name, or null to skip it.
const plain = (file) => file.replace(/\.svg$/, '');
const SOURCES = {
  octicons: { from: '@primer/octicons', folders: ['package/build/svg'], pick: (f) => f.match(/^(.+)-16\.svg$/)?.[1] ?? null },
  fluent: { from: '@fluentui/svg-icons', folders: ['package/icons'], pick: (f) => f.match(/^(.+)_16_regular\.svg$/)?.[1] ?? null },
  // Carbon draws most icons once on a 32 grid and redraws a few at 16; the 16s win where both exist.
  carbon: { from: '@carbon/icons', folders: ['package/svg/32', 'package/svg/16'], pick: plain },
  radix: { from: 'https://codeload.github.com/radix-ui/icons/tar.gz/refs/heads/main', folders: ['icons-main/packages/radix-icons/icons'], pick: plain },
  heroicons: { from: 'heroicons', folders: ['package/16/solid'], pick: plain },
  phosphor: { from: '@phosphor-icons/core', folders: ['package/assets/regular'], pick: plain },
  material: { from: '@material-symbols/svg-400', folders: ['package/outlined'], pick: (f) => (f.endsWith('-fill.svg') ? null : plain(f)) },
  tabler: { from: '@tabler/icons', folders: ['package/icons/outline'], pick: plain },
};

// Names as the workbench serves them: lowercase, words joined by single hyphens.
const tidy = (name) => name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const id of wanted) if (!SOURCES[id]) throw new Error(`No set called "${id}". Sets: ${Object.keys(SOURCES).join(', ')}`);

for (const [id, source] of Object.entries(SOURCES)) {
  if (wanted.length && !wanted.includes(id)) continue;
  const work = mkdtempSync(join(tmpdir(), `wb-${id}-`));
  try {
    let tarball;
    if (source.from.startsWith('https://')) {
      tarball = join(work, 'source.tgz');
      execFileSync('curl', ['-sSfL', '-o', tarball, source.from]);
    } else {
      const packed = execFileSync('npm', ['pack', source.from, '--silent', '--pack-destination', work], { encoding: 'utf8' }).trim().split('\n').pop();
      tarball = join(work, packed);
    }
    const unpacked = join(work, 'files');
    mkdirSync(unpacked);
    execFileSync('tar', ['-xzf', tarball, '-C', unpacked, ...source.folders]);

    const dir = join(OUT, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const names = new Set();
    for (const folder of source.folders) {
      const from = join(unpacked, folder);
      if (!existsSync(from)) continue;
      for (const file of readdirSync(from)) {
        if (!file.endsWith('.svg')) continue;
        const raw = source.pick(file);
        if (!raw) continue;
        const name = tidy(raw);
        if (!name) continue;
        copyFileSync(join(from, file), join(dir, `${name}.svg`));
        names.add(name);
      }
    }
    writeFileSync(join(dir, '.source'), `${source.from}\n`);
    console.log(`${id}: ${names.size} icons`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
console.log('Restart the workbench to pick them up.');

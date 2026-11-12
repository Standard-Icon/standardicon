// node scripts/search-eval.mjs   (npm run search-eval)
// Measures how often the CLI's search finds the right icon for a natural request. It stages the CLI
// package, runs `search <words> --json` for each request in search-eval.json, and prints the top-1
// and top-3 hit rates plus every miss. It's a measurement, not a test: it always exits 0.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagePackage } from '../cli/package.mjs';
import { icons } from '../lib/site.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'search-eval.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'standardicon-search-eval-'));

try {
  const pkg = stagePackage(join(work, 'pkg'), icons);
  const names = (result) => (Array.isArray(result) ? result : (result.results ?? result.icons ?? [])).map((r) => (typeof r === 'string' ? r : r.name));
  let top1 = 0;
  let top3 = 0;
  const misses = [];

  for (const { query, expect } of cases) {
    const run = spawnSync(process.execPath, [join(pkg, 'cli.mjs'), 'search', ...query.split(/\s+/), '--json'], { cwd: work, encoding: 'utf8' });
    let found = [];
    try { found = names(JSON.parse(run.stdout)); } catch { /* no results, or an error: counts as a miss */ }
    if (expect.includes(found[0])) top1++;
    if (found.slice(0, 3).some((name) => expect.includes(name))) top3++;
    else misses.push({ query, expect, found: found.slice(0, 5) });
  }

  const pct = (n) => `${((n / cases.length) * 100).toFixed(1)}%`;
  console.log(`${cases.length} requests`);
  console.log(`top-1: ${top1} (${pct(top1)})`);
  console.log(`top-3: ${top3} (${pct(top3)})`);
  if (misses.length) console.log(`\nMissed the top 3 (${misses.length}):`);
  for (const m of misses) console.log(`  "${m.query}"  expected ${m.expect.join(' | ')}\n    got: ${m.found.join(', ') || '(nothing)'}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

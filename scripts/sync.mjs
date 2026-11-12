#!/usr/bin/env node
// Pulls every icon marked ready in Figma into icons/icons.json, then reports what changed.
//
//   npm run sync              sync, audit, and write a review page
//   npm run sync -- --build   also build the site
//   npm run sync -- --include 'file-*'   also import these icons, whatever their border says
//   npm run sync -- --changed      only export what changed in Figma since the last sync
//   npm run sync -- --only tag,tag-plus-overlay   only these icons, including new ones. Their variants wait for a full sync.
//
// "Ready" means a component set with a solid 4px #ff4fd8 border. Categories are the top-level frames on the
// first page that contain a "<name> icons" group. Badge icons (a Body instance under an Overlay badge with a Cutout) are rebuilt from
// their parent's strokes by the importer.
//
// The Figma token comes from FIGMA_TOKEN, or on macOS from the Keychain:
//   security add-generic-password -U -s standardicon-figma -a figma -w <token>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { allRecords, reconcile } from '../lib/records.mjs';
import { historyOf, record as recordHistory, renameHistory, sameShape } from '../lib/history.mjs';
import { audit } from './audit.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE_KEY = '5OZ0QO2xXZJH2OYmTagAW5';
const API = 'https://api.figma.com/v1';
const WORK = join(ROOT, '.sync');
const PINK = '#ff4fd8';
// Only the 16px master is drawn in Figma; every other size is scaled from it.
const DRAWN = [16];
// --include takes names or simple wildcards, comma-separated, for a look at icons before they're marked ready.
const includeArg = process.argv.find((a, i) => process.argv[i - 1] === '--include');
const INCLUDE = (includeArg ?? '').split(',').filter(Boolean).map((g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
const included = (name) => INCLUDE.some((pattern) => pattern.test(name));
const ONLY = (process.argv.find((a, i) => process.argv[i - 1] === '--only') ?? '').split(',').map((n) => n.trim()).filter(Boolean);
const PRINTS = join(WORK, 'fingerprints.json');
const readIf = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
// Icons approved in the workbench ship as if their border were pink, as long as the drawing is the one approved.
const approvals = new Map(allRecords().filter((r) => r.approved).map((r) => [r.name, r.approved]));
const previousPrints = readIf(PRINTS, null);
const CHANGED = process.argv.includes('--changed') && Boolean(previousPrints);
if (process.argv.includes('--changed') && !previousPrints) console.log('No record of the last sync yet, so this one is a full sync.');
const PARTIAL = ONLY.length > 0 || CHANGED;
const BADGE_SUFFIX = /-(plus|minus|check|x|search|lock|key|shield|star|settings|arrow-up|arrow-down|cog|zap|clock|backup|download|upload)(?:-overlay)?$/;

function token() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'standardicon-figma', '-a', 'figma', '-w'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('No Figma token. Set FIGMA_TOKEN, or save one to the Keychain:\n  security add-generic-password -U -s standardicon-figma -a figma -w <token>');
    process.exit(1);
  }
}
const TOKEN = token();

// Retries rate limits, server errors, and dropped connections, which Figma's API has now and then.
async function request(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      if ((response.status === 429 || response.status >= 500) && attempt < 5) throw Object.assign(new Error(`HTTP ${response.status}`), { wait: Number(response.headers.get('retry-after')) * 1000 || 0 });
      throw Object.assign(new Error(`HTTP ${response.status} ${await response.text()}`), { final: true });
    } catch (error) {
      if (error.final || attempt >= 5) throw new Error(`${url.split('?')[0]}: ${error.message}`);
      // Figma says how long to wait after a rate limit. Otherwise back off a little more each time.
      await new Promise((r) => setTimeout(r, Math.min(Math.max(error.wait ?? 0, 2000 * attempt), 60000)));
    }
  }
}
const api = async (path) => (await request(`${API}${path}`, { headers: { 'X-Figma-Token': TOKEN } })).json();

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const fixed = (n) => +n.toFixed(3);
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const sizeOf = (variant) => {
  const m = variant.name.match(/Size=(\d+)/);
  return m && !/Style=Solid/.test(variant.name) ? +m[1] : null;
};
const isReady = (set) => {
  const stroke = (set.strokes ?? []).find((p) => p.visible !== false && p.type === 'SOLID');
  return Boolean(stroke) && set.strokeWeight === 4 && !(set.strokeDashes?.length) && hex(stroke.color) === PINK;
};
function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}
const findIn = (node, test) => {
  for (const n of walk(node)) if (test(n)) return n;
  return null;
};

// ---- 1. Read the file ----

const started = Date.now();
console.log('Reading Figma…');
const file = await api(`/files/${FILE_KEY}?depth=${ONLY.length ? 4 : 3}`);
const page = file.document.children[0];
const frameStubs = page.children.filter((n) => n.type === 'FRAME' && (n.children ?? []).some((c) => c.name === `${n.name} icons`));
const nodeFor = async (id) => (await api(`/files/${FILE_KEY}/nodes?ids=${encodeURIComponent(id)}&geometry=paths`)).nodes[id].document;
let frames;
const known = new Set();
const nameById = new Map();
// A badge's parent is its name without the badge suffix. If that parent has been renamed in Figma (globe →
// globe-simple), follow its record's Figma ID, or a former name, to what it's called now.
const recordsByName = new Map(allRecords().map((r) => [r.name, r]));
function parentOf(badge) {
  const base = badge.replace(BADGE_SUFFIX, '');
  if (base === badge || known.has(base)) return base;
  const id = recordsByName.get(base)?.figmaId;
  if (id && nameById.has(id)) return nameById.get(id);
  return [...recordsByName.values()].find((r) => r.formerNames?.includes(base) && known.has(r.name))?.name ?? base;
}
if (ONLY.length) {
  // Find the sets by name from a shallow read, then fetch only those and any badge's parent.
  const located = new Map();
  for (const stub of frameStubs) for (const set of stub.children.find((c) => c.name === `${stub.name} icons`).children ?? []) {
    if (set.type !== 'COMPONENT_SET') continue;
    known.add(set.name);
    nameById.set(set.id, set.name);
    if (!located.has(set.name)) located.set(set.name, { id: set.id, stub });
  }
  const notFound = ONLY.filter((name) => !located.has(name));
  if (notFound.length) {
    console.error(`Not in a category frame in Figma: ${notFound.join(', ')}. If you just drew it, Figma may not have saved yet, so try again shortly.`);
    process.exit(1);
  }
  const fetchNames = new Set(ONLY);
  for (const name of ONLY) {
    const parent = parentOf(name);
    if (parent !== name && located.has(parent)) fetchNames.add(parent);
  }
  // Several sets per request, so a long list doesn't run into Figma's rate limit.
  const names = [...fetchNames];
  const fetched = [];
  for (let i = 0; i < names.length; i += 25) {
    const batch = names.slice(i, i + 25);
    const ids = batch.map((name) => located.get(name).id);
    const { nodes } = await api(`/files/${FILE_KEY}/nodes?ids=${encodeURIComponent(ids.join(','))}&geometry=paths`);
    batch.forEach((name, k) => fetched.push({ name, node: nodes[ids[k]].document }));
  }
  // Same shape as a real category frame, holding only what was fetched.
  frames = frameStubs.map((stub) => ({ name: stub.name, id: stub.id, type: 'FRAME', absoluteBoundingBox: stub.absoluteBoundingBox, absoluteRenderBounds: stub.absoluteRenderBounds, children: [{ name: `${stub.name} icons`, type: 'FRAME', children: fetched.filter(({ name }) => located.get(name).stub === stub).map(({ node }) => node) }] })).filter((frame) => frame.children[0].children.length);
  console.log(`  ${ONLY.length} of ${known.size} icons`);
} else {
  frames = await inBatches(frameStubs, 4, (stub) => nodeFor(stub.id));
  console.log(`  ${frames.length} categories`);
}

// Each icon master holds a locked instance of the Icon grid component, named icon-grid, for drawing against
// in Figma. It isn't part of the icon, so it's taken out before anything reads the tree: the change check,
// the audit and the layout plan. The importer skips it in the exported SVGs too, in case it's showing.
const GRID_LAYER = 'icon-grid';
function dropGrid(node) {
  if (node.children) node.children = node.children.filter((child) => child.name !== GRID_LAYER).map(dropGrid);
  return node;
}
frames = frames.map(dropGrid);

// What a set looks like, wherever it sits on the canvas. A badge's parent shows up here too, so a parent edit reaches its badges.
function fingerprint(set) {
  const origin = set.absoluteBoundingBox;
  const shape = [...walk(set)].map((n) => {
    const box = n.absoluteBoundingBox;
    return [n.type, n.name, n.visible, n.strokes, n.fills, n.strokeWeight, n.strokeAlign, n.strokeCap, n.strokeJoin, n.strokeDashes, n.cornerRadius, n.rectangleCornerRadii, n.opacity, n.blendMode, n.booleanOperation, n.fillGeometry, n.strokeGeometry, box && [box.x - origin.x, box.y - origin.y, box.width, box.height].map(fixed)];
  });
  return createHash('sha1').update(JSON.stringify(shape)).digest('hex');
}
const prints = {};
for (const frame of frames) for (const set of walk(frame)) if (set.type === 'COMPONENT_SET') prints[set.id] = fingerprint(set);
const savePrints = () => writeFileSync(PRINTS, JSON.stringify(ONLY.length ? { ...previousPrints, ...prints } : prints));

// ---- 2. Work out what's ready, where it sits, and which icons are badges ----

for (const frame of frames) for (const set of walk(frame)) if (set.type === 'COMPONENT_SET') {
  known.add(set.name);
  nameById.set(set.id, set.name);
}

// In a partial sync these are the sets to export. Everything else keeps what it has.
const targets = new Set(ONLY);
if (CHANGED) for (const frame of frames) for (const set of walk(frame)) if (set.type === 'COMPONENT_SET' && prints[set.id] !== previousPrints[set.id]) targets.add(set.name);

// Everything the importer needs for the sets that pass `wanted`: where each sits, and which are badges.
function planFor(wanted, within = frames) {
  const chosen = new Set();
  const badges = [];
  const cutPatterns = [];
  for (const frame of within) {
    for (const set of walk(frame)) {
      if (set.type !== 'COMPONENT_SET' || !wanted(set)) continue;
      chosen.add(set.name);
      const v16 = set.children.find((v) => sizeOf(v) === 16);
      const body = v16 && findIn(v16, (n) => n.name === 'Body' && (n.type === 'INSTANCE' || (n.type === 'BOOLEAN_OPERATION' && n.booleanOperation === 'SUBTRACT')));
      if (!body || badges.some((b) => b[0] === set.name)) continue;
      const cuts = {};
      for (const variant of set.children) {
        const size = sizeOf(variant);
        const cut = size && findIn(variant, (n) => n.name === 'Cutout');
        if (!cut) continue;
        const v = variant.absoluteBoundingBox, c = cut.absoluteBoundingBox;
        cuts[size] = [fixed(c.x - v.x), fixed(c.y - v.y), fixed(c.width), fixed(c.height), fixed(cut.cornerRadius ?? 0)];
      }
      let index = cutPatterns.findIndex((p) => JSON.stringify(p) === JSON.stringify(cuts));
      if (index < 0) index = cutPatterns.push(cuts) - 1;
      badges.push([set.name, parentOf(set.name), index]);
    }
  }
  // A badge whose parent isn't chosen still needs the parent's geometry, without releasing it.
  const geometryOnly = new Set(badges.map((b) => b[1]).filter((p) => !chosen.has(p) && known.has(p)));

  const patterns = [];
  const rows = [];
  const origins = {};
  for (const frame of within) {
    const o = frame.absoluteBoundingBox, r = frame.absoluteRenderBounds ?? o;
    origins[frame.name] = [fixed(o.x - r.x), fixed(o.y - r.y)];
    for (const set of walk(frame)) {
      if (set.type !== 'COMPONENT_SET' || (!chosen.has(set.name) && !geometryOnly.has(set.name))) continue;
      const by = {};
      for (const variant of set.children) {
        const size = sizeOf(variant);
        if (size) by[size] = variant.absoluteBoundingBox;
      }
      if (!by[16]) continue;
      const offsets = DRAWN.slice(1).map((z) => (by[z] ? [fixed(by[z].x - by[16].x), fixed(by[z].y - by[16].y)] : null));
      let index = patterns.findIndex((p) => JSON.stringify(p) === JSON.stringify(offsets));
      if (index < 0) index = patterns.push(offsets) - 1;
      const row = [set.name, fixed(by[16].x - o.x), fixed(by[16].y - o.y), index];
      if (geometryOnly.has(set.name)) row.push(1);
      rows.push(row);
    }
    rows.push(['#', frame.name]);
  }
  return { chosen, badges, cutPatterns, patterns, rows, origins };
}

const includedOnly = [];
const approvedOnly = [];
const release = planFor((set) => {
  if (isReady(set)) return true;
  if (approvals.has(set.name)) {
    approvedOnly.push(set.name);
    return true;
  }
  if (!included(set.name)) return false;
  includedOnly.push(set.name);
  return true;
});
const ready = release.chosen;
const { badges, cutPatterns, patterns, rows, origins } = release;

const { _note, ...bases } = JSON.parse(readFileSync(join(ROOT, 'scripts/badge-bases.json'), 'utf8'));
const orphans = badges.filter(([name, parent]) => !known.has(parent) && !bases[name]).map(([name]) => name);
if (orphans.length) {
  console.error(`These badge icons have no parent icon and no entry in scripts/badge-bases.json: ${orphans.join(', ')}`);
  process.exit(1);
}

if (!PARTIAL) {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, 'positions.json'), JSON.stringify({ origins, patterns, cutPatterns, badges, bases, rows }));
  // For the workbench: every set in Figma, ready or not.
  const everything = planFor(() => true);
  writeFileSync(join(WORK, 'positions-all.json'), JSON.stringify({ origins: everything.origins, patterns: everything.patterns, cutPatterns: everything.cutPatterns, badges: everything.badges, bases, rows: everything.rows }));
}
// What each set's border says. A sync of named icons leaves everyone else's entry alone.
const status = ONLY.length ? readIf(join(WORK, 'status.json'), {}) : {};
const seenThisRun = new Set();
// A named icon can have just been renamed in Figma. Its old name has to go, or it would linger next to the new one.
const renamedAway = new Set();
for (const frame of frames) {
  for (const set of walk(frame)) {
    if (set.type !== 'COMPONENT_SET' || seenThisRun.has(set.name)) continue;
    seenThisRun.add(set.name);
    if (ONLY.length) for (const [old, entry] of Object.entries(status)) if (old !== set.name && entry.id === set.id) { delete status[old]; renamedAway.add(old); }
    const stroke = (set.strokes ?? []).find((p) => p.visible !== false && p.type === 'SOLID');
    status[set.name] = { section: frame.name, id: set.id, ready: isReady(set), border: stroke ? { color: hex(stroke.color), weight: set.strokeWeight, dashed: Boolean(set.strokeDashes?.length) } : null };
  }
}
writeFileSync(join(WORK, 'status.json'), JSON.stringify(status));

// New sets get records, and sets renamed in Figma carry theirs along, before the import reads them.
const recordChanges = reconcile(status);

// How each set is built, against icons/AUDIT.md. This only reports for now.
const fresh = audit(frames, allRecords());
const findings = ONLY.length ? [...readIf(join(WORK, 'audit.json'), []).filter((f) => !targets.has(f.icon) && !renamedAway.has(f.icon)), ...fresh.filter((f) => targets.has(f.icon))] : fresh;
writeFileSync(join(WORK, 'audit.json'), JSON.stringify(findings));
console.log(`  ${ready.size} ready${INCLUDE.length ? ' or included' : ''}, ${badges.length} badges`);
if (INCLUDE.length) console.log(`  Included without the ready border: ${includedOnly.join(', ') || 'none'}`);

// ---- 3. Export each category as SVG ----

async function exportAll(items, dir) {
  for (let i = 0; i < items.length; i += 40) {
    const batch = items.slice(i, i + 40);
    const { images, err } = await api(`/images/${FILE_KEY}?ids=${encodeURIComponent(batch.map((n) => n.id).join(','))}&format=svg&svg_include_id=true`);
    if (err) throw new Error(`Figma export: ${err}`);
    await inBatches(batch, 6, async (item) => {
      if (!images[item.id]) throw new Error(`Figma didn't export ${item.name}`);
      writeFileSync(join(dir, `${item.name}.svg`), await (await request(images[item.id])).text());
    });
  }
}
const PART = join(WORK, 'partial');
const setsByName = new Map();
for (const frame of frames) for (const set of walk(frame)) if (set.type === 'COMPONENT_SET' && !setsByName.has(set.name)) setsByName.set(set.name, set);
let exported = [];
if (PARTIAL) {
  // Each set exports on its own, standing in for a category frame.
  const names = new Set(targets);
  for (const name of targets) {
    const parent = parentOf(name);
    if (parent !== name && setsByName.has(parent)) names.add(parent);
  }
  exported = [...names].map((name) => setsByName.get(name));
  rmSync(PART, { recursive: true, force: true });
  mkdirSync(PART, { recursive: true });
  console.log(targets.size ? `Exporting ${targets.size} changed: ${[...targets].slice(0, 12).join(', ')}${targets.size > 12 ? ', …' : ''}` : 'Nothing to export.');
  await exportAll(exported, PART);
} else {
  console.log('Exporting SVGs…');
  await exportAll(frames, WORK);
}

// ---- 4. Import and report ----

const ICONS = join(ROOT, 'icons/icons.json');
const before = existsSync(ICONS) ? JSON.parse(readFileSync(ICONS, 'utf8')) : [];
writeFileSync(join(WORK, 'previous.json'), JSON.stringify(before));
const WORKBENCH_COPY = join(WORK, 'all-icons.json');
if (PARTIAL) {
  let imported = [];
  if (exported.length) {
    const plan = planFor((set) => targets.has(set.name), exported.map((set) => ({ name: set.name, id: set.id, type: 'FRAME', absoluteBoundingBox: set.absoluteBoundingBox, absoluteRenderBounds: set.absoluteRenderBounds, children: [set] })));
    const planFile = join(PART, 'positions.json');
    writeFileSync(planFile, JSON.stringify({ origins: plan.origins, patterns: plan.patterns, cutPatterns: plan.cutPatterns, badges: plan.badges, bases, rows: plan.rows }));
    const out = join(PART, 'out.json');
    try {
      const log = execFileSync('node', [join(ROOT, 'scripts/ingest.mjs'), PART, '--positions', planFile, '--out', out, '--lenient'], { encoding: 'utf8' });
      for (const row of log.split('\n')) if (/kept the|left out|Skipped|^ {2}/.test(row)) console.log(`  ${row.trim()}`);
      imported = JSON.parse(readFileSync(out, 'utf8'));
    } catch (error) {
      console.error(error.stdout || '', error.stderr || '');
      console.error('Import failed. icons/icons.json was not changed.');
      process.exit(1);
    }
  }
  const failed = [...targets].filter((name) => !imported.some((icon) => icon.name === name));
  if (failed.length) console.log(`  Couldn't read these, so they keep what they had: ${failed.join(', ')}`);
  const merge = (list, keep) => {
    const byName = new Map(list.map((icon) => [icon.name, icon]));
    for (const name of renamedAway) byName.delete(name);
    for (const icon of imported) {
      const placed = { ...icon, category: status[icon.name]?.section ?? icon.category };
      if (keep(icon.name)) byName.set(icon.name, placed);
      else byName.delete(icon.name);
    }
    // A sync of changes has the whole file in hand, so it can also follow moves and deletions.
    if (CHANGED) {
      for (const [name, icon] of byName) {
        if (!status[name] || !keep(name)) byName.delete(name);
        else if (status[name].section !== icon.category) byName.set(name, { ...icon, category: status[name].section });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  writeFileSync(ICONS, JSON.stringify(merge(before, (name) => status[name]?.ready || approvals.has(name)), null, 1) + '\n');
  writeFileSync(WORKBENCH_COPY, JSON.stringify(merge(readIf(WORKBENCH_COPY, []), () => true), null, 1) + '\n');
} else {
  try {
    console.log(execFileSync('node', [join(ROOT, 'scripts/ingest.mjs'), WORK], { encoding: 'utf8' }).trim().split('\n').map((l) => `  ${l}`).join('\n'));
  } catch (error) {
    console.error(error.stdout || '', error.stderr || '');
    console.error('Import failed. icons/icons.json was not changed.');
    process.exit(1);
  }
}
// An approval covers one drawing. If the icon was redrawn after it, and the border still isn't pink, it doesn't ship.
const approvedStale = [];
{
  const shipped = JSON.parse(readFileSync(ICONS, 'utf8'));
  const kept = shipped.filter((icon) => {
    const approval = approvals.get(icon.name);
    if (!approval || status[icon.name]?.ready) return true;
    const version = historyOf(icon.name).find((v) => v.at === approval.version);
    if (version && sameShape(version, icon)) return true;
    approvedStale.push(icon.name);
    return false;
  });
  if (approvedStale.length) writeFileSync(ICONS, JSON.stringify(kept, null, 1) + '\n');
}
const after = JSON.parse(readFileSync(ICONS, 'utf8'));

const { hasWeights, toSvg } = await import('../lib/icon.mjs');
const all = (icon) => [icon.body, ...Object.values(icon.sizes ?? {})].join('|');
const old = new Map(before.map((i) => [i.name, i]));
const now = new Map(after.map((i) => [i.name, i]));
const added = after.filter((i) => !old.has(i.name)).map((i) => i.name);
const removed = before.filter((i) => !now.has(i.name)).map((i) => i.name);
const redrawn = after.filter((i) => old.has(i.name) && !sameShape(i, old.get(i.name))).map((i) => i.name);
const moved = after.filter((i) => old.has(i.name) && old.get(i.name).category !== i.category).map((i) => `${i.name} (${old.get(i.name).category} → ${i.category})`);
const regularOnly = after.filter((i) => !hasWeights(i)).map((i) => i.name);
const strayFills = after.filter((i) => /fill="currentColor"/.test(all(i)) && !i.solidParts).map((i) => i.name);

writeFileSync(join(WORK, 'report.json'), JSON.stringify({ at: new Date().toISOString(), count: after.length, previous: before.length, added, removed, redrawn, moved, regularOnly, strayFills, records: recordChanges }));

const line = (label, list) => console.log(`  ${label}: ${list.length ? list.join(', ') : 'none'}`);
console.log(`\n${after.length} icons (${after.length - before.length >= 0 ? '+' : ''}${after.length - before.length})`);
line('Added', added);
line('Removed', removed);
line('Redrawn', redrawn);
line('Moved', moved);
line('Regular only (filled shapes)', regularOnly);
line('Fills not on the solid-parts list', strayFills);
line('Approved in the workbench, not pink in Figma yet (run the Figma plugin)', approvedOnly.filter((name) => !approvedStale.includes(name) && now.has(name)));
line('Approved, but redrawn since, so not shipped', approvedStale);
line('New records', recordChanges.created);
line('Planned icons now in Figma', recordChanges.activated);
line('Renamed in Figma', recordChanges.renamed);
line('Different Figma ID, so check these by hand', recordChanges.idChanged);
line('Dropped or covered but back in Figma', recordChanges.conflicts);
line('Gone from the Figma frames', recordChanges.missing);
const auditErrors = findings.filter((f) => f.severity === 'error');
const auditCount = (list) => Object.entries(Object.groupBy(list, (f) => f.check)).map(([check, rows]) => `${check} ${rows.length}`).join(', ') || 'none';
console.log(`  Audit: ${auditErrors.length} errors (${auditCount(auditErrors)}), ${findings.length - auditErrors.length} warnings (${auditCount(findings.filter((f) => f.severity === 'warn'))})`);

// A review page: every added or redrawn icon, before and after, at each size and weight.
const review = [...added, ...redrawn];
const cells = (icon) =>
  [[16, 'thin'], [16, 'regular'], [24, 'semibold'], [48, 'bold'], [48, 'black']]
    .map(([size, weight]) => `<td>${hasWeights(icon) || weight === 'thin' || weight === 'regular' ? toSvg(icon, size, weight) : ''}</td>`)
    .join('');
writeFileSync(
  join(WORK, 'review.html'),
  `<!doctype html><meta charset="utf-8"><title>Sync review</title><body style="font:13px system-ui;padding:24px">
<h1 style="font-size:18px">${review.length ? `${review.length} added or redrawn` : 'Nothing added or redrawn'}</h1>
<table cellpadding="8" style="border-collapse:collapse">${review
    .map((name) => {
      const icon = now.get(name), prev = old.get(name);
      return `<tr style="border-top:1px solid #eee"><td><b>${name}</b><br>${prev ? 'redrawn' : 'new'}</td>${prev ? `<td style="opacity:.35">${toSvg(prev, 48)}</td>` : '<td></td>'}${cells(icon)}</tr>`;
    })
    .join('')}</table>`,
);
if (review.length) console.log(`\nReview the changes: ${join(WORK, 'review.html')}`);

// The workbench's copy of every icon, including ones not ready to ship. A failure here never affects the release.
try {
  if (!PARTIAL) {
    const log = execFileSync('node', [join(ROOT, 'scripts/ingest.mjs'), WORK, '--positions', join(WORK, 'positions-all.json'), '--out', WORKBENCH_COPY, '--lenient'], { encoding: 'utf8' });
    writeFileSync(join(WORK, 'all-report.txt'), log);
  }
  console.log(`\nWorkbench copy: ${readIf(WORKBENCH_COPY, []).length} icons in Figma, ready or not.`);
} catch (error) {
  console.log(`\nCouldn't build the workbench copy: ${error.stderr || error.message}`);
}

// Keep every drawing: a changed icon gets a new version in icons/history, released or not.
try {
  for (const pair of recordChanges.renamed) renameHistory(...pair.split(' → '));
  const drawn = readIf(WORKBENCH_COPY, []);
  const scope = PARTIAL ? drawn.filter((icon) => targets.has(icon.name)) : drawn;
  const versioned = recordHistory(scope, { released: (icon) => now.has(icon.name) && sameShape(now.get(icon.name), icon) });
  line('New versions in the history', versioned);
} catch (error) {
  console.log(`\nCouldn't update the history: ${error.message}`);
}
savePrints();
if (PARTIAL) rmSync(PART, { recursive: true, force: true });

if (process.argv.includes('--build')) {
  console.log('\nBuilding…');
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
}
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);

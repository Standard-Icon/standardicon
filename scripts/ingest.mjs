#!/usr/bin/env node
// Turns a Figma export into icons/icons.json, the single source for the site and CLI.
//
//   node scripts/ingest.mjs <export-dir> [--solids]
//
// Solid icons are left out unless --solids is passed. The first release is outlined icons only.
//
// <export-dir> holds one <section>.svg per section frame of the `mak-icons` frame,
// plus positions.json, which locates each icon's sizes inside its section frame.
// README.md describes how to produce them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaleBody } from '../lib/icon.mjs';
import { MAX_FAMILY_FILL, SOLID_PARTS, SOLID_FAMILIES, allowsSolidParts } from './solid-parts.mjs';
import { allRecords } from '../lib/records.mjs';
import { clipBody } from './clip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const includeSolids = process.argv.includes('--solids');
const flagValue = (flag) => process.argv.find((_, i) => process.argv[i - 1] === flag);
// For the workbench: read a different position list, write somewhere else, and skip what can't be read.
const positionsFile = flagValue('--positions');
const outFile = flagValue('--out');
const lenient = process.argv.includes('--lenient');
if (!dir) {
  console.error('Usage: node scripts/ingest.mjs <export-dir>');
  process.exit(1);
}

// Only the 16px master is drawn in Figma. Every other size is scaled from it when the site is built.
// (The 18 to 24 variants were instances of the 16 and were removed in 2026-11.)
const DRAWN = [16];

const round = (n) => +n.toFixed(3);

// Figma writes absolute commands only, which is what makes this shift safe.
function shiftPath(d, ox, oy, name) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  let out = '';
  let cmd = '';
  let i = 0;
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (!/^[MLCQSTHVZ]$/.test(cmd)) throw new Error(`${name}: unsupported path command ${cmd}`);
      out += cmd;
      if (cmd === 'Z') continue;
    }
    const size = { M: 2, L: 2, C: 6, Q: 4, S: 4, T: 2, H: 1, V: 1 }[cmd];
    const args = tokens.slice(i, i + size).map(Number);
    i += size;
    const shifted = args.map((v, idx) => {
      const isY = cmd === 'V' || (cmd !== 'H' && idx % 2 === 1);
      return round(v - (isY ? oy : ox));
    });
    out += shifted.join(' ');
    if (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) out += ' ';
  }
  return out;
}

const SHIFT_X = new Set(['x', 'cx', 'x1', 'x2']);
const SHIFT_Y = new Set(['y', 'cy', 'y1', 'y2']);
const KEEP = new Set(['width', 'height', 'r', 'rx', 'ry', 'fill-rule', 'clip-rule', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit', 'opacity', 'fill-opacity']);

// Figma rotates or translates some rectangles. Turn those into a path with the transform applied, so
// every element stays in plain absolute coordinates. Rounded corners use the standard cubic approximation.
function parseTransform(value, name) {
  let m = [1, 0, 0, 1, 0, 0];
  const multiply = (n) => {
    m = [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  };
  for (const [, fn, args] of value.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    if (fn === 'translate') multiply([1, 0, 0, 1, v[0], v[1] ?? 0]);
    else if (fn === 'matrix') multiply(v);
    else if (fn === 'rotate') {
      const a = (v[0] * Math.PI) / 180;
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      multiply([1, 0, 0, 1, cx, cy]);
      multiply([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
      multiply([1, 0, 0, 1, -cx, -cy]);
    } else throw new Error(`${name}: unsupported transform ${fn}`);
  }
  const point = ([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  // Rotations and translations keep shapes the same size; a circle can only move.
  point.rigid = Math.abs(m[0] * m[3] - m[1] * m[2] - 1) < 1e-6 && Math.abs(m[0] * m[0] + m[1] * m[1] - 1) < 1e-6;
  return point;
}

function moveCircle(attrs, name) {
  const point = parseTransform(attrs.find(([k]) => k === 'transform')[1], name);
  if (!point.rigid) throw new Error(`${name}: a circle with a scaling transform is not supported`);
  const get = (key) => Number(attrs.find(([k]) => k === key)?.[1] ?? 0);
  const [cx, cy] = point([get('cx'), get('cy')]).map((n) => String(+n.toFixed(4)));
  return ['circle', attrs.filter(([key]) => key !== 'transform').map(([key, value]) => [key, key === 'cx' ? cx : key === 'cy' ? cy : value])];
}

function rectToPath(attrs, name) {
  const get = (key) => Number(attrs.find(([k]) => k === key)?.[1] ?? 0);
  const [x, y, w, h] = [get('x'), get('y'), get('width'), get('height')];
  const r = Math.min(get('rx') || get('ry'), w / 2, h / 2);
  const point = parseTransform(attrs.find(([k]) => k === 'transform')[1], name);
  const k = 0.5523 * r;
  const at = (px, py) => point([px, py]).map((n) => +n.toFixed(4)).join(' ');
  const d = r
    ? `M${at(x + r, y)}L${at(x + w - r, y)}C${at(x + w - r + k, y)} ${at(x + w, y + r - k)} ${at(x + w, y + r)}L${at(x + w, y + h - r)}C${at(x + w, y + h - r + k)} ${at(x + w - r + k, y + h)} ${at(x + w - r, y + h)}L${at(x + r, y + h)}C${at(x + r - k, y + h)} ${at(x, y + h - r + k)} ${at(x, y + h - r)}L${at(x, y + r)}C${at(x, y + r - k)} ${at(x + r - k, y)} ${at(x + r, y)}Z`
    : `M${at(x, y)}L${at(x + w, y)}L${at(x + w, y + h)}L${at(x, y + h)}Z`;
  const kept = attrs.filter(([key]) => !['x', 'y', 'width', 'height', 'rx', 'ry', 'transform'].includes(key));
  return ['path', [['d', d], ...kept]];
}

function convertElement(line, ox, oy, name) {
  let [, tag, rest] = line.match(/^<([a-zA-Z]+)\s([^>]*?)\/?>$/) ?? [];
  if (!tag) throw new Error(`${name}: could not parse ${line.slice(0, 80)}`);
  // Names can hold digits: <line> has x1, y1, x2 and y2.
  let attrs = [...rest.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g)].map((m) => [m[1], m[2]]);
  if (tag === 'rect' && attrs.some(([key]) => key === 'transform')) [tag, attrs] = rectToPath(attrs, name);
  else if (tag === 'circle' && attrs.some(([key]) => key === 'transform')) [tag, attrs] = moveCircle(attrs, name);
  const out = [];
  for (const [key, value] of attrs) {
    if (key === 'id') continue;
    if (key === 'transform') throw new Error(`${name}: transform on <${tag}> is not supported`);
    if (key === 'd') out.push(`d="${shiftPath(value, ox, oy, name)}"`);
    else if (SHIFT_X.has(key)) out.push(`${key}="${round(+value - ox)}"`);
    else if (SHIFT_Y.has(key)) out.push(`${key}="${round(+value - oy)}"`);
    else if (key === 'stroke' || key === 'fill') {
      if (value === 'none') out.push(`${key}="none"`);
      // spinner's fill exports as a gradient between two identical black stops, so it is solid in practice.
      else if (value === 'black' || value.startsWith('url(#paint')) out.push(`${key}="currentColor"`);
      else throw new Error(`${name}: unexpected ${key} "${value}"`);
    } else if (KEEP.has(key)) out.push(`${key}="${value}"`);
    else throw new Error(`${name}: unexpected attribute ${key}`);
  }
  out.sort((a, b) => attrRank(a) - attrRank(b));
  if (tag === 'path' && out.some((a) => a === 'stroke="currentColor"') && !out.some((a) => a === 'fill="currentColor"')) {
    const i = out.findIndex((a) => a.startsWith('d='));
    out[i] = `d="${joinPieces(out[i].slice(3, -1))}"`;
  }
  return `<${tag} ${out.join(' ')}/>`;
}

// Attributes in one fixed order, so the same drawing always produces the same markup.
const ATTR_ORDER = ['fill-rule', 'clip-rule', 'd', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray'];
const attrRank = (attr) => {
  const i = ATTR_ORDER.indexOf(attr.slice(0, attr.indexOf('=')));
  return i < 0 ? ATTR_ORDER.length : i;
};

// Figma's API exports a stroked vector as separate pieces wherever lines meet: a plus becomes four short
// lines from the centre. With round caps that looks the same, but overlapping ends show through in a
// translucent colour. This rejoins open pieces end to end. Closed shapes are left alone.
function joinPieces(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const subs = [];
  let current = null, pen = [0, 0], cmd = '', i = 0;
  const num = () => +tokens[i++];
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'Z') { if (current) current.closed = true; current = null; continue; }
    if (cmd === 'M') { pen = [num(), num()]; current = { start: pen, segs: [], closed: false }; subs.push(current); cmd = 'L'; continue; }
    if (!current) { current = { start: pen, segs: [], closed: false }; subs.push(current); }
    let seg;
    if (cmd === 'L') seg = ['L', [pen, [num(), num()]]];
    else if (cmd === 'H') seg = ['L', [pen, [num(), pen[1]]]];
    else if (cmd === 'V') seg = ['L', [pen, [pen[0], num()]]];
    else if (cmd === 'C') seg = ['C', [pen, [num(), num()], [num(), num()], [num(), num()]]];
    else if (cmd === 'Q') seg = ['Q', [pen, [num(), num()], [num(), num()]]];
    else return d; // anything unusual stays as exported
    current.segs.push(seg);
    pen = seg[1][seg[1].length - 1];
  }
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.002 && Math.abs(a[1] - b[1]) < 0.002;
  const first = (sub) => sub.segs[0][1][0];
  const last = (sub) => { const p = sub.segs[sub.segs.length - 1][1]; return p[p.length - 1]; };
  const reverse = (sub) => ({ ...sub, segs: sub.segs.slice().reverse().map(([t, pts]) => [t, pts.slice().reverse()]) });
  const open = subs.filter((s) => !s.closed && s.segs.length);
  const closed = subs.filter((s) => s.closed || !s.segs.length);
  if (open.length < 2) return d;
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < open.length && !merged; a++) {
      for (let b = 0; b < open.length && !merged; b++) {
        if (a === b) continue;
        let A = open[a], B = open[b];
        if (same(last(A), first(B))) {}
        else if (same(last(A), last(B))) B = reverse(B);
        else if (same(first(A), first(B))) A = reverse(A);
        else continue;
        open[a] = { ...A, segs: [...A.segs, ...B.segs] };
        open.splice(b, 1);
        merged = true;
      }
    }
  }
  // Straight runs that continue in the same direction become one line.
  for (const sub of open) {
    const out = [];
    for (const seg of sub.segs) {
      const prev = out[out.length - 1];
      if (prev && prev[0] === 'L' && seg[0] === 'L') {
        const [a, b] = prev[1], c = seg[1][1];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
        if (Math.abs(cross) < 1e-6 && dot > 0) {
          out[out.length - 1] = ['L', [a, c]];
          continue;
        }
      }
      out.push(seg);
    }
    sub.segs = out;
  }
  const f = (n) => String(round(n));
  const emit = (sub) => {
    let out = `M${f(first(sub)[0])} ${f(first(sub)[1])}`;
    for (const [t, pts] of sub.segs) {
      const [p0] = pts, p1 = pts[pts.length - 1];
      if (t === 'L') out += p0[1] === p1[1] ? `H${f(p1[0])}` : p0[0] === p1[0] ? `V${f(p1[1])}` : `L${f(p1[0])} ${f(p1[1])}`;
      else out += t + pts.slice(1).map((p) => `${f(p[0])} ${f(p[1])}`).join(' ');
    }
    return sub.closed ? `${out}Z` : out;
  };
  // Closed shapes keep their original text; only the rejoined open pieces are rewritten.
  const original = d.split(/(?=M)/).filter((part) => /Z\s*$/.test(part));
  return [...open.map(emit), ...original].join('');
}

function outOfBounds(body, size) {
  const nums = [];
  for (const m of body.matchAll(/\bd="([^"]*)"/g)) {
    for (const part of m[1].split(/(?=[A-Z])/)) {
      if (part[0] === 'Z') continue;
      nums.push(...part.slice(1).trim().split(' ').map(Number));
    }
  }
  return nums.some((n) => n < -1 || n > size + 1);
}

// Scaling a stroke reproduces the larger sizes, because the stroke stays 1px. Scaling an outlined
// shape doesn't: it would thicken the line. Compare against what's drawn in Figma at each size.
const NUMBER = /-?\d*\.?\d+(?:e-?\d+)?/g;
function matches(a, b) {
  if (a.replace(NUMBER, '#') !== b.replace(NUMBER, '#')) return false;
  const x = a.match(NUMBER) ?? [];
  const y = b.match(NUMBER) ?? [];
  return x.length === y.length && x.every((n, i) => Math.abs(+n - +y[i]) <= 0.02);
}

// origins: how far each section's export canvas extends past its frame (thick borders can stick out).
// badges: [name, parent, cutPattern] for icons drawn in Figma as Subtract(parent outline, Cutout).
// cutPatterns: the Cutout rect [x, y, width, height, radius] at each drawn size.
// bases: base outlines for badges whose parent isn't an icon in the set, keyed by badge, then size.
// A fifth row value of 1 marks a set read only for its geometry, as a badge parent, and not released.
const { patterns, rows, origins = {}, badges = [], cutPatterns = [], bases = {} } = JSON.parse(readFileSync(positionsFile ?? join(dir, 'positions.json'), 'utf8'));
const position = new Map();
const sections = [];
const geometryOnly = new Set();
for (const row of rows) {
  if (row[0] === '#') sections.push(row[1]);
  // A set can appear twice in a frame; the first copy wins.
  else if (!position.has(row[0])) {
    position.set(row[0], { x: row[1], y: row[2], offsets: patterns[row[3]], section: sections.length });
    if (row[4] === 1) geometryOnly.add(row[0]);
  }
}
const badgeOf = new Map(badges.map(([name, parent, cut]) => [name, { parent, cuts: cutPatterns[cut] }]));

const icons = [];
const found = new Map();
const claimedBy = new Map();
const problems = [];
const skipped = new Set();
const partial = new Set();

for (const section of sections) {
  const file = join(dir, `${section}.svg`);
  if (!existsSync(file)) {
    problems.push(`missing export for section ${section}`);
    continue;
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  const [originX, originY] = origins[section] ?? [0, 0];

  const stack = [];
  for (const raw of lines) {
    const line = raw.trim();
    const open = line.match(/^<g(?:\s+id="([^"]*)")?[^>]*>$/);
    if (open) {
      stack.push(open[1] ?? '');
      continue;
    }
    if (line === '</g>') {
      stack.pop();
      continue;
    }
    if (!/^<(path|rect|circle|ellipse|line|polygon|polyline)\s/.test(line)) continue;
    // The Icon grid component in each master is for drawing against in Figma, never part of the icon.
    if (stack.some((id) => /^icon-grid(_\d+)?$/.test(id))) continue;

    const idx = stack.findIndex((id) => /^(Style=\w+, )?Size=\d+(_\d+)?$/.test(id));
    if (idx < 1) continue;
    const size = Number(stack[idx].match(/Size=(\d+)/)[1]);
    if (!DRAWN.includes(size)) continue;
    const rawSet = stack[idx - 1];
    const setName = rawSet.replace(/_\d+$/, '');
    const solid = /^Style=Solid/.test(stack[idx]);
    if (solid && !includeSolids) continue;
    const name = setName + (solid ? '-solid' : '');
    const pos = position.get(name);
    if (pos && sections[pos.section] !== section) continue;
    // Duplicate copies of a set export as name_2 and so on. Only the first group read for a name counts.
    if (pos && claimedBy.has(name) && claimedBy.get(name) !== `${section}/${rawSet}`) continue;
    if (pos) claimedBy.set(name, `${section}/${rawSet}`);
    // A badge's parent layer is rebuilt from the parent's strokes below, and its Cutout only hides that layer in Figma.
    if (badgeOf.has(name) && (/\sid="(Body|Cutout)(_\d+)?"/.test(line) || stack.some((id) => /^(Body|Cutout)(_\d+)?$/.test(id)))) continue;
    if (!pos) {
      // Not in positions.json: either drawn after it was taken, or not marked ready for release.
      skipped.add(name);
      continue;
    }
    const offset = size === 16 ? [0, 0] : pos.offsets[DRAWN.indexOf(size) - 1];
    if (!offset) continue;
    try {
      const element = convertElement(line, pos.x + offset[0] + originX, pos.y + offset[1] + originY, name);
      if (!found.has(name)) found.set(name, { section, bodies: {} });
      const { bodies } = found.get(name);
      bodies[size] = (bodies[size] ?? '') + element;
    } catch (error) {
      problems.push(error.message);
    }
  }
}

// Rebuild each badge: its parent's strokes, clipped where the badge sits, under the badge's own border and glyph.
for (const [name, { parent, cuts }] of badgeOf) {
  const entry = found.get(name);
  if (!entry) continue;
  for (const size of DRAWN) {
    if (!entry.bodies[size]) continue;
    const base = bases[name]?.[size] ?? found.get(parent)?.bodies[size];
    if (!base) {
      problems.push(`${name}: no ${size}px geometry for its parent ${parent}`);
      continue;
    }
    if (!cuts?.[size]) {
      problems.push(`${name}: no cutout at ${size}px`);
      continue;
    }
    // The badge layer can repeat a filled part of the parent, such as tag's hole. Keep one of each.
    const parts = (clipBody(base, cuts[size]) + entry.bodies[size]).match(/<[^>]+\/>/g) ?? [];
    entry.bodies[size] = [...new Set(parts)].join('');
  }
}

for (const [name, { section, bodies }] of found) {
  if (geometryOnly.has(name)) continue;
  if (!bodies[16]) {
    problems.push(`${name}: no 16px master`);
    continue;
  }
  for (const [size, body] of Object.entries(bodies)) {
    if (outOfBounds(body, +size)) problems.push(`${name}: ${size}px geometry falls outside its box`);
  }
  if (DRAWN.some((size) => !bodies[size])) partial.add(name);
  const exact = {};
  for (const size of DRAWN.slice(1)) {
    if (bodies[size] && !matches(scaleBody(bodies[16], size), bodies[size])) exact[size] = bodies[size];
  }
  // Keep sizes together so an icon is either fully derived or fully as drawn.
  const icon = { name, category: section, body: bodies[16] };
  if (Object.keys(exact).length) {
    icon.sizes = {};
    for (const size of DRAWN.slice(1)) if (bodies[size]) icon.sizes[size] = bodies[size];
  }
  icons.push(icon);
}

const names = new Set(icons.map((i) => i.name));
for (const name of position.keys()) {
  if (geometryOnly.has(name)) continue;
  if (!includeSolids && name.endsWith('-solid')) continue;
  if (!names.has(name)) problems.push(`no geometry for ${name}`);
}
if (names.size !== icons.length) problems.push('duplicate icon names');

// The records add search context: each icon's group, and the names it covers.
const group = new Map();
const aliases = new Map();
for (const record of allRecords()) {
  group.set(record.name, record.group ?? null);
  if (record.aliases) aliases.set(record.name, [...(aliases.get(record.name) ?? []), ...record.aliases]);
  if (record.status === 'covered') aliases.set(record.coveredBy, [...(aliases.get(record.coveredBy) ?? []), record.name]);
}

// Icons allowed filled parts by family, not by name, only get small ones: anything bigger is likely a flattened stroke.
for (const icon of icons) {
  if (SOLID_PARTS.has(icon.name) || !SOLID_FAMILIES.some((pattern) => pattern.test(icon.name))) continue;
  for (const el of icon.body.match(/<[^>]*fill="currentColor"[^>]*\/>/g) ?? []) {
    const nums = (el.match(/\bd="([^"]*)"/)?.[1] ?? '').match(NUMBER)?.map(Number) ?? [];
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (w > MAX_FAMILY_FILL || h > MAX_FAMILY_FILL) problems.push(`${icon.name}: filled shape ${round(w)}×${round(h)}px is too big to be a label`);
  }
}

const result = icons
  .map((icon) => ({
    name: icon.name,
    category: icon.category,
    group: group.get(icon.name.replace(/-solid$/, '')) ?? null,
    // An alias can't be the name of an icon that's being released.
    aliases: (aliases.get(icon.name) ?? []).filter((alias, i, all) => !names.has(alias) && all.indexOf(alias) === i),
    body: icon.body,
    ...(icon.sizes ? { sizes: icon.sizes } : {}),
    // Badges inherit their parent's filled parts, such as tag-plus keeping tag's hole.
    ...(allowsSolidParts(icon.name) || (badgeOf.has(icon.name) && allowsSolidParts(badgeOf.get(icon.name).parent)) ? { solidParts: true } : {}),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const OUTPUT = outFile ?? join(ROOT, 'icons/icons.json');
const published = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, 'utf8')) : [];

// A problem with one icon shouldn't block the rest. That icon keeps its published version, or stays out
// if it was never published, and the report says why. Problems that aren't about one icon still stop the run.
const iconProblems = new Map();
for (const problem of problems.splice(0)) {
  const match = problem.match(/^([\w-]+): (.*)$/);
  if (match && found.has(match[1])) iconProblems.set(match[1], new Set([...(iconProblems.get(match[1]) ?? []), match[2]]));
  else problems.push(problem);
}
const fallbacks = [];
for (const [name, reasons] of iconProblems) {
  const index = result.findIndex((icon) => icon.name === name);
  if (index >= 0) result.splice(index, 1);
  const entry = published.find((icon) => icon.name === name);
  if (entry) result.push(entry);
  fallbacks.push(`${name} (${entry ? 'kept the published version' : 'left out'}): ${[...reasons].join('; ')}`);
}
result.sort((a, b) => a.name.localeCompare(b.name));

if (problems.length && lenient) {
  console.log(`Skipped ${problems.length}:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  problems.length = 0;
}
if (problems.length) {
  console.error(`${problems.length} problem(s):\n` + problems.join('\n'));
  process.exit(1);
}

writeFileSync(OUTPUT, JSON.stringify(result, null, 1) + '\n');
console.log(`Wrote ${result.length} icons in ${sections.length} categories. ${result.filter((i) => i.sizes).length} keep geometry as drawn at each size.`);
if (partial.size) console.log(`Missing sizes in Figma, so scaled from 16: ${[...partial].join(', ')}`);
if (skipped.size) console.log(`Skipped ${skipped.size} not listed in positions.json, so not released.`);
if (fallbacks.length) console.log(`Couldn't import ${fallbacks.length}:\n${fallbacks.map((f) => `  ${f}`).join('\n')}`);

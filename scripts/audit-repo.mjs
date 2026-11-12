#!/usr/bin/env node
// Checks the shipped icons and the repo itself, without Figma. scripts/audit.mjs reads the Figma file during a
// sync. This script covers the AUDIT.md checks that can be judged from the exported icons instead, plus checks
// on what the repo would publish. It needs no token and no network, so CI runs it on every push.
//
//   node scripts/audit-repo.mjs            Report. Exits 1 if there's an error.
//   node scripts/audit-repo.mjs --public   Also treat anything that mustn't be in a public repo as an error.
//   node scripts/audit-repo.mjs --json     Print the findings as JSON.
//
// Icon checks, from icons/icons.json (ids match icons/AUDIT.md):
//   A1  error  Aliases are valid names and don't collide with an icon's name or another alias.
//   A2  warn   An alias matches a record that's active or planned, so drawing it later would collide.
//   B5  error  An overlay badge's base is its parent's drawing, clipped at the badge, at every drawn size.
//   E2  error  Outside the badge, an overlay badge has nothing but its parent's geometry: no stray filled outlines.
//   E3  warn   At regular, and at black for icons with weights, ink stays inside the 16px viewBox. Every size scales it.
//   K4  warn   Open stroked paths have round caps. Chevrons and carets are exempt.
//   L1  warn   A slash icon has one straight two-point stroke, at least 9 long, within 8° of 45°.
//   L2  warn   Every other stroke in a slash icon stays at least 1.70 from the slash.
// Repo checks:
//   R1  Font files: tracked anywhere (warn, error with --public), or inside the package or public/ (error).
//   R2  error  Something that looks like a token, key, or password in a tracked file.
//   R3  Comparison-only material (SF Symbols, Iconic) tracked in git: warn, error with --public.
//   R4  error  Third-party icon geometry in what's generated for publishing, or another set named outside
//              the translation data (each icon's matches, and the `from` instructions).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIZES, WEIGHTS, bodyFor, hasWeights, strokeFor, weightFits } from '../lib/icon.mjs';
import { allRecords } from '../lib/records.mjs';
import { clipBody, elementToD, insideRoundRect, pathToSubpaths, pointAt } from './clip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const PUBLIC_MODE = args.has('--public');

// ---- Findings ----

class Findings {
  rows = [];
  add(check, severity, subject, detail) {
    this.rows.push({ check, severity, subject, detail });
  }
  get errors() {
    return this.rows.filter((row) => row.severity === 'error');
  }
  print() {
    const byCheck = Map.groupBy(this.rows, (row) => `${row.check} ${row.severity}`);
    for (const [key, rows] of [...byCheck].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`\n${key}: ${rows.length}`);
      for (const row of rows.slice(0, 40)) console.log(`  ${row.subject}: ${row.detail}`);
      if (rows.length > 40) console.log(`  …and ${rows.length - 40} more`);
    }
    const warns = this.rows.length - this.errors.length;
    console.log(`\n${this.errors.length} error${this.errors.length === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}.`);
  }
}

// ---- Geometry of exported bodies ----

const NUMBER = /-?\d*\.?\d+(?:e-?\d+)?/g;
const SAMPLES = 32;

// An element as the checks see it: whether it's stroked or filled, its cap and join, and its subpaths.
class Shape {
  constructor(markup) {
    this.markup = markup;
    this.tag = markup.match(/^<(\w+)/)[1];
    this.stroked = /stroke="currentColor"/.test(markup);
    this.filled = /fill="currentColor"/.test(markup);
    this.cap = markup.match(/stroke-linecap="(\w+)"/)?.[1] ?? 'butt';
    this.join = markup.match(/stroke-linejoin="(\w+)"/)?.[1] ?? 'miter';
    this.subpaths = pathToSubpaths(elementToD(markup));
  }
  static all(body) {
    return (body.match(/<(path|rect|circle|ellipse|line)\b[^>]*\/>/g) ?? []).map((markup) => new Shape(markup));
  }
  *points(subpaths = this.subpaths) {
    for (const sub of subpaths) for (const seg of sub.segs) for (let i = 0; i <= SAMPLES; i++) yield pointAt(seg, i / SAMPLES);
  }
  // Two shapes are the same drawing when their markup matches with numbers within the tolerance.
  sameAs(other, tolerance = 0.02) {
    if (this.markup.replace(NUMBER, '#') !== other.markup.replace(NUMBER, '#')) return false;
    const a = this.markup.match(NUMBER) ?? [], b = other.markup.match(NUMBER) ?? [];
    return a.length === b.length && a.every((n, i) => Math.abs(+n - +b[i]) <= tolerance);
  }
}

function distanceToSegment([px, py], [[ax, ay], [bx, by]]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const round = (n) => +n.toFixed(2);

// ---- Icon checks ----

const icons = JSON.parse(readFileSync(join(ROOT, 'icons/icons.json'), 'utf8'));
const byName = new Map(icons.map((icon) => [icon.name, icon]));
const records = new Map(allRecords().map((record) => [record.name, record]));
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DRAWN = [16, 18, 20, 22, 24];
// The overlay badge's Cutout on the 16px grid, as positions.json records it. It scales with the size.
const CUT_16 = [9.55, 9.55, 5.401, 5.401, 1];
const cutAt = (size) => CUT_16.map((n) => n * (size / 16));
const okFor = (name, check) => records.get(name)?.flags?.includes(`audit-ok:${check}`);

function checkAliases(findings) {
  const owner = new Map();
  for (const icon of icons) {
    for (const alias of icon.aliases) {
      if (!NAME.test(alias)) findings.add('A1', 'error', icon.name, `alias "${alias}" isn't lowercase words joined by hyphens`);
      if (byName.has(alias)) findings.add('A1', 'error', icon.name, `alias "${alias}" is also an icon's name`);
      if (owner.has(alias)) findings.add('A1', 'error', icon.name, `alias "${alias}" also belongs to ${owner.get(alias)}`);
      owner.set(alias, icon.name);
      const record = records.get(alias);
      if (record && ['active', 'planned'].includes(record.status)) findings.add('A2', 'warn', icon.name, `alias "${alias}" has its own ${record.status} record, so drawing it would collide`);
    }
  }
  return owner.size;
}

function checkBadges(findings) {
  let checked = 0;
  for (const icon of icons) {
    const parentName = records.get(icon.name)?.parent;
    if (!/-overlay$/.test(icon.name) || !parentName) continue;
    const parent = byName.get(parentName);
    if (!parent) {
      findings.add('B5', 'error', icon.name, `parent ${parentName} isn't in icons.json`);
      continue;
    }
    checked++;
    for (const size of DRAWN) {
      const cut = cutAt(size);
      const mine = Shape.all(bodyFor(icon, size));
      const expected = Shape.all(clipBody(bodyFor(parent, size), cut));
      const missing = expected.filter((shape) => !mine.some((other) => other.sameAs(shape)));
      if (missing.length) findings.add('B5', 'error', icon.name, `${size}px: ${missing.length} of ${parentName}'s ${expected.length} clipped shapes are missing or moved`);
      // Anything else must sit in the badge: its border and glyph. A filled shape elsewhere is an outline left from Body.
      const [x, y, w, h] = cut, pad = 0.6 * (size / 16);
      const inBadge = (shape) => [...shape.points()].every(([px, py]) => px >= x - pad && py >= y - pad && px <= x + w + pad && py <= y + h + pad);
      for (const shape of mine) {
        if (expected.some((other) => other.sameAs(shape)) || inBadge(shape)) continue;
        if (shape.filled) findings.add('E2', 'error', icon.name, `${size}px: a filled shape outside the badge isn't part of ${parentName}`);
        else findings.add('B5', 'error', icon.name, `${size}px: a stroke outside the badge isn't part of ${parentName}`);
      }
    }
  }
  return checked;
}

const SLASH_NAMES = new Set(['unplug', 'unpin', 'clear-format']);
const NOT_SLASH = /^(prohibit|close|arrow-.*|feather|leaf|auto-fix|percent|exposure|slash|slash-circle)$/;
const isSlashIcon = (name) => (/-off$/.test(name) || SLASH_NAMES.has(name)) && !NOT_SLASH.test(name);

function checkSlashes(findings) {
  let checked = 0;
  for (const icon of icons.filter((i) => isSlashIcon(i.name))) {
    checked++;
    const shapes = Shape.all(icon.body);
    const straight = shapes.filter((s) => s.stroked).flatMap((shape) => shape.subpaths
      .filter((sub) => sub.segs.length === 1 && sub.segs[0].type === 'L')
      .map((sub) => ({ shape, sub, line: sub.segs[0].p })));
    const slashes = straight.filter(({ line: [[ax, ay], [bx, by]] }) => {
      const angle = (Math.abs(Math.atan2(by - ay, bx - ax)) * 180) / Math.PI;
      return Math.hypot(bx - ax, by - ay) >= 9 && Math.min(Math.abs(angle - 45), Math.abs(angle - 135)) <= 8;
    });
    if (!slashes.length) {
      if (!okFor(icon.name, 'L1')) findings.add('L1', 'warn', icon.name, 'no straight two-point stroke at least 9 long near 45°');
      continue;
    }
    const length = ({ line: [[ax, ay], [bx, by]] }) => Math.hypot(bx - ax, by - ay);
    const slash = slashes.reduce((a, b) => (length(b) > length(a) ? b : a));
    let closest = Infinity;
    for (const shape of shapes) {
      const subs = shape.subpaths.filter((sub) => sub !== slash.sub);
      if (!subs.length) continue;
      const distances = [...shape.points(subs)].map((p) => distanceToSegment(p, slash.line));
      // A filled dot only counts when it sits wholly inside the band.
      const d = shape.stroked ? Math.min(...distances) : Math.max(...distances);
      if (shape.stroked || d < 1.7) closest = Math.min(closest, d);
    }
    if (closest < 1.7 && !okFor(icon.name, 'L2')) findings.add('L2', 'warn', icon.name, `a stroke comes within ${round(closest)} of the slash`);
  }
  return checked;
}

// Ink reaches half the line width past the centreline, or further at a mitred corner.
function checkInk(findings) {
  for (const icon of icons) {
    if (okFor(icon.name, 'E3')) continue;
    const problems = [];
    // Every size is the 16px drawing scaled up, lines included, so checking 16 checks them all.
    for (const size of [16]) {
      const widths = hasWeights(icon) ? [strokeFor('regular'), strokeFor('black')] : [1];
      const shapes = Shape.all(bodyFor(icon, size));
      for (const width of widths) {
        let worst = 0;
        for (const shape of shapes) {
          const reach = shape.stroked ? (width / 2) * (shape.join === 'round' ? 1 : Math.SQRT2) : 0;
          for (const [x, y] of shape.points()) worst = Math.max(worst, reach - x, reach - y, x + reach - size, y + reach - size);
        }
        if (worst > 0.01) problems.push(`${size}px at ${width}px is ${round(worst)} past the edge`);
      }
    }
    if (problems.length) findings.add('E3', 'warn', icon.name, problems.slice(0, 3).join('; ') + (problems.length > 3 ? `; and ${problems.length - 3} more` : ''));
  }
}

const OPEN_CAP_EXEMPT = /^(chevron|caret)/;
function checkCaps(findings) {
  for (const icon of icons) {
    if (OPEN_CAP_EXEMPT.test(icon.name) || okFor(icon.name, 'K4')) continue;
    const bodies = [icon.body, ...Object.values(icon.sizes ?? {})];
    const open = bodies.flatMap(Shape.all).filter((s) => s.stroked && ['path', 'line'].includes(s.tag) && s.cap !== 'round' && s.subpaths.some((sub) => !sub.closed));
    if (open.length) findings.add('K4', 'warn', icon.name, `${open.length} open stroke${open.length === 1 ? ' has a' : 's have'} ${open[0].cap} caps`);
  }
}

// ---- Repo checks ----

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const tracked = () => git('ls-files').split('\n').filter(Boolean);
const FONT = /\.(woff2?|ttf|otf|eot)$/i;

// Patterns for credentials. The value is never printed, only the file, line, and kind.
export const SECRET_RULES = [
  ['Figma token', /figd_[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['API key', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}|\b[sr]k_(live|test)_[A-Za-z0-9]{16,}|\bAIza[0-9A-Za-z_-]{35}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['URL with a password', /[a-z]+:\/\/[^\s/:@'"`]+:[^\s/@'"`$]+@[^\s'"`]+/i],
  ['password in code', /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s$<{]{6,}['"]/i],
  ['password hash', /\$apr1\$|\$2[aby]\$\d\d\$/],
];

function checkFonts(findings) {
  const fonts = tracked().filter((file) => FONT.test(file));
  for (const file of fonts) findings.add('R1', PUBLIC_MODE ? 'error' : 'warn', file, 'font file is tracked; licensed fonts must not be in a public repo or its history');
  const publicDir = join(ROOT, 'public');
  if (!existsSync(publicDir)) return;
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of walk(publicDir)) {
    if (FONT.test(file)) findings.add('R1', 'error', file.slice(ROOT.length + 1), 'font file in generated public files');
    if (file.endsWith('.tgz')) {
      const listing = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
      for (const entry of listing.filter((e) => FONT.test(e))) findings.add('R1', 'error', `${file.slice(ROOT.length + 1)}:${entry}`, 'font file in the npm package');
    }
  }
}

function checkSecrets(findings) {
  const skip = /(^|\/)package-lock\.json$|\.(woff2?|png|jpe?g|gif|ico|tgz)$/;
  let files = 0;
  for (const file of tracked()) {
    if (skip.test(file) || !existsSync(join(ROOT, file))) continue;
    files++;
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      for (const [kind, pattern] of SECRET_RULES) if (pattern.test(line)) findings.add('R2', 'error', `${file}:${i + 1}`, `looks like a ${kind}`);
    });
  }
  return files;
}

// Comparison sets stay local. The tools that read them are tracked, which is fine privately but not publicly.
const COMPARISON_ONLY = [/^\.workbench\//, /^workbench\/sf-render\.swift$/, /^workbench\/sets\/(sf|iconic)\.json$/, /^workbench\/fetch-iconic\.mjs$/];
function checkComparisonMaterial(findings) {
  for (const file of tracked()) {
    if (!COMPARISON_ONLY.some((pattern) => pattern.test(file))) continue;
    const always = file.startsWith('.workbench/');
    findings.add('R3', always || PUBLIC_MODE ? 'error' : 'warn', file, always ? 'rendered comparison material is tracked' : 'comparison-only tool; leave it out of the public repo');
  }
}

// No other set's drawings may reach the output: no file and no path data, even rescaled to its grid.
// Other sets' icon names may ship only as translation data, for `standardicon from <set> <name>`: each
// icon's matches and also in icons.json, and the lines that explain the command. Anywhere else is an error.
function checkThirdParty(findings) {
  const lucide = join(ROOT, 'node_modules/lucide-static/icons');
  if (!existsSync(lucide)) return;
  const theirs = new Set();
  for (const file of readdirSync(lucide)) for (const [, d] of readFileSync(join(lucide, file), 'utf8').matchAll(/\sd="([^"]{12,})"/g)) theirs.add(d.replace(/\s+/g, ' ').trim());
  const scale = (d, k) => d.replace(NUMBER, (n) => String(+(+n * k).toFixed(2))).replace(/\s+/g, ' ').trim();
  for (const icon of icons) {
    for (const body of [icon.body, ...Object.values(icon.sizes ?? {})]) {
      for (const [, d] of body.matchAll(/\sd="([^"]+)"/g)) {
        if (theirs.has(d.replace(/\s+/g, ' ').trim()) || theirs.has(scale(d, 1.5))) findings.add('R4', 'error', icon.name, 'a path matches one in lucide-static');
      }
    }
  }
  const publicDir = join(ROOT, 'public');
  if (existsSync(publicDir)) {
    let hits = [];
    try {
      hits = execFileSync('grep', ['-rIli', '-E', 'lucide|sf symbols|iconic', publicDir], { encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch {
      // grep exits 1 when nothing matches, which is the good case.
    }
    for (const file of hits) {
      const rest = readFileSync(file, 'utf8')
        .replace(/"(matches|also)":\{[^{}]*\}/g, '')
        .split('\n')
        .filter((line) => !/\bfrom (lucide|phosphor|material|tabler|heroicons|radix|octicons|fluent|carbon)\b|It knows Lucide/.test(line))
        .join('\n');
      if (/lucide|sf symbols|iconic/i.test(rest)) findings.add('R4', 'error', file.slice(ROOT.length + 1), 'names another set outside the translation data');
    }
  }
}

// ---- Run ----

const findings = new Findings();
const aliases = checkAliases(findings);
const badges = checkBadges(findings);
const slashes = checkSlashes(findings);
checkInk(findings);
checkCaps(findings);
checkFonts(findings);
const scanned = checkSecrets(findings);
checkComparisonMaterial(findings);
checkThirdParty(findings);

if (args.has('--json')) console.log(JSON.stringify(findings.rows, null, 2));
else {
  console.log(`Checked ${icons.length} icons, ${aliases} aliases, ${badges} overlay badges, ${slashes} slash icons, and ${scanned} tracked files${PUBLIC_MODE ? ' for a public repo' : ''}.`);
  findings.print();
}
process.exit(findings.errors.length ? 1 : 0);

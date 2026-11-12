#!/usr/bin/env node
// The icon workbench: a local tool for comparing the set with others, keeping each icon's record, and running
// the sync. Run with `npm run workbench`. It only listens on this machine and isn't part of the site.
// Records live in files, so `npm run icon` and agents can change them while this runs: it re-reads when they do.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveIcon, borderQueue, unapproveIcon } from '../lib/records.mjs';
import { addAlsoMatch, FLAGS, ISSUES_DIR, RECORDS_DIR, STATUSES, addNote, allIssues, allRecords, clearNeedsRevision, commentOnIssue, createIssue, createRecord, filterRecords, gaps, issueStream, issueStreamFor, markNeedsRevision, patchIssue, planIcon, patchRecord, readObserved, readRecord, renameRecord, searchRecords, withObserved } from '../lib/records.mjs';
import { keywordsFor } from '../scripts/keywords.mjs';
import { historyOf } from '../lib/history.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT ?? 4180);
// Pages allowed to make changes: this Mac, and its own Tailscale address, where `tailscale serve` shares the
// workbench with your other devices on the same port. Only devices on your tailnet can open that address.
const TAILSCALE = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'tailscale'];
function tailnetName() {
  for (const bin of TAILSCALE) {
    try {
      return JSON.parse(execFileSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })).Self?.DNSName?.replace(/\.$/, '') || null;
    } catch {}
  }
  return null;
}
const TAILNET = tailnetName();
const ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, ...(TAILNET ? [`https://${TAILNET}:${PORT}`] : [])]);
const CACHE = join(ROOT, '.workbench');
const SF_CACHE = join(CACHE, 'sf');
const SF_BIN = join(CACHE, 'sf-render');
const GLYPHS = '/System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources';
const SETS_DIR = join(HERE, 'sets');
const FIGMA = 'https://www.figma.com/design/5OZ0QO2xXZJH2OYmTagAW5/mak-icons';
mkdirSync(SF_CACHE, { recursive: true });

const SIZE_REVIEW = join(ROOT, 'icons/size-review.json');
// The launch checklist (LAUNCH.html) at /launch, with its checkmarks saved in the repo so they follow you
// between the Mac and the phone and survive a cleared browser.
const LAUNCH_PAGE = join(ROOT, 'LAUNCH.html');
const LAUNCH_PROGRESS = join(ROOT, 'launch-progress.json');
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
// Each comparison set is one config file in workbench/sets/. A folder of SVGs needs nothing else.
const setConfigs = readdirSync(SETS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(SETS_DIR, f))).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, (error, stdout) => (error ? reject(error) : resolve(stdout))));

// ---- SF Symbols, from the copy in macOS ----

async function sfCatalog() {
  const load = async (file) => {
    const out = join(CACHE, `${file}.json`);
    if (!existsSync(out)) await run('plutil', ['-convert', 'json', '-o', out, join(GLYPHS, `${file}.plist`)]);
    return readJson(out, null);
  };
  try {
    return { names: await load('symbol_order'), search: await load('symbol_search') };
  } catch {
    return { names: [], search: {} };
  }
}
if (!existsSync(SF_BIN) || !existsSync(join(CACHE, 'sf-render.ok'))) {
  console.log('Compiling the SF Symbols renderer…');
  await run('swiftc', ['-O', join(HERE, 'sf-render.swift'), '-o', SF_BIN]);
  writeFileSync(join(CACHE, 'sf-render.ok'), '');
}
const sf = await sfCatalog();
const sfNames = new Set(sf.names);

// One render at a time per symbol, and a few at once overall.
const SF_WEIGHTS = new Set(['ultralight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black']);
const pending = new Map();
const queue = [];
let active = 0;
function pump() {
  while (active < 6 && queue.length) {
    const job = queue.shift();
    active++;
    execFile(SF_BIN, job.args, (error) => {
      active--;
      error ? job.reject(error) : job.resolve();
      pump();
    });
  }
}
function renderSf(name, weight) {
  const file = join(SF_CACHE, `${name}@${weight}.png`);
  if (existsSync(file)) return Promise.resolve(file);
  if (!pending.has(file)) {
    pending.set(file, new Promise((resolve, reject) => {
      queue.push({ args: [name, weight, file], resolve: () => resolve(file), reject });
      pump();
    }).finally(() => pending.delete(file)));
  }
  return pending.get(file);
}

// ---- Sets drawn as folders of SVGs ----

const svgSets = new Map();
for (const config of setConfigs.filter((c) => c.kind === 'svg')) {
  const dir = join(ROOT, config.dir);
  if (!existsSync(dir)) {
    console.log(`Skipping ${config.title}: ${config.dir} isn't there.`);
    continue;
  }
  const names = readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));
  svgSets.set(config.id, { config, dir, names, known: new Set(names), tags: config.tags ? readJson(join(ROOT, config.tags), {}) : {} });
}
const sets = setConfigs.filter((c) => c.kind === 'sf-symbols' || svgSets.has(c.id));

// ---- Best guesses at each icon's counterpart. Picks made in the workbench override these. ----

// How this set's words map onto each library's vocabulary. Other sets keep theirs in their config.
const SF_WORDS = {
  home: ['house'], search: ['magnifyingglass'], close: ['xmark'], x: ['xmark'], check: ['checkmark'], settings: ['gearshape'], mail: ['envelope'],
  edit: ['pencil'], copy: ['document', 'on', 'document'], file: ['document'], files: ['document', 'on', 'document'], attach: ['paperclip'], share: ['square', 'and', 'arrow', 'up'],
  message: ['message'], messages: ['bubble', 'left', 'and', 'bubble', 'right'], oval: ['bubble'], trash: ['trash'], delete: ['delete', 'left'], unlock: ['lock', 'open'],
  download: ['arrow', 'down', 'to', 'line'], upload: ['arrow', 'up', 'to', 'line'], chart: ['chart'], bar: ['bar'], more: ['ellipsis'], menu: ['line', '3', 'horizontal'],
  alert: ['exclamationmark'], question: ['questionmark'], help: ['questionmark'], minus: ['minus'], plus: ['plus'], left: ['left'], right: ['right'], up: ['up'], down: ['down'],
  sun: ['sun', 'max'], moon: ['moon'], image: ['photo'], person: ['person'], people: ['person', '2'], clock: ['clock'], time: ['clock'], video: ['video'], music: ['music', 'note'],
  money: ['dollarsign'], dollar: ['dollarsign'], card: ['creditcard'], credit: ['creditcard'], globe: ['globe'], link: ['link'], map: ['map'], pin: ['mappin'], filter: ['line', '3', 'horizontal', 'decrease'],
  off: ['slash'], sliders: ['slider', 'horizontal', '3'], grid: ['square', 'grid', '2x2'], layers: ['square', '3', 'layers', '3d'], eye: ['eye'], code: ['chevron', 'left', 'forwardslash', 'chevron', 'right'],
  bold: ['bold'], italic: ['italic'], underline: ['underline'], strikethrough: ['strikethrough'], undo: ['arrow', 'uturn', 'backward'], redo: ['arrow', 'uturn', 'forward'], refresh: ['arrow', 'clockwise'], sync: ['arrow', 'triangle', '2', 'circlepath'],
  folder: ['folder'], book: ['book'], heart: ['heart'], star: ['star'], tag: ['tag'], lock: ['lock'], bell: ['bell'], phone: ['phone'], camera: ['camera'], play: ['play'], pause: ['pause'], stop: ['stop'], wifi: ['wifi'], cloud: ['cloud'],
};
const nonFill = sf.names.filter((n) => !/\.fill(\.|$)/.test(n));
const sfTokens = new Map(nonFill.map((n) => [n, n.split('.')]));
const sfIndex = new Map();
for (const [name, tokens] of sfTokens) for (const t of new Set(tokens)) (sfIndex.get(t) ?? sfIndex.set(t, []).get(t)).push(name);
// Apple's own search terms catch what the names don't, such as "house" for home.
const sfTerms = new Map();
for (const [name, terms] of Object.entries(sf.search)) {
  if (!sfTokens.has(name)) continue;
  for (const term of terms) (sfTerms.get(term) ?? sfTerms.set(term, []).get(term)).push(name);
}

function overlapScore(wanted, have) {
  const set = new Set(have);
  const hits = wanted.filter((t) => set.has(t)).length;
  if (!hits) return 0;
  const missed = wanted.length - hits, extra = Math.max(0, have.length - hits);
  return hits * 10 - missed * 6 - extra * 2.5;
}
function top(scored, count = 6) {
  return scored.filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, count).map(([n]) => n);
}
function guessSvg(set, icon) {
  const wordMap = set.config.words ?? {};
  const words = icon.name.split('-').flatMap((t) => (wordMap[t] ?? t).split('-'));
  const scored = new Map();
  for (const name of set.names) {
    const have = name.split('-');
    let score = overlapScore(words, have);
    if (score > 0 && have.includes(words[0])) score += 1; // on a tie, heart-plus is a heart before it's a plus
    if (score > 0 && new Set(words).size === new Set(have).size && words.every((w) => have.includes(w))) score += 50; // the same words in any order
    if (set.tags[name]?.includes(icon.name)) score += 12;
    if (score > 0) scored.set(name, score);
  }
  for (const alias of [icon.name, ...(icon.aliases ?? [])]) if (set.known.has(alias)) scored.set(alias, (scored.get(alias) ?? 0) + 100);
  return top([...scored]);
}
function guessSf(icon) {
  const words = icon.name.split('-').flatMap((t) => SF_WORDS[t] ?? [t]);
  // The first word is usually the object, as in folder-x, so it counts for more than a modifier.
  const lead = (SF_WORDS[icon.name.split('-')[0]] ?? [icon.name.split('-')[0]])[0];
  const scored = new Map();
  const plain = icon.name.split('-');
  for (const name of new Set([...words.flatMap((t) => sfIndex.get(t) ?? []), ...plain.flatMap((t) => sfTerms.get(t) ?? [])])) {
    const have = sfTokens.get(name);
    let score = overlapScore(words, have);
    if (have[0] === lead) score += 8;
    const terms = sf.search[name] ?? [];
    score += plain.filter((t) => terms.includes(t)).length * 4 - (have.length > 3 ? 1 : 0);
    if (score > 0) scored.set(name, score);
  }
  // An exact name, spelled either way, beats any partial match.
  for (const exact of [icon.name.replace(/-/g, '.'), words.join('.')]) if (sfNames.has(exact)) scored.set(exact, (scored.get(exact) ?? 0) + 100);
  return top([...scored]);
}

// ---- Everything the page needs. Rebuilt only when a file behind it changes. ----

const guessCache = new Map();
function guessesFor(setId, icon) {
  const key = `${setId}:${icon.name}`;
  if (!guessCache.has(key)) guessCache.set(key, setId === 'sf' ? guessSf(icon) : guessSvg(svgSets.get(setId), icon));
  return guessCache.get(key);
}

const WATCHED = [RECORDS_DIR, ISSUES_DIR, join(ROOT, 'icons/icons.json'), join(ROOT, 'icons/RULES.md'), join(ROOT, '.sync/status.json'), join(ROOT, '.sync/all-icons.json'), join(ROOT, '.sync/report.json'), join(ROOT, '.sync/audit.json'), join(HERE, 'duplicates.json'), join(HERE, 'line-stacks.json')];
// Records are replaced by rename, so the folder's time changes with every write.
const stamp = () => WATCHED.map((path) => (existsSync(path) ? statSync(path).mtimeMs : 0)).join('-');

function matchesFor(icon, record) {
  return Object.fromEntries(sets.map((set) => {
    const alts = guessesFor(set.id, icon);
    const saved = record?.compare?.[set.id];
    return [set.id, { current: saved === false ? null : saved ?? alts[0] ?? null, alts, picked: Boolean(saved), none: saved === false }];
  }));
}

function buildData() {
  const released = readJson(join(ROOT, 'icons/icons.json'), []);
  const all = readJson(join(ROOT, '.sync/all-icons.json'), released);
  const releasedNames = new Set(released.map((i) => i.name));
  // Icons on the site always show their shipping version.
  const byName = new Map(all.map((i) => [i.name, i]));
  for (const icon of released) byName.set(icon.name, icon);
  const observed = readObserved();
  const records = allRecords().map((record) => withObserved(record, observed));
  const recordFor = new Map(records.map((record) => [record.name, record]));
  const icons = [...byName.values()].map((icon) => ({
    ...icon,
    keywords: keywordsFor({ ...icon, aliases: icon.aliases ?? [] }, recordFor.get(icon.name) ?? {}),
    released: releasedNames.has(icon.name),
    status: observed[icon.name] ?? null,
    matches: matchesFor(icon, recordFor.get(icon.name)),
  })).sort((a, b) => a.name.localeCompare(b.name));
  const rules = join(ROOT, 'icons/RULES.md');
  return {
    icons,
    records,
    issues: allIssues(),
    rules: existsSync(rules) ? readFileSync(rules, 'utf8') : '',
    flags: FLAGS,
    statuses: STATUSES,
    sets: sets.map((set) => ({ ...set, names: set.kind === 'svg' ? svgSets.get(set.id).names : nonFill, primary: set.kind === 'svg' && Object.keys(svgSets.get(set.id).tags).length ? Object.keys(svgSets.get(set.id).tags) : null, tags: set.kind === 'svg' ? svgSets.get(set.id).tags : {} })),
    sfAvailable: sf.names.length > 0,
    report: readJson(join(ROOT, '.sync/report.json'), null),
    audit: readJson(join(ROOT, '.sync/audit.json'), []),
    duplicates: readJson(join(HERE, 'duplicates.json'), []),
    lineStacks: readJson(join(HERE, 'line-stacks.json'), []),
    hasReview: existsSync(join(ROOT, '.sync/review.html')),
    figma: FIGMA,
  };
}
let cached = { stamp: null, json: null };
function dataJson() {
  const now = stamp();
  if (cached.stamp !== now) cached = { stamp: now, json: JSON.stringify(buildData()) };
  return cached.json;
}
dataJson();

// ---- Tools: fixed commands only, streamed back as text ----

const TOOLS = {
  sync: ['npm', ['run', 'sync']],
  'sync-changed': ['npm', ['run', 'sync', '--', '--changed']],
  'sync-build': ['npm', ['run', 'sync', '--', '--build']],
  // Everything pink goes live on standardicon.com: sync, test the deploy build, commit the icon data, preview, push.
  ship: ['npm', ['run', 'ship']],
  check: ['npm', ['run', 'check']],
  build: ['npm', ['run', 'build']],
};
let running = null;

// ---- Server ----

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const send = (res, code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
const SAFE = /^[a-z0-9][a-z0-9.-]*$/;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    // The Figma plugin's buttons: sync everything, or just the selected icons, then build the site. Its sandbox
    // sends the origin "null", so this one route accepts that (or no origin, for scripts on this machine) and
    // nothing else. The custom header forces a preflight, so a plain form post from a web page can't start a sync.
    // It can only start a sync, and each name is checked.
    // The Figma plugin again: a border changed by hand in Figma. Pink approves, dashed orange marks the icon for
    // revision, blue takes both back. Same origin and header rules as the sync route below.
    if (path === '/api/plugin/border' && (req.method === 'POST' || req.method === 'OPTIONS')) {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Workbench-Plugin', Vary: 'Origin' };
      const reply = (code, text) => { res.writeHead(code, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
      if (origin !== undefined && origin !== 'null') return send(res, 403, 'Forbidden');
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.headers['x-workbench-plugin'] !== '1') return reply(403, 'Forbidden');
      let body = '';
      for await (const chunk of req) body += chunk;
      const { name, figmaId, border } = JSON.parse(body || '{}');
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '')) return reply(400, 'Not an icon name.');
      const record = readRecord(name);
      if (!record) return reply(404, `No record for ${name}.`);
      if (figmaId && record.figmaId && record.figmaId !== figmaId) return reply(409, `${name} in the workbench is a different Figma layer.`);
      const by = 'Morgan (Figma)';
      try {
        if (border === 'pink') approveIcon(name, by);
        else if (border === 'revision') { if (!record.flags?.includes('needs-revision')) markNeedsRevision(name, by); }
        else if (border === 'blue') {
          if (record.approved) unapproveIcon(name);
          if (readRecord(name).flags?.includes('needs-revision')) clearNeedsRevision(name, by);
        } else return reply(400, 'Border must be pink, revision or blue.');
      } catch (error) {
        // An icon that's never been synced has nothing to approve yet, but its pink border ships it anyway.
        if (border === 'pink' && /no drawing in the history/.test(error.message)) return reply(200, 'Pink in Figma; it ships on the next sync.');
        return reply(400, error.message);
      }
      return reply(200, 'OK');
    }
    if (path === '/api/plugin/sync' && (req.method === 'POST' || req.method === 'OPTIONS')) {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Workbench-Plugin', Vary: 'Origin' };
      if (origin !== undefined && origin !== 'null') return send(res, 403, 'Forbidden');
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.headers['x-workbench-plugin'] !== '1') { res.writeHead(403, cors); return res.end('Forbidden'); }
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || '{}');
      const ship = input.ship === true;
      const names = ship ? [] : [...new Set((input.names ?? []).map(String))];
      const bad = names.filter((n) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n));
      const reply = (code, text) => { res.writeHead(code, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
      if (bad.length) return reply(400, `Not icon names: ${bad.slice(0, 5).join(', ')}`);
      if (running) return reply(409, `${running} is already running.`);
      running = ship ? 'Shipping' : names.length ? `Syncing ${names.length} from Figma` : 'Syncing everything from Figma';
      res.writeHead(200, { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      const child = spawn('npm', ship ? ['run', 'ship'] : ['run', 'sync', '--', ...(names.length ? ['--only', names.join(',')] : []), '--build'], { cwd: ROOT });
      child.stdout.on('data', (d) => res.write(d));
      child.stderr.on('data', (d) => res.write(d));
      child.on('close', (code) => {
        running = null;
        res.end(`\n[finished with exit code ${code}]\n`);
      });
      return;
    }
    if (req.method !== 'GET') {
      // Browsers always send an Origin on these, so this stops other sites. Agents on this machine send none.
      const origin = req.headers.origin;
      if (origin && !ORIGINS.has(origin)) return send(res, 403, 'Forbidden');
      // The Sizes view: keep, square or circle for each undersized icon, saved in the repo for growing in Figma.
      if (path === '/api/size-review' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { name, choice } = JSON.parse(body || '{}');
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '')) return send(res, 400, 'Bad icon name.');
        if (choice !== null && !['keep', 'square', 'circle'].includes(choice)) return send(res, 400, 'Choose keep, square or circle.');
        const review = readJson(SIZE_REVIEW, {});
        if (choice) review[name] = { choice, at: new Date().toISOString() };
        else delete review[name];
        const sorted = Object.fromEntries(Object.entries(review).sort(([a], [b]) => a.localeCompare(b)));
        writeFileSync(SIZE_REVIEW, `${JSON.stringify(sorted, null, 2)}\n`);
        return send(res, 200, JSON.stringify(sorted), TYPES['.json']);
      }
      if (path === '/api/launch' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { id, done, reset } = JSON.parse(body || '{}');
        const progress = reset ? {} : readJson(LAUNCH_PROGRESS, {});
        if (!reset) {
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id ?? '') || typeof done !== 'boolean') return send(res, 400, 'Send a task id and done: true or false.');
          progress[id] = { done, at: new Date().toISOString() };
        }
        const sorted = Object.fromEntries(Object.entries(progress).sort(([a], [b]) => a.localeCompare(b)));
        writeFileSync(LAUNCH_PROGRESS, `${JSON.stringify(sorted, null, 2)}\n`);
        return send(res, 200, JSON.stringify(sorted), TYPES['.json']);
      }
      if (path.startsWith('/api/records') || path.startsWith('/api/issues')) {
        let body = '';
        for await (const chunk of req) body += chunk;
        const input = body ? JSON.parse(body) : {};
        const reply = (value) => send(res, 200, JSON.stringify(value), TYPES['.json']);
        const [, issue, issueAction] = path.match(/^\/api\/issues\/([a-z0-9-]+)(?:\/(comment))?$/) ?? [];
        const [, name, action] = path.match(/^\/api\/records\/([a-z0-9-]+)(?:\/(note|rename|revision|also|approve))?$/) ?? [];
        try {
          if (path === '/api/issues' && req.method === 'POST') return reply(createIssue(input));
          if (issue && issueAction === 'comment' && req.method === 'POST') return reply(commentOnIssue(issue, input.text, input.by));
          if (issue && !issueAction && req.method === 'PATCH') {
            const { by, ...changes } = input;
            return reply(patchIssue(issue, changes, by));
          }
          if (path === '/api/records/plan' && req.method === 'POST') return reply(withObserved(planIcon(input.name, input)));
          if (path === '/api/records' && req.method === 'POST') return reply(createRecord(input.name, { ...input, name: undefined }));
          if (name && !action && req.method === 'PATCH') return reply(withObserved(patchRecord(name, input)));
          if (name && action === 'note' && req.method === 'POST') return reply(withObserved(addNote(name, input.text, input.by)));
          if (name && action === 'also' && req.method === 'POST') return reply(withObserved(addAlsoMatch(name, input.set, input.match)));
          if (name && action === 'revision' && req.method === 'POST') return reply(withObserved(input.undo ? clearNeedsRevision(name, input.by) : markNeedsRevision(name, input.by)));
          if (name && action === 'approve' && req.method === 'POST') return reply(withObserved(input.undo ? unapproveIcon(name) : approveIcon(name, input.by)));
          if (name && action === 'rename' && req.method === 'POST') return reply(withObserved(renameRecord(name, input.to)));
        } catch (error) {
          return send(res, 400, error.message);
        }
        return send(res, 404, 'Not found');
      }
      // The server opens the Figma app, because not every browser will follow a figma:// link.
      if (path === '/api/open-figma' && req.method === 'POST') {
        const node = url.searchParams.get('node');
        if (node && !/^\d+[:-]\d+$/.test(node)) return send(res, 400, 'Bad node id.');
        const address = `${FIGMA.replace('https://www.figma.com/design/', 'figma://file/')}${node ? `?node-id=${node.replace(':', '-')}` : ''}`;
        await run('open', [address]);
        return send(res, 200, 'Opened');
      }
      const tool = path.match(/^\/api\/run\/([a-z-]+)$/)?.[1];
      // Sync one icon, including one that's never been synced. The name comes from the page, so check it.
      const oneIcon = tool === 'sync-one' ? url.searchParams.get('name') : null;
      if (tool === 'sync-one' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(oneIcon ?? '')) return send(res, 400, 'Bad icon name.');
      if (req.method === 'POST' && tool && (TOOLS[tool] || oneIcon)) {
        if (running) return send(res, 409, `${running} is already running.`);
        running = oneIcon ? `Syncing ${oneIcon}` : tool;
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        const [command, args] = oneIcon ? ['npm', ['run', 'sync', '--', '--only', oneIcon]] : TOOLS[tool];
        const child = spawn(command, args, { cwd: ROOT });
        child.stdout.on('data', (d) => res.write(d));
        child.stderr.on('data', (d) => res.write(d));
        child.on('close', (code) => {
          running = null;
          res.end(`\n[finished with exit code ${code}]\n`);
        });
        return;
      }
      return send(res, 404, 'Not found');
    }
    if (path === '/api/data') return send(res, 200, dataJson(), TYPES['.json']);
    if (path === '/api/stamp') return send(res, 200, stamp());
    // For the Figma plugin, which keeps borders in step with the workbench: pink when approved, dashed orange when marked for revision. Read-only, and the plugin's sandbox has no origin, hence the open CORS header.
    if (path === '/api/borders') {
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(borderQueue()));
    }
    if (path === '/api/size-review') return send(res, 200, JSON.stringify(readJson(SIZE_REVIEW, {})), TYPES['.json']);
    if (path === '/api/launch') return send(res, 200, JSON.stringify(readJson(LAUNCH_PROGRESS, {})), TYPES['.json']);
    if (path === '/launch' || path === '/launch/') return send(res, 200, readFileSync(LAUNCH_PAGE, 'utf8'), 'text/html; charset=utf-8');
    if (path === '/api/history') return send(res, 200, JSON.stringify(historyOf(url.searchParams.get('name') ?? '')), TYPES['.json']);
    if (path === '/api/sets') return send(res, 200, JSON.stringify(sets), TYPES['.json']);
    if (path === '/api/issues/stream') {
      const reader = url.searchParams.get('as');
      return send(res, 200, JSON.stringify(reader ? issueStreamFor(reader) : issueStream(url.searchParams.get('since'))), TYPES['.json']);
    }
    if (path === '/api/issues') return send(res, 200, JSON.stringify(allIssues()), TYPES['.json']);
    if (path === '/api/find') return send(res, 200, JSON.stringify(searchRecords(url.searchParams.get('q') ?? '').map((r) => withObserved(r))), TYPES['.json']);
    if (path === '/api/records') return send(res, 200, JSON.stringify(filterRecords(Object.fromEntries(url.searchParams))), TYPES['.json']);
    const recordName = path.match(/^\/api\/records\/([a-z0-9-]+)$/)?.[1];
    if (recordName) {
      const record = readRecord(recordName);
      return record ? send(res, 200, JSON.stringify(withObserved(record)), TYPES['.json']) : send(res, 404, 'No record for that icon.');
    }
    const gapSet = path.match(/^\/api\/gaps\/([a-z0-9-]+)$/)?.[1];
    if (gapSet) return send(res, 200, JSON.stringify(gaps(gapSet)), TYPES['.json']);
    if (path === '/review') {
      const file = join(ROOT, '.sync/review.html');
      return existsSync(file) ? send(res, 200, readFileSync(file), TYPES['.html']) : send(res, 404, 'Run the sync first.');
    }
    // The site's own fonts and logo, so the workbench uses the same design system.
    const font = path.match(/^\/fonts\/(Polymath[A-Za-z-]+\.woff2)$/)?.[1];
    if (font && existsSync(join(ROOT, 'app/fonts', font))) {
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400' });
      return res.end(readFileSync(join(ROOT, 'app/fonts', font)));
    }
    if (path === '/brand/logo-mark.svg') return send(res, 200, readFileSync(join(ROOT, 'site/logo-mark.svg')), TYPES['.svg']);
    if (path === '/lib/icon.mjs') return send(res, 200, readFileSync(join(ROOT, 'lib/icon.mjs')), TYPES['.mjs']);
    const svgIcon = path.match(/^\/set\/([a-z0-9-]+)\/([a-z0-9._-]+)\.svg$/);
    if (svgIcon) {
      const set = svgSets.get(svgIcon[1]);
      if (!set?.known.has(svgIcon[2])) return send(res, 404, 'Not found');
      let svg = readFileSync(join(set.dir, `${svgIcon[2]}.svg`), 'utf8');
      // ?sw= sets the line width, so a set can be compared at the weight being looked at.
      const width = Number(url.searchParams.get('sw'));
      if (width > 0 && width <= 8) svg = svg.replace(/stroke-width="[^"]*"/, `stroke-width="${width}"`);
      return send(res, 200, svg, TYPES['.svg']);
    }
    const symbol = path.match(/^\/sf\/([a-z0-9.]+)@([a-z]+)\.png$/);
    if (symbol) {
      if (!sfNames.has(symbol[1]) || !SF_WEIGHTS.has(symbol[2])) return send(res, 404, 'Not found');
      return send(res, 200, readFileSync(await renderSf(symbol[1], symbol[2])), TYPES['.png']);
    }
    const file = ['/', '/records', '/tools', '/weights', '/sizes'].includes(path) || /^\/(compare|issues)(\/[a-z0-9-]+)?$/.test(path) ? 'index.html' : path.slice(1);
    if (!/^[a-z.-]+$/.test(file) || !existsSync(join(HERE, 'public', file))) return send(res, 404, 'Not found');
    return send(res, 200, readFileSync(join(HERE, 'public', file)), TYPES[extname(file)] ?? 'text/plain');
  } catch (error) {
    if (!res.headersSent) send(res, 500, String(error.message ?? error));
    else res.end();
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Workbench: http://localhost:${PORT}${TAILNET ? `  ·  on your devices: https://${TAILNET}:${PORT}` : ''}  (${allRecords().length} records, comparing with ${sets.map((set) => set.title).join(' and ')})`));

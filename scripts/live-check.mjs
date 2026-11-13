#!/usr/bin/env node
// Checks the live site the way the launch checklist asks: links, content types,
// CORS, redirects, and whether Cloudflare rate limits or challenges anyone.
// Usage: node scripts/live-check.mjs [origin]   (Node 20+, no dependencies)
// Polite on purpose: at most 4 requests in flight, a few hundred in total.

const ORIGIN = (process.argv[2] || 'https://standardicon.com').replace(/\/$/, '');
const CONCURRENCY = 4;
const problems = [];
const passed = [];
let requests = 0;

const problem = (area, msg) => problems.push(`[${area}] ${msg}`);
const pass = (area, msg) => passed.push(`[${area}] ${msg}`);

// Tiny pool so we never have more than CONCURRENCY requests in flight.
let active = 0;
const waiting = [];
async function slot() {
  if (active >= CONCURRENCY) await new Promise((r) => waiting.push(r));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

async function req(url, { method = 'GET', headers = {}, redirect = 'follow', body = true } = {}) {
  await slot();
  requests++;
  try {
    const res = await fetch(url, { method, headers, redirect });
    const text = body && method === 'GET' ? await res.text() : (await res.body?.cancel(), '');
    return { url, status: res.status, redirected: res.redirected, finalUrl: res.url, headers: res.headers, text };
  } catch (e) {
    return { url, status: 0, error: String(e.cause?.code || e.message), headers: new Headers(), text: '' };
  } finally {
    release();
  }
}

const cache = new Map();
const cached = (url, opts = {}) => {
  const key = `${opts.method || 'GET'} ${opts.body === false ? 'nobody' : 'body'} ${url}`;
  if (!cache.has(key)) cache.set(key, req(url, opts));
  return cache.get(key);
};
const all = (items, fn) => Promise.all(items.map(fn));
const abs = (href, base) => {
  try { return new URL(href, base).href; } catch { return null; }
};
const isChallenge = (r) =>
  r.headers.get('cf-mitigated') || (r.status === 403 || r.status === 429 || r.status === 503) ||
  /cf-chl|challenge-platform|Just a moment|cf-browser-verification/i.test(r.text.slice(0, 20000));

// 1. llms.txt: every URL in it must be 200.
async function checkLlms() {
  const r = await cached(`${ORIGIN}/llms.txt`);
  if (r.status !== 200) return problem('llms', `${ORIGIN}/llms.txt returned ${r.status || r.error}`);
  const urls = [...new Set(r.text.match(/https?:\/\/[^\s)>"'\]]+/g) || [])].map((u) => u.replace(/[.,;]+$/, ''));
  const bad = [];
  await all(urls, async (u) => {
    const res = await cached(u, { body: false });
    if (res.status !== 200) bad.push(`${u} -> ${res.status || res.error}`);
  });
  bad.forEach((b) => problem('llms', `llms.txt lists a URL that is not 200: ${b}`));
  if (!bad.length) pass('llms', `all ${urls.length} URLs in /llms.txt return 200`);
  return urls;
}

// 2. Crawl internal links, check external ones once.
async function checkLinks(llmsUrls = []) {
  const idx = await cached(`${ORIGIN}/icons.json`);
  let names = [];
  try { names = JSON.parse(idx.text).icons.map((i) => i.name); } catch { problem('links', '/icons.json is not valid JSON with an icons array'); }
  const step = Math.max(1, Math.floor(names.length / 50));
  const sample = names.filter((_, i) => i % step === 0).slice(0, 50);

  const start = ['/', '/agents/', '/examples/', '/license/', '/privacy/', '/changelog/'].map((p) => ORIGIN + p);
  const home = await cached(`${ORIGIN}/`);
  const cats = [...new Set([...home.text.matchAll(/href="(\/categories\/[^"/]+\/)"/g)].map((m) => ORIGIN + m[1]))];
  llmsUrls.filter((u) => u.includes('/categories/')).forEach((u) => cats.includes(u) || cats.push(u));
  const pages = [...new Set([...start, ...cats, ...sample.map((n) => `${ORIGIN}/icons/${n}/`)])];

  const internal = new Map(); // url -> first page that linked it
  const external = new Map();
  const tgz = new Set();
  await all(pages, async (p) => {
    const r = await cached(p);
    if (r.status !== 200) return problem('links', `page ${p} returned ${r.status || r.error}`);
    if (r.redirected) problem('links', `page ${p} redirects to ${r.finalUrl}`);
    for (const m of r.text.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
      const u = abs(m[1].replace(/&amp;/g, '&'), p);
      if (!u || !/^https?:/.test(u)) continue;
      if (/standardicon-.*\.tgz$/.test(u)) tgz.add(u);
      const bucket = u.startsWith(ORIGIN) ? internal : external;
      if (!bucket.has(u)) bucket.set(u, p);
    }
  });

  // Internal link targets: skip built assets, they are hashed and fine if the page works.
  // Per-icon pages and SVGs are sampled above, so don't chase all ~1,500 of them from category pages.
  // /cdn-cgi/ links are injected by Cloudflare (email obfuscation) and 404 without their hash.
  const targets = [...internal.keys()].filter((u) => !/\/(_next|cdn-cgi|icons|svg)\//.test(u) && !pages.includes(u));
  const bad = [];
  const redirects = [];
  await all(targets, async (u) => {
    const r = await cached(u, { body: false });
    if (r.status !== 200) bad.push(`${u} -> ${r.status || r.error} (linked from ${internal.get(u)})`);
    else if (r.redirected) redirects.push(`${u} -> ${r.finalUrl} (linked from ${internal.get(u)})`);
  });
  bad.forEach((b) => problem('links', `internal link not 200: ${b}`));
  redirects.forEach((b) => problem('links', `internal link redirects: ${b}`));
  if (!bad.length) pass('links', `${pages.length} pages crawled and ${targets.length} other internal links all return 200`);

  const extBad = [];
  await all([...external.keys()], async (u) => {
    let r = await cached(u, { method: 'HEAD', redirect: 'follow' });
    if (r.status >= 400 || r.status === 0) r = await req(u, { body: false }); // some hosts dislike HEAD
    // npm and github sometimes answer bots with 403/429; report as a note, not a hard fail.
    if (r.status >= 400 || r.status === 0) extBad.push(`${u} -> ${r.status || r.error} (linked from ${external.get(u)})`);
  });
  extBad.forEach((b) => problem('links', `external link not OK: ${b}`));
  if (!extBad.length) pass('links', `${external.size} external links all answer (${[...external.keys()].map((u) => new URL(u).host).filter((h, i, a) => a.indexOf(h) === i).join(', ')})`);
  return { sample, tgz: [...tgz] };
}

// 3. Content types.
async function checkTypes(sample, tgz) {
  const n = sample[0] || 'arrow-up';
  const want = [
    [`/svg/16/${n}.svg`, /^image\/svg\+xml/],
    [`/svg/bold/32/${n}.svg`, /^image\/svg\+xml/],
    ['/icons.json', /^application\/json/],
    ['/llms.txt', /^text\//],
    ['/llms-full.txt', /^text\//],
    ['/SKILL.md', /^text\//],
    ['/sitemap.xml', /^(application|text)\/xml/],
    ['/robots.txt', /^text\/plain/],
    ['/.well-known/security.txt', /^text\/plain/],
    ['/.well-known/mcp-registry-auth', /^text\/plain/],
    ...tgz.map((u) => [u, /^application\/(gzip|x-gzip|x-tar|octet-stream)/]),
  ];
  let ok = 0;
  await all(want, async ([p, re]) => {
    const u = p.startsWith('http') ? p : ORIGIN + p;
    const r = await cached(u, { body: false });
    const ct = r.headers.get('content-type') || '(none)';
    if (r.status !== 200) problem('types', `${u} returned ${r.status || r.error}`);
    else if (!re.test(ct)) problem('types', `${u} has Content-Type "${ct}", expected ${re}`);
    else ok++;
  });
  if (ok === want.length) pass('types', `Content-Type correct for all ${want.length} files checked${tgz.length ? '' : ' (no .tgz linked on the site)'}`);
  else pass('types', `${ok} of ${want.length} files have the expected Content-Type`);
}

// 4. CORS.
async function checkCors() {
  const paths = ['/svg/16/arrow-up.svg', '/icons.json', '/svg/bold/32/arrow-up.svg', '/svg/24/clock.svg'];
  await all(paths, async (p) => {
    const r = await req(ORIGIN + p, { headers: { Origin: 'https://example.com' }, body: false });
    const acao = r.headers.get('access-control-allow-origin');
    if (r.status !== 200) problem('cors', `${p} returned ${r.status || r.error}`);
    else if (acao !== '*' && acao !== 'https://example.com') problem('cors', `${p} sends Access-Control-Allow-Origin: ${acao ?? '(missing)'}`);
    else pass('cors', `${p} sends Access-Control-Allow-Origin: ${acao}`);
  });
}

// 5. Redirects.
async function checkRedirects() {
  const host = new URL(ORIGIN).host;
  const cases = [`https://www.${host}/`, `http://${host}/`, `http://www.${host}/`];
  await all(cases, async (u) => {
    const r = await req(u, { redirect: 'manual', body: false });
    const loc = r.headers.get('location');
    if (![301, 308].includes(r.status)) problem('redirect', `${u} returned ${r.status || r.error}${r.status === 302 || r.status === 307 ? ' (temporary redirect)' : ''}, expected a permanent redirect to ${ORIGIN}/`);
    else if (!loc || abs(loc, u) !== `${ORIGIN}/`) problem('redirect', `${u} redirects to ${loc}, expected ${ORIGIN}/`);
    else pass('redirect', `${u} -> ${r.status} ${loc}`);
  });
}

// 6. Rate limits and bot challenges.
async function checkRate(sample) {
  const names = [...sample, 'arrow-up', 'clock', 'check', 'search'].slice(0, 30);
  const results = await all(names, (n) => req(`${ORIGIN}/svg/16/${n}.svg`, { headers: { 'Cache-Control': 'no-cache' } }));
  const blocked = results.filter(isChallenge);
  blocked.forEach((r) => problem('rate', `${r.url} -> ${r.status}${r.headers.get('cf-mitigated') ? ' cf-mitigated=' + r.headers.get('cf-mitigated') : ''}`));
  if (!blocked.length) pass('rate', `${results.length} SVG fetches in quick succession: no 429, 403 or challenge`);

  const agents = ['ClaudeBot', 'GPTBot', 'PerplexityBot', 'curl/8.4.0', 'node'];
  for (const ua of agents) {
    const r = await req(`${ORIGIN}/llms.txt`, { headers: { 'User-Agent': ua } });
    if (isChallenge(r) || r.status !== 200) problem('agents', `/llms.txt with User-Agent "${ua}" -> ${r.status || r.error}${isChallenge(r) ? ' (blocked or challenged)' : ''}`);
    else pass('agents', `/llms.txt with User-Agent "${ua}" -> 200`);
  }
}

const llmsUrls = (await checkLlms()) || [];
const { sample, tgz } = await checkLinks(llmsUrls);
await checkTypes(sample, tgz);
await checkCors();
await checkRedirects();
await checkRate(sample);

console.log(`Live check of ${ORIGIN}: ${requests} requests\n`);
console.log(problems.length ? `PROBLEMS (${problems.length})\n${problems.map((p) => '  - ' + p).join('\n')}\n` : 'No problems found.\n');
console.log(`PASSED (${passed.length})\n${passed.map((p) => '  - ' + p).join('\n')}`);
process.exitCode = problems.length ? 1 : 0;

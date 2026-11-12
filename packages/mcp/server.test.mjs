// Talks to the real server over stdio, the way an MCP client does. Run `node build.mjs` first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';

let server;
let nextId = 1;
const waiting = new Map();

function request(method, params) {
  const id = nextId++;
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve) => waiting.set(id, resolve));
}
const call = async (name, args = {}) => (await request('tools/call', { name, arguments: args })).result;
const json = (result) => JSON.parse(result.content[0].text);

before(() => {
  server = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: server.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
});
after(() => server.kill());

test('it starts up like an MCP server, and agrees on a protocol version', async () => {
  const { result } = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.equal(result.serverInfo.name, 'standardicon');
  assert.ok(result.capabilities.tools);
  assert.match(result.instructions, /don't draw a substitute/i);
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const unknown = await request('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(unknown.result.protocolVersion, '2025-11-25');
});

test('it lists four read-only tools', async () => {
  const { result } = await request('tools/list', {});
  assert.deepEqual(result.tools.map((t) => t.name), ['search_icons', 'get_icon', 'list_categories', 'list_icons']);
  assert.ok(result.tools.every((t) => t.annotations.readOnlyHint && t.inputSchema.type === 'object'));
});

test('search finds icons by name, by meaning, and by what they look like', async () => {
  assert.equal(json(await call('search_icons', { query: 'search' })).results[0].name, 'search');
  assert.ok(json(await call('search_icons', { query: 'delete' })).results.some((r) => r.name === 'trash'));
  const bell = json(await call('search_icons', { query: 'bell with a plus' })).results.map((r) => r.name);
  assert.ok(bell.slice(0, 3).some((n) => n.startsWith('bell-plus')), bell.join(', '));
  const first = json(await call('search_icons', { query: 'chart' })).results[0];
  assert.ok(first.looks && first.use && first.category);
});

test('search can stay in one category, and says plainly when nothing matches', async () => {
  const charts = json(await call('search_icons', { query: 'bar', category: 'charts-and-maths' }));
  assert.ok(charts.results.every((r) => r.category === 'charts-and-maths'));
  const none = json(await call('search_icons', { query: 'xylophone zeppelin' }));
  assert.equal(none.results.length, 0);
  assert.match(none.note, /doesn't have this icon/);
});

test('get_icon returns the same SVG as the site, at any size and weight', async () => {
  const svg = (await call('get_icon', { name: 'search' })).content[0].text;
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="18" height="18" viewBox="0 0 16 16" fill="none">/);
  assert.match(svg, /currentColor/);
  const big = (await call('get_icon', { name: 'search', size: 48, weight: 'black' })).content[0].text;
  assert.match(big, /width="48"/);
  assert.match(big, /stroke-width="2.222"/); // black: 2.5px at 18, in the drawing's 16px units
});

test('aliases work, and wrong names, sizes, and weights get helpful errors', async () => {
  assert.match((await call('get_icon', { name: 'pulse' })).content[0].text, /^<svg/);
  const typo = await call('get_icon', { name: 'serach' });
  assert.equal(typo.isError, true);
  assert.match(typo.content[0].text, /Did you mean: .*search/);
  assert.match((await call('get_icon', { name: 'search', size: 17 })).content[0].text, /Size must be one of/);
  assert.match((await call('get_icon', { name: 'search', size: 16, weight: 'bold' })).content[0].text, /Bold comes in sizes 32/);
});

test('categories list their icons', async () => {
  const { categories, total } = json(await call('list_categories'));
  assert.ok(categories.length > 10);
  assert.equal(categories.reduce((n, c) => n + c.count, 0), total);
  const { icons } = json(await call('list_icons', { category: categories[0].category }));
  assert.equal(icons.length, categories[0].count);
  assert.equal((await call('list_icons', { category: 'nope' })).isError, true);
});

test('unknown methods are JSON-RPC errors, and unknown tools say so', async () => {
  assert.equal((await request('resources/list', {})).error.code, -32601);
  assert.equal((await request('tools/call', { name: 'draw_icon', arguments: {} })).error.code, -32602);
});

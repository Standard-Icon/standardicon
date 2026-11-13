#!/usr/bin/env node
// The Standard Icon Set as an MCP server. It runs locally over stdio and works offline: every icon
// ships inside this package. It speaks MCP's JSON-RPC directly, so it has no dependencies.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LIMITS, PAIRING, SIZES, WEIGHTS, sizesFor, toSvg, weightFits } from './icon.mjs';
import { rank, suggest } from './search.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const { icons, categories } = JSON.parse(readFileSync(join(here, 'data.json'), 'utf8'));

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `The Standard Icon Set: ${icons.length} SVG line icons, drawn on a 16px grid in sizes from 16 to 48. Regular, the default, is a 1.33px line at 18px, the default size, and lines grow with the size. Use these tools whenever a design or UI needs an icon.

1. Find icons with search_icons. Search by meaning ("delete", "settings") or by what it looks like ("bell with a plus").
2. Get the SVG with get_icon, at the size it will show. Paste the SVG inline; it draws in currentColor, so it takes the text color around it.
3. If nothing fits, say the set doesn't have that icon. Don't draw a substitute or borrow one from another set, so the design stays consistent. The user can ask for it at https://github.com/Standard-Icon/standardicon/issues/new?template=icon-request.yml

Sizes: ${SIZES.join(', ')}. ${PAIRING} Weights: ${Object.keys(WEIGHTS).join(', ')}. ${LIMITS}`;

const TOOLS = [
  {
    name: 'search_icons',
    title: 'Search icons',
    description: 'Find icons by meaning, name, or what they look like. Returns names with a description of each drawing and when to use it.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the icon is for, or what it looks like. For example "delete", "upload file", or "bell with a plus".' },
        category: { type: 'string', description: 'Only search one category. list_categories gives the names.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_icon',
    title: 'Get an icon',
    description: `Get one icon as SVG markup, at a size and weight. The SVG draws in currentColor. Sizes: ${SIZES.join(', ')}. Weights: ${Object.keys(WEIGHTS).join(', ')}; ${LIMITS}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The icon name, or one of its aliases, as returned by search_icons.' },
        size: { type: 'integer', enum: SIZES, default: 18, description: `Pick it from the text beside the icon. ${PAIRING} Lines grow with the size.` },
        weight: { type: 'string', enum: Object.keys(WEIGHTS), default: 'regular', description: 'Lines at 18px: thin 1px, regular 1.33px (the default), semibold 1.5px, bold 2px, black 2.5px. Lines grow with the size.' },
      },
      required: ['name'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_categories',
    title: 'List categories',
    description: 'List the icon categories and how many icons each has.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_icons',
    title: 'List icons in a category',
    description: 'List every icon in one category, with a description of each drawing.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: 'A category name from list_categories.' } },
      required: ['category'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

class ToolError extends Error {}

const summary = (icon) => ({ name: icon.name, looks: icon.looks, use: icon.use, category: icon.category, ...(icon.aliases.length ? { aliases: icon.aliases } : {}) });

function findIcon(name) {
  const key = String(name ?? '').trim().toLowerCase();
  const icon = icons.find((i) => i.name === key || i.aliases.includes(key));
  if (icon) return icon;
  const close = suggest(icons, key);
  throw new ToolError(`There's no icon called "${key}".${close.length ? ` Did you mean: ${close.join(', ')}?` : ''} If none of these fit, the set doesn't have it: say so rather than drawing one.`);
}

function checkCategory(category) {
  if (category && !categories.some((c) => c.category === category)) {
    throw new ToolError(`There's no category called "${category}". Categories: ${categories.map((c) => c.category).join(', ')}.`);
  }
}

const CALLS = {
  search_icons({ query, category, limit = 12 }) {
    if (!String(query ?? '').trim()) throw new ToolError('Say what you are looking for, such as "delete" or "upload file".');
    checkCategory(category);
    const found = rank(icons, String(query), { category });
    const count = Math.min(Math.max(1, Number(limit) || 12), 50);
    if (!found.length) {
      return { query, results: [], note: `Nothing in the set matches "${query}". Try other words for the same idea. If it's still missing, tell the user the set doesn't have this icon; don't draw one.` };
    }
    return { query, total: found.length, results: found.slice(0, count).map(summary) };
  },
  get_icon({ name, size, weight = 'regular' }) {
    size ??= Math.max(18, sizesFor(weight)[0] ?? 18);
    const icon = findIcon(name);
    const px = Number(size);
    if (!SIZES.includes(px)) throw new ToolError(`Size must be one of ${SIZES.join(', ')}.`);
    if (!WEIGHTS[weight]) throw new ToolError(`Weight must be one of ${Object.keys(WEIGHTS).join(', ')}.`);
    if (!icon.weights.includes(weight)) throw new ToolError(`${icon.name} comes in one weight, regular, because it has filled shapes.`);
    if (!weightFits(weight, px)) throw new ToolError(`${weight[0].toUpperCase()}${weight.slice(1)} comes in sizes ${sizesFor(weight).join(', ')}.`);
    return toSvg(icon, px, weight);
  },
  list_categories() {
    return { total: icons.length, categories };
  },
  list_icons({ category }) {
    if (!category) throw new ToolError('Give a category name. list_categories lists them.');
    checkCategory(category);
    return { category, icons: icons.filter((i) => i.category === category).map(summary) };
  },
};

function respond(message) {
  const { id, method, params = {} } = message;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'standardicon', title: 'The Standard Icon Set', version },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const call = CALLS[params.name];
      if (!call) return fail(-32602, `Unknown tool: ${params.name}`);
      try {
        const out = call(params.arguments ?? {});
        return reply({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
      } catch (err) {
        if (!(err instanceof ToolError)) console.error(err);
        return reply({ content: [{ type: 'text', text: err instanceof ToolError ? err.message : `Something went wrong: ${err.message}` }], isError: true });
      }
    }
    default:
      return id === undefined ? null : fail(-32601, `Method not found: ${method}`);
  }
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const replies = (Array.isArray(message) ? message : [message]).map(respond).filter(Boolean);
  if (replies.length) send(Array.isArray(message) ? replies : replies[0]);
});

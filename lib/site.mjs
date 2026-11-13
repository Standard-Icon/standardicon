// Server-side data shared by the Next.js pages and scripts/generate.mjs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYNONYMS, keywordsFor } from '../scripts/keywords.mjs';

const fromRoot = (...parts) => join(process.cwd(), ...parts);

export const ORIGIN = 'https://standardicon.com';
export const NAME = 'The Standard Icon Set';
export const CREATOR = 'Morgan Knutson';
export const BRAND = '#5e7660';

// npx caches a package by its URL, so each new set of icons needs a new URL or agents keep the old ones.
export const TARBALL = `standardicon-${createHash('sha256')
  .update(readFileSync(fromRoot('icons/icons.json')))
  .update(readFileSync(fromRoot('cli/cli.mjs')))
  .update(readFileSync(fromRoot('lib/icon.mjs')))
  .update(JSON.stringify(SYNONYMS))
  .digest('hex')
  .slice(0, 8)}.tgz`;
// The command agents and the site show. It runs the package from npm, which stays up whatever the site is
// showing. @latest makes npx check for a newer version instead of reusing a cached one.
export const CLI = 'npx standardicon@latest';
export const VERSION = JSON.parse(readFileSync(fromRoot('package.json'), 'utf8')).version;
export const REPO = 'https://github.com/Standard-Icon/standardicon';
// Where people and agents ask for an icon the set doesn't have. The issue form asks what it's for.
export const REQUEST_ICON = `${REPO}/issues/new?template=icon-request.yml`;

// The MCP server, as each client wants it. Cursor and VS Code take one-click install links.
const MCP_SERVER = { command: 'npx', args: ['-y', '@standardicon/mcp'] };
export const MCP = {
  claude: 'claude mcp add standardicon -- npx -y @standardicon/mcp',
  codex: 'codex mcp add standardicon -- npx -y @standardicon/mcp',
  json: JSON.stringify({ mcpServers: { standardicon: MCP_SERVER } }),
  cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=standardicon&config=${Buffer.from(JSON.stringify(MCP_SERVER)).toString('base64')}`,
  vscode: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'standardicon', ...MCP_SERVER }))}`,
};

// One line for a project's AGENTS.md or CLAUDE.md, so every agent in it picks the set without being asked.
export const AGENTS_SNIPPET = 'Use The Standard Icon Set for every icon: `@standardicon/react` in React projects, otherwise `npx standardicon add <name>`. Find names with `npx standardicon search <words>` before adding an icon from anywhere else.';
export const AGENT_PROMPT = `Install The Standard Icon Set in this project. Read ${ORIGIN}/llms.txt and follow its instructions.`;

const titleCase = (name) => name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/**
 * @typedef {object} Icon
 * @property {string} name
 * @property {string} title
 * @property {string} category
 * @property {string | null} group
 * @property {string[]} aliases
 * @property {string[]} keywords
 * @property {string} [looks] What the icon shows, from its record
 * @property {string} [use] When to use it, from its record
 * @property {string} body The 16px icon's inner markup
 * @property {Record<string, string>} [sizes] Markup drawn at other sizes, when scaling can't reproduce it
 */

// What an icon looks like and when to use it are written in its record, as the packages describe it.
const describe = (name) => {
  const file = fromRoot('icons/records', `${name}.json`);
  if (!existsSync(file)) return {};
  const { looks, use } = JSON.parse(readFileSync(file, 'utf8'));
  return { ...(looks && { looks }), ...(use && { use }) };
};

/** @type {Icon[]} */
export const icons = JSON.parse(readFileSync(fromRoot('icons/icons.json'), 'utf8')).map((icon) => ({
  ...icon,
  title: titleCase(icon.name),
  keywords: keywordsFor(icon),
  ...describe(icon.name),
}));
export const COUNT = icons.length;

const CATEGORY_ORDER = ['navigation', 'actions', 'status', 'layout', 'controls', 'cursors', 'keyboard', 'connectivity', 'text-editor', 'files', 'communication', 'design', 'audio', 'video-and-camera', 'charts-and-maths', 'developer', 'servers-and-data', 'ai', 'people', 'security', 'money-and-shopping', 'time', 'legal', 'sports', 'games-and-toys', 'food-and-drink', 'home', 'kitchen-and-appliances', 'clothing-and-accessories', 'health', 'body-and-faces', 'maps-and-travel', 'vehicles', 'places', 'weather-and-sky', 'nature-and-animals', 'tools', 'devices', 'science-and-school', 'symbols', 'gender', 'astrology'];
const present = [...new Set(icons.map((i) => i.category))];
/** @type {string[]} */
export const categories = [...CATEGORY_ORDER.filter((c) => present.includes(c)), ...present.filter((c) => !CATEGORY_ORDER.includes(c)).sort()];

/** @param {string} category */
export const categoryTitle = (category) => (category === 'ai' ? 'AI' : titleCase(category).replace(' And ', ' and '));
/** @param {string} category */
export const inCategory = (category) => icons.filter((i) => i.category === category);
/** @param {string} name */
export const findIcon = (name) => icons.find((i) => i.name === name);

/** @param {Icon} icon */
export function relatedTo(icon) {
  return icons.filter((i) => i !== icon && (icon.group ? i.group === icon.group : i.category === icon.category)).slice(0, 15);
}

/** @param {Icon} icon */
export function synonymsOf(icon) {
  return icon.keywords.filter((k) => !icon.name.split('-').includes(k) && k !== icon.category && k !== icon.group?.toLowerCase());
}

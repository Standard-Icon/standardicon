#!/usr/bin/env node
// A clean test of how an outside agent finds and uses the set. See docs/agent-tests.md.
//
//   npm run agent-test                       reset ~/Sites/si-test and print a brief for a random app
//   npm run agent-test -- --app email        pick the app (see APPS)
//   npm run agent-test -- --dir <folder>     use another empty test project
//   npm run agent-test -- --no-reset         only print a brief
//
// Resetting deletes everything in the test folder except .git and .claude (Addy's settings). Then start a
// fresh agent in that folder's Addy project with the printed brief, word for word: an agent started from
// this repo would see the source. The brief never names a package, so the test covers finding the set too.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const dir = resolve(args.includes('--dir') ? flag('--dir') : join(homedir(), 'Sites', 'si-test'));

// Apps that need different parts of the set. Each has been or should be run at least once.
export const APPS = {
  recipe: 'recipe app: a sidebar of categories, a list of recipes, and a recipe detail view with a few actions',
  tracker: 'project tracker: a sidebar with projects and views, a task list with filters, a task detail panel with a few actions, plus settings and notifications',
  music: 'music player: a library sidebar, a track list, a now-playing bar with transport controls, and a settings panel',
  email: 'email client: folders in a sidebar, a message list, a reading pane with actions, and a compose window',
  files: 'file manager: a sidebar of locations, a grid and list of files with their types, a details panel, and upload, share and delete actions',
  weather: 'weather dashboard: the current conditions, an hourly and a ten-day forecast, saved locations, and units in settings',
  shop: 'shop: a product grid with filters, a product page, a cart, and a checkout with shipping and payment steps',
  chat: 'team chat: channels and direct messages in a sidebar, a message thread with reactions and attachments, and a member list',
};

export const brief = (app) =>
  `In this folder, build a small ${app}. Use the Standard Icon set for all the icons. Find it and set it up the way an outside developer would, using only public sources such as npm and the web. Don't use saved memories, notes, other projects, or any files outside this folder. When you're done, say how you found the icons and set them up, and anything that got in your way.`;

const pick = args.includes('--app') ? flag('--app') : Object.keys(APPS)[Math.floor(Math.random() * Object.keys(APPS).length)];
if (!APPS[pick]) {
  console.error(`No app called "${pick}". Apps: ${Object.keys(APPS).join(', ')}.`);
  process.exit(1);
}

const stop = (message) => {
  console.error(message);
  process.exit(1);
};

if (!args.includes('--no-reset')) {
  // Refuse anything that looks like a real project, above all this one.
  const pkg = join(dir, 'package.json');
  const name = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).name : '';
  if (!existsSync(dir)) stop(`${dir} doesn't exist. Make an empty Addy project there first.`);
  if (dir === resolve(join(import.meta.dirname, '..')) || name === 'standard-icon-site') stop(`${dir} is the icon set itself, not a test project.`);
  if (!/test/i.test(dir)) stop(`${dir} doesn't look like a test project (its path has no "test"). Pass a test folder with --dir.`);
  const removed = readdirSync(dir).filter((entry) => entry !== '.git' && entry !== '.claude');
  for (const entry of removed) rmSync(join(dir, entry), { recursive: true, force: true });
  console.log(`Reset ${dir}: removed ${removed.length ? removed.join(', ') : 'nothing'}.`);
  console.log('Stop any dev server still running there, and clear its Addy memory if an earlier agent saved notes.\n');
}

console.log(`Start a fresh agent in ${dir}'s Addy project with exactly this brief:\n`);
console.log(brief(APPS[pick]));
console.log(`\nThen add a note to docs/agent-tests.md: the date, the app (${pick}), the package versions, what it found, and what to fix.`);

#!/usr/bin/env node
// Standard Icon CLI. Works offline: every icon ships inside this package.
//
// Exit codes: 0 on success, 1 on bad input (unknown icon, size, weight, option, or a file `add` won't overwrite).
// With --json, results go to stdout as JSON, and so do errors: { "error": "...", "suggestions": [...] }.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SIZE, DEFAULT_WEIGHT, LIMITS, ONE_WEIGHT, SIZES, WEIGHTS, defaultSizeFor, hasWeights, sizesFor, toSvg, weightFits } from './icon.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (file) => JSON.parse(readFileSync(join(here, file), 'utf8'));
const icons = readJson('icons.json');
const { version } = readJson('package.json');
const SETS = [...new Set(icons.flatMap((icon) => Object.keys(icon.matches ?? {})))].sort();
// Old names another set still accepts, mapped to its current ones: Lucide's MoreHorizontal is ellipsis.
const RENAMES = existsSync(join(here, 'renames.json')) ? readJson('renames.json') : {};

const HELP = `Standard Icon ${version}: ${icons.length} SVG line icons. Regular is a 1.33px line at 18px, the default size.

Usage
  standardicon add <name...> [--size 18] [--weight regular] [--out icons]   Write SVG files
  standardicon get <name> [--size 18] [--weight regular]                    Print one SVG
  standardicon search <words>                                               Find icons by meaning or look
  standardicon from <set> <name...>                                         Our icon for another set's names
  standardicon list [--weight semibold]                                     Show icon names

Options
  --size <n>      ${SIZES.join(', ')}. Default ${DEFAULT_SIZE}, or the smallest size the weight comes in.
                  Match the text beside the icon: 13px text → 16, 15px → 18, 17px → 20, 19px → 22, 21px → 24.
  --weight <w>    ${Object.keys(WEIGHTS).join(', ')} (a ${Object.values(WEIGHTS).join(', ')}px line at 18px). Default regular.
  --out <dir>     Where add writes files. Default ./icons.
  --force         Let add replace files that already exist with different content.
  --dry-run       Show what add would write, without writing anything.
  --json          Print results, and errors, as JSON.
  --version, -v   Print the version.
  --help, -h      Print this help.

${LIMITS} Icons with filled shapes come in one weight, regular, as drawn.
Sets for from: ${SETS.join(', ')}. Names work as written in that set (x, trash-2, Trash2, more_horiz).
Icons draw in currentColor, so they take the color of the surrounding text.
add never overwrites a file that differs unless you pass --force. Files that already match are left alone.`;

class InputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}
const fail = (message, details) => {
  throw new InputError(message, details);
};

const BOOLEAN = { '--json': 'json', '--force': 'force', '--dry-run': 'dryRun', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version' };
const VALUED = { '--size': 'size', '--out': 'out', '--weight': 'weight' };

function parse(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const [arg, inline] = argv[i].startsWith('--') && argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i]];
    if (arg in BOOLEAN && inline === undefined) flags[BOOLEAN[arg]] = true;
    else if (arg in VALUED) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') fail(`${arg} needs a value. Run standardicon --help.`);
      flags[VALUED[arg]] = value;
    } else if (arg.startsWith('-') && arg !== '-') fail(`Unknown option ${argv[i]}. Run standardicon --help.`);
    else words.push(arg);
  }
  return { words, flags };
}

// Small words in a query like "bell with a plus" don't have to match anything.
const FILLER = new Set(['a', 'an', 'the', 'with', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'icon', 'icons', 'small', 'that', 'is']);

// How well one word of a query matches an icon, best first: its whole name or an alias; a word of a short name or
// its main synonym (the record's first keyword); another synonym; a word inside a longer synonym ("book" in
// "address book"); its category; the start of any of those words; a word of its description. Words match
// whole or from their start, never from the middle, so "city" doesn't find "opacity".
function termScore(icon, term) {
  if (icon.name === term || icon.aliases.includes(term)) return 10;
  const nameWords = icon.name.split('-');
  // Keywords end with the category, which ranks lower; a record can also list it as a real synonym earlier.
  const own = icon.keywords.at(-1) === icon.category ? icon.keywords.slice(0, -1) : icon.keywords;
  const synonyms = own.map((k) => k.toLowerCase()).filter((k) => !nameWords.includes(k));
  // In a long name like database-cog-cutout, a word is a detail rather than what the icon is.
  if ((nameWords.includes(term) && nameWords.length < 3) || synonyms[0] === term) return 6;
  if (nameWords.includes(term) || synonyms.includes(term)) return 5;
  const synonymWords = synonyms.flatMap((k) => k.split(/[^a-z0-9]+/));
  if (synonymWords.includes(term)) return 4;
  const categoryWords = icon.category.split('-');
  if (categoryWords.includes(term)) return 3;
  if (term.length >= 3 && [...nameWords, ...synonymWords, ...categoryWords].some((word) => word.startsWith(term))) return 2;
  const described = `${icon.looks ?? ''} ${icon.use ?? ''}`.toLowerCase().split(/[^a-z0-9]+/);
  if (described.includes(term) || (term.length >= 4 && described.some((word) => word.startsWith(term)))) return 1;
  return 0;
}
// Whether an icon's name starts with one of the words, so "book" puts book-open before law-book.
const leads = (icon, terms) => (terms.includes(icon.name.split('-')[0]) ? 1 : 0);


// Icons that match every word come first. When no icon matches them all, such as "person portrait" where the
// set has no portrait, the icons that match the most words come back instead. Ties go to the plainer name.
function rank(query) {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term && !FILLER.has(term));
  if (!terms.length) return [];
  const rows = icons.map((icon) => {
    const scores = terms.map((term) => termScore(icon, term));
    return { icon, hits: scores.filter(Boolean).length, score: scores.reduce((a, b) => a + b, 0) };
  }).filter((row) => row.hits);
  const best = Math.max(0, ...rows.map((row) => row.hits));
  return rows
    .filter((row) => row.hits === best)
    .sort((a, b) => b.score - a.score || leads(b.icon, terms) - leads(a.icon, terms) || a.icon.name.split('-').length - b.icon.name.split('-').length || a.icon.name.length - b.icon.name.length)
    .map((row) => row.icon);
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// Close spellings of a name or alias first, then icons that mean the same thing. Always real names.
function suggest(name, limit = 5) {
  const query = name.toLowerCase();
  // Two swapped letters ("serach") count as two edits, so names of five letters or more allow two.
  const allowed = Math.max(query.length >= 5 ? 2 : 1, Math.floor(query.length / 4));
  const labels = icons.flatMap((icon) => [icon.name, ...icon.aliases].map((label) => ({ name: icon.name, label })));
  const byLength = (a, b) => a.name.length - b.name.length;
  const spelled = labels
    .map((row) => ({ ...row, d: distance(query, row.label) }))
    .filter((row) => row.d <= allowed)
    .sort((a, b) => a.d - b.d || byLength(a, b));
  // "trashcan" holds "trash", and "arrow" is held by "arrow-up".
  const squashed = query.replace(/[-_\s]+/g, '');
  const contained = labels
    .filter(({ label }) => label.length >= 3 && (squashed.includes(label.replace(/-/g, '')) || label.startsWith(query)))
    .sort(byLength);
  const meant = rank(query.replace(/[-_]+/g, ' '));
  return [...new Set([...spelled, ...contained, ...meant].map((row) => row.name))].slice(0, limit);
}

function find(name) {
  const key = name.toLowerCase().replace(/\.svg$/, '');
  const icon = icons.find((i) => i.name === key || i.aliases.includes(key));
  if (icon) return icon;
  const suggestions = suggest(key);
  fail(
    `No icon named "${name}".${suggestions.length ? ` Did you mean ${suggestions.join(', ')}?` : ' Run standardicon search <word> to find one by meaning.'}`,
    { suggestions },
  );
}

function weightFrom(flags) {
  const weight = flags.weight ?? DEFAULT_WEIGHT;
  if (!Object.hasOwn(WEIGHTS, weight)) fail(`Weight must be one of ${Object.keys(WEIGHTS).join(', ')}.`);
  return weight;
}

// Without --size, use the default size, or the smallest size the weight comes in.
function sizeFrom(flags, weight) {
  const size = flags.size === undefined ? defaultSizeFor(weight) : Number(flags.size);
  if (!SIZES.includes(size)) fail(`Size must be one of ${SIZES.join(', ')}.`);
  if (!weightFits(weight, size)) fail(`${weight} comes in sizes ${sizesFor(weight).join(', ')}. Use --size ${sizesFor(weight)[0]} or a lighter weight.`);
  return size;
}

// Checks every icon before writing anything, so a batch never half-succeeds.
function checkWeight(list, weight) {
  if (ONE_WEIGHT.includes(weight)) return;
  const fixed = list.filter((icon) => !hasWeights(icon)).map((icon) => icon.name);
  if (fixed.length) fail(`${fixed.join(', ')} ${fixed.length === 1 ? 'comes' : 'come'} in one weight, regular, because ${fixed.length === 1 ? 'it has' : 'they have'} filled shapes. Use --weight regular for ${fixed.length === 1 ? 'it' : 'them'}.`);
}

const print = (flags, json, text) => console.log(flags.json ? JSON.stringify(json) : text);

// What add does with each file: create it, leave a matching file alone, refuse one that differs, or with
// --force, overwrite it. Every file is checked before any is written.
function add(words, flags) {
  if (!words.length) fail('Name at least one icon: standardicon add arrow-up check');
  const weight = weightFrom(flags);
  const size = sizeFrom(flags, weight);
  const list = [...new Map(words.map(find).map((icon) => [icon.name, icon])).values()];
  checkWeight(list, weight);
  const out = flags.out ?? 'icons';
  const plan = list.map((icon) => {
    const path = join(out, `${icon.name}.svg`);
    const svg = toSvg(icon, size, weight) + '\n';
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const action = current === null ? 'create' : current === svg ? 'unchanged' : flags.force ? 'overwrite' : 'conflict';
    return { name: icon.name, path, size, weight, action, svg };
  });
  const conflicts = plan.filter((file) => file.action === 'conflict');
  if (conflicts.length) {
    fail(
      `${conflicts.map((file) => file.path).join(', ')} already ${conflicts.length === 1 ? 'exists' : 'exist'} with different content. Nothing was written. Run again with --force to overwrite.`,
      { files: plan.map(({ svg, ...file }) => ({ ...file, written: false })) },
    );
  }
  if (!flags.dryRun) {
    mkdirSync(out, { recursive: true });
    for (const file of plan) if (file.action !== 'unchanged') writeFileSync(file.path, file.svg);
  }
  const verb = { create: 'would create', overwrite: 'would overwrite', unchanged: 'unchanged' };
  print(
    flags,
    { dryRun: Boolean(flags.dryRun), files: plan.map(({ svg, ...file }) => ({ ...file, written: !flags.dryRun && file.action !== 'unchanged' })) },
    plan.map((file) => (flags.dryRun ? `${verb[file.action]} ${file.path}` : file.action === 'create' ? file.path : `${file.path} (${file.action === 'overwrite' ? 'overwritten' : 'unchanged'})`)).join('\n'),
  );
}

function get(words, flags) {
  if (words.length !== 1) fail('Name one icon: standardicon get arrow-up');
  const icon = find(words[0]);
  const weight = weightFrom(flags);
  checkWeight([icon], weight);
  const size = sizeFrom(flags, weight);
  const svg = toSvg(icon, size, weight);
  print(flags, { name: icon.name, size, weight, svg }, svg);
}

function search(words, flags) {
  if (!words.length) fail('Say what you are looking for: standardicon search delete');
  const results = rank(words.join(' '));
  if (flags.json) print(flags, results.map(({ name, category, keywords, weights, looks, use }) => ({ name, category, looks: looks ?? null, use: use ?? null, keywords, weights })));
  else if (results.length) {
    const width = Math.min(28, Math.max(...results.map((i) => i.name.length)));
    console.log(results.map((i) => (i.looks ? `${i.name.padEnd(width)}  ${i.looks}` : i.name)).join('\n'));
  } else fail(`No icons match "${words.join(' ')}". Try a broader word, or run standardicon list.`);
}

// Another set's name as that set writes it in its files: "Trash2" and "Trash2Icon" (React) are trash-2,
// "more_horiz" (Material) is more-horiz.
const asWritten = (set, name) => {
  const plain = name.replace(/\.svg$/, '').replace(/^Lucide(?=[A-Z])/, '').replace(/Icon$/, '');
  return plain.replace(/([a-z])([A-Z0-9])/g, '$1-$2').replace(/([0-9])([A-Za-z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
};

// Our icon for each name from another set. A name several of ours match goes to the plainest of them, and
// the others are listed as alternatives. A name with no match gets suggestions from its words, and is null.
function from(words, flags) {
  const [set, ...names] = words;
  if (!set || !names.length) fail(`Name a set and at least one icon: standardicon from lucide trash-2 x. Sets: ${SETS.join(', ')}.`);
  const key = set.toLowerCase();
  if (!SETS.includes(key)) fail(`No set called "${set}". Sets: ${SETS.join(', ')}.`);
  const ours = new Map();
  const note = (theirs, name) => ours.set(theirs, [...new Set([...(ours.get(theirs) ?? []), name])]);
  for (const icon of icons) if (icon.matches?.[key]) note(icon.matches[key], icon.name);
  for (const icon of icons) for (const theirs of icon.also?.[key] ?? []) note(theirs, icon.name);
  const ownName = (name) => icons.find((icon) => icon.name === name || icon.aliases.includes(name))?.name;
  // Ours with the same name first, then the plainest name.
  const order = (theirs) => (a, b) => (b === theirs) - (a === theirs) || a.split('-').length - b.split('-').length || a.length - b.length;
  const lookup = (theirs) => {
    const found = [...(ours.get(theirs) ?? [])].sort(order(theirs));
    if (found.length) return found;
    const own = ownName(theirs);
    return own ? [own] : [];
  };
  const results = names.map((asked) => {
    const written = asWritten(key, asked);
    const theirs = RENAMES[key]?.[written] ?? written;
    let found = lookup(theirs);
    // A numbered variant, such as Lucide's trash-2 or loader-2, falls back to the plain name.
    if (!found.length && /-\d+$/.test(theirs)) found = lookup(theirs.replace(/-\d+$/, ''));
    if (found.length) return { from: asked, name: found[0], alternatives: found.slice(1) };
    return { from: asked, name: null, suggestions: rank(theirs.replace(/[-_.]+/g, ' ')).slice(0, 5).map((icon) => icon.name) };
  });
  print(flags, results, results.map((r) => (r.name
    ? `${r.from} → ${r.name}${r.alternatives.length ? ` (also ${r.alternatives.join(', ')})` : ''}`
    : `${r.from} → no equivalent${r.suggestions.length ? `. Closest: ${r.suggestions.join(', ')}` : ''}`)).join('\n'));
}

function list(words, flags) {
  const weight = weightFrom(flags);
  const names = (ONE_WEIGHT.includes(weight) ? icons : icons.filter(hasWeights)).map((i) => i.name);
  print(flags, names, names.join('\n'));
}

const COMMANDS = { add, get, search, from, list };

function run(argv) {
  const [command, ...rest] = argv;
  const { words, flags } = parse(rest);
  if (command === '--version' || command === '-v' || command === 'version' || flags.version) return print(flags, { version }, version);
  if (!command || command === 'help' || command === '--help' || command === '-h' || flags.help) return console.log(HELP);
  if (!Object.hasOwn(COMMANDS, command)) fail(`Unknown command "${command}". Commands are ${Object.keys(COMMANDS).join(', ')}. Run standardicon --help.`);
  COMMANDS[command](words, flags);
}

const argv = process.argv.slice(2);
try {
  run(argv);
} catch (error) {
  if (!(error instanceof InputError)) throw error;
  if (argv.includes('--json')) console.log(JSON.stringify({ error: error.message, ...error.details }));
  else console.error(error.message);
  process.exitCode = 1;
}

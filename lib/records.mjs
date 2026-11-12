// Per-icon records: what people have decided about each icon, one JSON file per icon in icons/records/.
//
// Records hold intent only. Anything Figma can tell us (whether it's drawn, its border, its section) is read
// at each sync and merged in by withObserved(), so the two can't drift apart.
//
// This library is the only thing that reads or writes records. The workbench, the `npm run icon` command, and
// the sync all go through it, and it always acts on the checkout it lives in, with no server needed.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyOf as drawingsOf } from './history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RECORDS_DIR = join(ROOT, 'icons/records');
export const ISSUES_DIR = join(ROOT, 'icons/issues');
const OBSERVED_FILE = join(ROOT, '.sync/status.json');

export const STATUSES = ['active', 'planned', 'covered', 'dropped'];
export const SOURCES = ['plan', 'lucide', 'sf', 'later'];
export const REVISION_FLAG = 'needs-revision';
// Notes on a record, separate from its stage. needs-revision is the workbench's own mark and pairs with a dashed orange border.
export const FLAGS = [REVISION_FLAG, 'weak-read', 'possible-duplicate'];
export const ISSUE_STATUSES = ['open', 'decided', 'done'];

// The fields in a record, in the order they're written. Empty values are left out of the file.
// looks says what's drawn and use says when to reach for it. They feed search, AI agents and the icon pages.
const TEXT = ['name', 'status', 'coveredBy', 'parent', 'canonical', 'source', 'wave', 'group', 'pick', 'solid', 'figmaId', 'looks', 'use'];
const LISTS = ['aliases', 'formerNames', 'keywords', 'flags'];
const FIELD_ORDER = [...TEXT, ...LISTS, 'fillApproved', 'approved', 'compare', 'compareAlso', 'notes'];

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const validName = (name) => typeof name === 'string' && NAME.test(name);
function assertName(name) {
  if (!validName(name)) throw new Error(`"${name}" isn't a valid icon name. Use lowercase words joined by hyphens.`);
}
const fileFor = (name) => join(RECORDS_DIR, `${name}.json`);

function atomicWrite(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

// Keeps files small and their diffs clean: a fixed key order, sorted lists, and no empty fields.
function normalize(record) {
  const out = {};
  for (const key of FIELD_ORDER) {
    let value = record[key];
    // Keywords keep their order, since the first ones are the most useful.
    if (LISTS.includes(key) && Array.isArray(value)) value = key === 'keywords' ? [...new Set(value)] : [...new Set(value)].sort();
    if (key === 'compare' && value) {
      // null means not reviewed, so it isn't stored. false means this set has no equivalent.
      value = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
    }
    const empty = value === undefined || value === null || value === '' || value === false && key === 'fillApproved'
      || (Array.isArray(value) && !value.length) || (['compare', 'compareAlso'].includes(key) && !Object.keys(value ?? {}).length);
    if (!empty) out[key] = value;
  }
  return out;
}

function validate(record) {
  assertName(record.name);
  if (!STATUSES.includes(record.status)) throw new Error(`${record.name}: status must be one of ${STATUSES.join(', ')}.`);
  if (record.source && !SOURCES.includes(record.source)) throw new Error(`${record.name}: source must be one of ${SOURCES.join(', ')}.`);
  if (record.status === 'covered' && !record.coveredBy) throw new Error(`${record.name}: a covered icon needs coveredBy.`);
  for (const key of Object.keys(record)) if (!FIELD_ORDER.includes(key)) throw new Error(`${record.name}: unknown field "${key}". Observed fields come from Figma and can't be set.`);
  for (const key of LISTS) if (record[key] !== undefined && !Array.isArray(record[key])) throw new Error(`${record.name}: ${key} must be a list.`);
}

export function readRecord(name) {
  assertName(name);
  return existsSync(fileFor(name)) ? JSON.parse(readFileSync(fileFor(name), 'utf8')) : null;
}

export function writeRecord(record) {
  validate(record);
  atomicWrite(fileFor(record.name), `${JSON.stringify(normalize(record), null, 2)}\n`);
  return readRecord(record.name);
}

export function allRecords() {
  if (!existsSync(RECORDS_DIR)) return [];
  return readdirSync(RECORDS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(RECORDS_DIR, f), 'utf8')));
}

export function createRecord(name, fields = {}) {
  if (readRecord(name)) throw new Error(`${name} already has a record.`);
  return writeRecord({ status: 'planned', ...fields, name });
}

// Merges changes into a record. A null value removes the field. `compare` merges one set at a time.
export function patchRecord(name, changes) {
  const record = readRecord(name);
  if (!record) throw new Error(`No record for "${name}".`);
  if ('name' in changes && changes.name !== name) throw new Error('Use renameRecord to change a name.');
  const next = { ...record };
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'compare') {
      next.compare = { ...record.compare, ...value };
      for (const [set, match] of Object.entries(next.compare)) if (match === null) delete next.compare[set];
    } else if (value === null) delete next[key];
    else next[key] = value;
  }
  return writeRecord(next);
}

// Every note files an issue, so nothing written about an icon goes untracked.
// One of my icons can stand for several of another set's: book-marked is both book-marked and book-bookmark.
// `compare` holds its main match, and this holds the rest.
export function addAlsoMatch(name, set, match) {
  const record = readRecord(name);
  if (!record) throw new Error(`No record for "${name}".`);
  const also = record.compareAlso ?? {};
  return patchRecord(name, { compareAlso: { ...also, [set]: [...new Set([...(also[set] ?? []), match])].sort() } });
}

export function addNote(name, text, by = 'agent') {
  const record = readRecord(name);
  if (!record) throw new Error(`No record for "${name}".`);
  const issue = createIssue({ title: titleFrom(text), text, icons: [name], by });
  return patchRecord(name, { notes: [...(record.notes ?? []), { at: new Date().toISOString().slice(0, 10), by, text, issue: issue.slug }] });
}

// Moves a record to a new name and remembers the old one, so a search for it still finds the icon.
export function renameRecord(from, to) {
  assertName(to);
  const record = readRecord(from);
  if (!record) throw new Error(`No record for "${from}".`);
  if (readRecord(to)) throw new Error(`${to} already has a record.`);
  const moved = writeRecord({ ...record, name: to, formerNames: [...(record.formerNames ?? []), from] });
  rmSync(fileFor(from));
  for (const other of allRecords()) {
    const changes = {};
    if (other.coveredBy === from) changes.coveredBy = to;
    if (other.parent === from) changes.parent = to;
    if (Object.keys(changes).length) patchRecord(other.name, changes);
  }
  return moved;
}

// ---- What Figma says, merged in at read time ----

const COLOR_STAGES = { '#ff4fd8': 'ready', '#e6e6e6': 'refine', '#4f4fff': 'new', '#ffb000': 'new' };
export function stageOf(observed) {
  const border = observed?.border;
  if (!border) return observed ? 'none' : 'absent';
  if (observed.ready) return 'ready';
  if (border.color === '#ffb000' && border.dashed) return 'needs-revision';
  return COLOR_STAGES[border.color] ?? 'other';
}

export function readObserved() {
  return existsSync(OBSERVED_FILE) ? JSON.parse(readFileSync(OBSERVED_FILE, 'utf8')) : {};
}

export function withObserved(record, observed = readObserved()) {
  const seen = observed[record.name];
  return {
    ...record,
    observed: {
      inFigma: Boolean(seen),
      section: seen?.section ?? null,
      nodeId: seen?.id ?? null,
      border: seen?.border ?? null,
      stage: stageOf(seen),
      released: Boolean(seen?.ready),
    },
  };
}

// Does this concept exist already? Looks at names, former names, aliases, keywords, and what covers it.
export function searchRecords(query, records = allRecords()) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const record of records) {
    const hay = [record.name, ...(record.formerNames ?? []), ...(record.aliases ?? []), ...(record.keywords ?? []), record.coveredBy ?? '', record.canonical ?? ''].join(' ').toLowerCase();
    if (!terms.every((t) => hay.includes(t))) continue;
    const q = query.toLowerCase().replace(/\s+/g, '-');
    const score = record.name === q ? 3 : (record.formerNames ?? []).includes(q) || (record.aliases ?? []).includes(q) ? 2 : record.name.includes(q) ? 1 : 0;
    scored.push([score, record]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map(([, r]) => r);
}

// Filters on record fields and observed fields alike: { stage, section, flag, source, wave, parent, canonical, status }.
export function filterRecords(filters, records = allRecords(), observed = readObserved()) {
  return records.map((r) => withObserved(r, observed)).filter((r) => {
    if (filters.stage && r.observed.stage !== filters.stage) return false;
    if (filters.section && r.observed.section !== filters.section) return false;
    if (filters.flag && !(r.flags ?? []).includes(filters.flag)) return false;
    for (const key of ['source', 'wave', 'parent', 'canonical', 'status']) if (filters[key] && r[key] !== filters[key]) return false;
    return true;
  });
}

// How an icon stands against a comparison set: unreviewed, confirmed missing, or matched.
export function gaps(setId, records = allRecords()) {
  const out = { matched: [], none: [], unreviewed: [] };
  for (const record of records) {
    if (record.status === 'covered' || record.status === 'dropped') continue;
    const value = record.compare?.[setId];
    if (value === false) out.none.push(record.name);
    else if (value) out.matched.push(record.name);
    else out.unreviewed.push(record.name);
  }
  return out;
}

// Brings the records in line with what a sync found in Figma, and returns what changed. status is the
// { name: { id, section, ready, border } } map the sync writes.
export function reconcile(status) {
  const changes = { created: [], activated: [], renamed: [], idChanged: [], conflicts: [], missing: [] };
  const byId = new Map(allRecords().filter((r) => r.figmaId).map((r) => [r.figmaId, r.name]));

  for (const [name, seen] of Object.entries(status)) {
    if (!validName(name)) continue;
    let record = readRecord(name);
    if (!record) {
      // The same Figma set under a new name is a rename, as long as the old name has gone.
      const previous = byId.get(seen.id);
      if (previous && !status[previous]) {
        renameRecord(previous, name);
        changes.renamed.push(`${previous} → ${name}`);
      } else {
        writeRecord({ name, status: 'active', source: 'later', figmaId: seen.id });
        changes.created.push(name);
      }
      continue;
    }
    const patch = {};
    if (!record.figmaId) patch.figmaId = seen.id;
    else if (record.figmaId !== seen.id) changes.idChanged.push(name);
    if (record.status === 'planned') {
      patch.status = 'active';
      changes.activated.push(name);
    } else if (record.status !== 'active') changes.conflicts.push(`${name} (${record.status})`);
    if (Object.keys(patch).length) patchRecord(name, patch);
  }

  for (const record of allRecords()) {
    if (record.status === 'active' && record.figmaId && !status[record.name]) changes.missing.push(record.name);
  }
  return changes;
}

// ---- Issues: one file per question or to-do, each with its own history ----
//
// The stream is every issue's history in one feed, so an agent can ask what's new without reading each file.

const CURSORS_DIR = join(ROOT, '.workbench/stream');
const ISSUE_FIELDS = ['title', 'text', 'status', 'icons', 'decision', 'owner'];
const issueFile = (slug) => join(ISSUES_DIR, `${slug}.json`);
const now = () => new Date().toISOString();

function titleFrom(text) {
  const line = text.trim().split('\n')[0];
  if (line.length <= 72) return line;
  return `${line.slice(0, 72).replace(/\s+\S*$/, '')}…`;
}

function slugFrom(title) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'issue';
  let slug = base;
  for (let n = 2; existsSync(issueFile(slug)); n++) slug = `${base}-${n}`;
  return slug;
}

// Issues from before the stream have no history, so their creation stands in for it.
const historyOf = (issue) => issue.events ?? [{ at: issue.at, by: issue.by, type: 'created' }];

export function allIssues() {
  if (!existsSync(ISSUES_DIR)) return [];
  return readdirSync(ISSUES_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const issue = { slug: f.slice(0, -5), ...JSON.parse(readFileSync(join(ISSUES_DIR, f), 'utf8')) };
    return { ...issue, events: historyOf(issue) };
  });
}

function saveIssue({ slug, ...issue }) {
  assertName(slug);
  atomicWrite(issueFile(slug), `${JSON.stringify(issue, null, 2)}\n`);
  return { slug, ...issue };
}

export function createIssue({ title, text = '', icons = [], by = 'agent', owner = null, flag }) {
  if (!title?.trim()) throw new Error('An issue needs a title.');
  const at = now();
  return saveIssue({ slug: slugFrom(title), title: title.trim(), text, status: 'open', icons, decision: null, owner, ...(flag ? { flag } : {}), at, by, events: [{ at, by, type: 'created' }] });
}

export function readIssue(slug) {
  assertName(slug);
  return allIssues().find((issue) => issue.slug === slug) ?? null;
}

export function patchIssue(slug, changes, by = 'agent') {
  const issue = readIssue(slug);
  if (!issue) throw new Error(`No issue called "${slug}".`);
  for (const key of Object.keys(changes)) if (!ISSUE_FIELDS.includes(key)) throw new Error(`Issues have no "${key}" field.`);
  const next = { ...issue, ...changes };
  if (!ISSUE_STATUSES.includes(next.status)) throw new Error(`Issue status must be one of ${ISSUE_STATUSES.join(', ')}.`);
  if (typeof next.icons === 'string') next.icons = next.icons.split(',').filter(Boolean);
  const at = now();
  const events = [...issue.events];
  if (next.status !== issue.status) events.push({ at, by, type: next.status === 'open' ? 'reopened' : next.status, ...(next.decision ? { text: next.decision } : {}) });
  else if (next.decision !== issue.decision) events.push({ at, by, type: 'decided', text: next.decision });
  if (next.owner !== issue.owner) events.push({ at, by, type: next.owner ? 'claimed' : 'unclaimed', ...(next.owner ? { text: next.owner } : {}) });
  if (next.title !== issue.title || next.text !== issue.text || String(next.icons) !== String(issue.icons)) events.push({ at, by, type: 'edited' });
  const saved = saveIssue({ ...next, events });
  // An issue that came with a flag takes it along: closing clears it, and reopening restores it.
  if (issue.flag && next.status !== issue.status && (next.status === 'done' || issue.status === 'done')) {
    for (const name of next.icons ?? []) {
      const record = readRecord(name);
      if (!record) continue;
      const flags = new Set(record.flags ?? []);
      if (next.status === 'done') flags.delete(issue.flag);
      else flags.add(issue.flag);
      patchRecord(name, { flags: [...flags] });
    }
  }
  return saved;
}

// Puts an icon on the list to draw because another set has it, and files an issue so someone picks it up.
export function planIcon(name, { set, match, by = 'agent' }) {
  const fields = { source: SOURCES.includes(set) ? set : 'later', compare: { [set]: match } };
  const existing = readRecord(name);
  const record = existing ? patchRecord(name, { compare: fields.compare }) : createRecord(name, { ...fields, status: 'planned' });
  createIssue({ title: `Create ${name}`, text: `Planned from \`${match}\` in ${set}. Draw it from scratch: no set's geometry is ever traced.`, icons: [name], by });
  return record;
}

// Marks an icon as needing revision and files an issue for it. Marking it twice changes nothing.
export function markNeedsRevision(name, by = 'agent') {
  const record = readRecord(name);
  if (!record) throw new Error(`No record for "${name}".`);
  if (!record.flags?.includes(REVISION_FLAG)) {
    createIssue({ title: `${name} needs revision`, icons: [name], by, flag: REVISION_FLAG });
    // A revision outranks an earlier approval.
    patchRecord(name, { flags: [...(record.flags ?? []), REVISION_FLAG], approved: null });
  }
  dropReset(name);
  return readRecord(name);
}

// Borders: blue is new, dashed orange needs revision, pink is approved. Taking a mark or an approval back
// returns an icon to blue. The plugin only paints, so those returns wait here (in .workbench/, not committed)
// for half an hour, which is plenty for an open plugin to pick them up.
const RESETS = join(ROOT, '.workbench/border-resets.json');
const RESET_FOR = 30 * 60 * 1000;
const readResets = () => (existsSync(RESETS) ? JSON.parse(readFileSync(RESETS, 'utf8')) : []).filter((r) => Date.now() - Date.parse(r.at) < RESET_FOR);
const saveResets = (list) => atomicWrite(RESETS, `${JSON.stringify(list, null, 1)}\n`);
function queueReset(name, from) {
  const figmaId = readRecord(name)?.figmaId;
  if (figmaId) saveResets([...readResets().filter((r) => r.name !== name), { name, figmaId, from, at: now() }]);
}
const dropReset = (name) => existsSync(RESETS) && saveResets(readResets().filter((r) => r.name !== name));

// Takes the mark off and closes the issue that came with it.
export function clearNeedsRevision(name, by = 'agent') {
  const record = readRecord(name);
  if (!record) throw new Error(`No record for "${name}".`);
  for (const issue of allIssues()) {
    if (issue.flag === REVISION_FLAG && issue.status !== 'done' && issue.icons?.includes(name)) patchIssue(issue.slug, { status: 'done' }, by);
  }
  patchRecord(name, { flags: (readRecord(name).flags ?? []).filter((flag) => flag !== REVISION_FLAG) });
  queueReset(name, 'revision');
  return readRecord(name);
}

// Approval from the workbench. It's tied to the drawing approved, the latest version in icons/history, so a
// redraw afterwards needs approving again. The sync ships an approved icon as if its border were pink, and
// the Figma plugin in figma-plugin/ turns the border pink to match.
export function approveIcon(name, by = 'morgan') {
  const record = readRecord(name);
  if (!record) throw new Error(`No record for "${name}".`);
  const version = drawingsOf(name).at(-1);
  if (!version) throw new Error(`${name} has no drawing in the history yet. Sync it first.`);
  // Approving settles a revision, so it takes the mark off and closes its issue.
  if (record.flags?.includes(REVISION_FLAG)) clearNeedsRevision(name, by);
  dropReset(name);
  return patchRecord(name, { approved: { at: now(), by, version: version.at } });
}

// What the Figma plugin should paint: pink for approvals that hold, dashed orange for icons marked as needing
// revision, and blue for marks or approvals just taken back. Blue only replaces the border it was taken from.
export function borderQueue() {
  const records = allRecords().filter((r) => r.figmaId);
  return {
    pink: records.filter(approvalHolds).map((r) => ({ name: r.name, figmaId: r.figmaId })),
    revision: records.filter((r) => r.flags?.includes(REVISION_FLAG) && !r.approved).map((r) => ({ name: r.name, figmaId: r.figmaId })),
    blue: readResets().map(({ name, figmaId, from }) => ({ name, figmaId, from })),
  };
}

export function unapproveIcon(name) {
  if (!readRecord(name)) throw new Error(`No record for "${name}".`);
  const record = patchRecord(name, { approved: null });
  queueReset(name, 'pink');
  return record;
}

// Approved, and the drawing hasn't changed since.
export const approvalHolds = (record) => Boolean(record?.approved) && drawingsOf(record.name).at(-1)?.at === record.approved.version;

export function commentOnIssue(slug, text, by = 'agent') {
  const issue = readIssue(slug);
  if (!issue) throw new Error(`No issue called "${slug}".`);
  if (!text?.trim()) throw new Error('A comment needs some text.');
  return saveIssue({ ...issue, events: [...issue.events, { at: now(), by, type: 'comment', text: text.trim() }] });
}

// Everything that's happened to any issue, oldest first, after a time if given.
export function issueStream(since) {
  const events = allIssues().flatMap((issue) => issue.events.map((event) => ({ ...event, slug: issue.slug, title: issue.title, status: issue.status, owner: issue.owner, icons: issue.icons ?? [] })));
  return events.filter((event) => !since || event.at > since).sort((a, b) => a.at.localeCompare(b.at));
}

// What's new for one reader since its last check. Each reader's place is kept on this machine only.
export function issueStreamFor(reader) {
  assertName(reader);
  const file = join(CURSORS_DIR, reader);
  const since = existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
  const events = issueStream(since);
  if (events.length) atomicWrite(file, events.at(-1).at);
  return events;
}

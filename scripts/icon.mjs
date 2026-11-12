#!/usr/bin/env node
// The icon records from the command line, for people and agents. Works on this checkout, with no server running.
import { readFileSync } from 'node:fs';
import { addAlsoMatch, addNote, allIssues, allRecords, clearNeedsRevision, commentOnIssue, createIssue, createRecord, filterRecords, gaps, issueStream, issueStreamFor, markNeedsRevision, patchIssue, planIcon, patchRecord, readObserved, readRecord, renameRecord, searchRecords, withObserved } from '../lib/records.mjs';

const HELP = `npm run icon -- <command>

Read
  get <name>                    One icon's record and what Figma says about it
  find <words>                  Does this exist? Searches names, former names, aliases, keywords, covered-by
  list [--stage ready] [--section actions] [--flag weak-read] [--source lucide]
       [--wave W7] [--parent folder] [--canonical page] [--status planned]
  gaps <set>                    Matched, confirmed missing, and unreviewed against a comparison set
  issues [--open] [--icon home] [--owner name]
  stream --as <your-name>       What's new on any issue since you last checked
  stream [--since <time>]       The whole history, or everything after a time
  children <name>               What has to follow if this icon changes (its parent and canonical links)

Write
  create <name> [field=value…]
  set <name> field=value…       flags+=weak-read adds to a list, flags-=weak-read removes, field= clears
  bulk <names.json|a,b,c> field=value…     The same change to many icons
  note <name> <text>            Also files an issue for the icon
  plan <name> --set lucide [--match <their-name>]   Adds an icon to draw and files an issue
  revise <name> [--undo]        Marks it as needing revision and files an issue
  compare <name> <set> <match>  Use "none" for no equivalent, "clear" to undo
  compare <name> <set> <match> --also   Adds another match and keeps the main one
  rename <old> <new>            Keeps the old name in formerNames
  issue new <title> [--text …] [--icons a,b]
  issue <slug> field=value…     Such as status=decided "decision=Keep both", or owner=figma-agent to claim it
  comment <slug> <text>

Add --by <your-name> to any issue or note command, so people can see who did it.

Add --json to any read for machine output.`;

const args = process.argv.slice(2);
const json = args.includes('--json');
const positional = [];
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') continue;
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[++i];
  else positional.push(args[i]);
}
const [command, ...rest] = positional;
const by = typeof flags.by === 'string' ? flags.by : 'agent';

const print = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const LIST_FIELDS = new Set(['aliases', 'formerNames', 'keywords', 'flags']);

// Turns field=value arguments into changes for one record.
function changesFor(record, assignments) {
  const changes = {};
  for (const assignment of assignments) {
    const m = assignment.match(/^([a-zA-Z]+)(\+=|-=|=)(.*)$/);
    if (!m) throw new Error(`"${assignment}" should look like field=value.`);
    const [, field, op, value] = m;
    if (LIST_FIELDS.has(field)) {
      const current = new Set(changes[field] ?? record?.[field] ?? []);
      if (op === '+=') value.split(',').forEach((v) => current.add(v));
      else if (op === '-=') value.split(',').forEach((v) => current.delete(v));
      else { current.clear(); value.split(',').filter(Boolean).forEach((v) => current.add(v)); }
      changes[field] = [...current];
    } else if (op !== '=') throw new Error(`${field} isn't a list, so use field=value.`);
    else if (field === 'fillApproved') changes[field] = value === 'true';
    else changes[field] = value === '' ? null : value;
  }
  return changes;
}

const summary = (r) => `${r.name.padEnd(30)} ${(r.observed?.stage ?? '').padEnd(8)} ${(r.observed?.section ?? '').padEnd(16)} ${r.status}${r.coveredBy ? ` → ${r.coveredBy}` : ''}${r.flags?.length ? `  [${r.flags.join(', ')}]` : ''}`;

try {
  switch (command) {
    case 'get': {
      const record = readRecord(rest[0]);
      if (!record) throw new Error(`No record for "${rest[0]}". Try: npm run icon -- find ${rest[0]}`);
      print(withObserved(record));
      break;
    }
    case 'find': {
      const observed = readObserved();
      const hits = searchRecords(rest.join(' ')).map((r) => withObserved(r, observed));
      if (json) print(hits);
      else print(hits.length ? hits.map(summary).join('\n') : `Nothing matches "${rest.join(' ')}".`);
      break;
    }
    case 'list': {
      const hits = filterRecords(flags);
      if (json) print(hits);
      else print(`${hits.map(summary).join('\n')}\n\n${hits.length} icons`);
      break;
    }
    case 'gaps': {
      const result = gaps(rest[0]);
      if (json) print(result);
      else print(`${rest[0]}: ${result.matched.length} matched, ${result.none.length} confirmed missing, ${result.unreviewed.length} unreviewed`);
      break;
    }
    case 'children': {
      const hits = allRecords().filter((r) => r.parent === rest[0] || r.canonical === rest[0]);
      print(json ? hits : hits.map((r) => r.name).join('\n') || `Nothing depends on ${rest[0]}.`);
      break;
    }
    case 'issues': {
      const issues = allIssues().filter((i) => (!flags.open || i.status === 'open') && (!flags.icon || i.icons?.includes(flags.icon)) && (!flags.owner || i.owner === flags.owner));
      print(json ? issues : issues.map((i) => `${i.status.padEnd(8)} ${i.slug}: ${i.title}${i.owner ? ` [${i.owner}]` : ''}${i.icons?.length ? ` (${i.icons.length} icons)` : ''}`).join('\n') || 'No issues.');
      break;
    }
    case 'create': {
      print(createRecord(rest[0], changesFor(null, rest.slice(1))));
      break;
    }
    case 'set': {
      print(patchRecord(rest[0], changesFor(readRecord(rest[0]), rest.slice(1))));
      break;
    }
    case 'bulk': {
      const names = rest[0].endsWith('.json') ? JSON.parse(readFileSync(rest[0], 'utf8')) : rest[0].split(',');
      let count = 0;
      for (const name of names) {
        patchRecord(name, changesFor(readRecord(name), rest.slice(1)));
        count++;
      }
      print(`Updated ${count} records.`);
      break;
    }
    case 'note': {
      print(addNote(rest[0], rest.slice(1).join(' '), by));
      break;
    }
    case 'plan': {
      if (typeof flags.set !== 'string') throw new Error('Say which set it comes from: --set lucide.');
      print(planIcon(rest[0], { set: flags.set, match: typeof flags.match === 'string' ? flags.match : rest[0], by }));
      break;
    }
    case 'revise': {
      print(flags.undo ? clearNeedsRevision(rest[0], by) : markNeedsRevision(rest[0], by));
      break;
    }
    case 'compare': {
      const [name, set, match] = rest;
      if (flags.also) {
        print(addAlsoMatch(name, set, match));
        break;
      }
      print(patchRecord(name, { compare: { [set]: match === 'none' ? false : match === 'clear' ? null : match } }));
      break;
    }
    case 'rename': {
      print(renameRecord(rest[0], rest[1]));
      break;
    }
    case 'issue': {
      if (rest[0] === 'new') {
        print(createIssue({ title: rest.slice(1).join(' '), text: flags.text === true ? '' : flags.text ?? '', icons: typeof flags.icons === 'string' ? flags.icons.split(',') : [], by }));
        break;
      }
      print(patchIssue(rest[0], Object.fromEntries(rest.slice(1).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1) || null])), by));
      break;
    }
    case 'comment': {
      print(commentOnIssue(rest[0], rest.slice(1).join(' '), by));
      break;
    }
    case 'stream': {
      const events = typeof flags.as === 'string' ? issueStreamFor(flags.as) : issueStream(typeof flags.since === 'string' ? flags.since : null);
      if (json) print(events);
      else print(events.length ? events.map((e) => `${e.at}  ${e.type.padEnd(9)} ${e.slug}  ${e.by ?? ''}${e.text ? `: ${e.text}` : ''}`).join('\n') : 'Nothing new.');
      break;
    }
    default:
      print(HELP);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

import { allRecords } from '../lib/records.mjs';

// What people call an icon when they don't know its name. Used by search, per-icon pages,
// and agent lookups. Words in an icon's own name are added automatically, so records list only synonyms.
export const SYNONYMS = Object.fromEntries(allRecords().filter((record) => record.keywords).map((record) => [record.name, record.keywords]));

const STOP_WORDS = new Set(['and', 'the', 'to', 'in', 'of']);

// `record` is optional, for callers that have just read one, such as a running workbench.
export function keywordsFor(icon, record) {
  const words = new Set(icon.name.split('-').filter((w) => !STOP_WORDS.has(w)));
  for (const word of record ? record.keywords ?? [] : SYNONYMS[icon.name.replace(/-solid$/, '')] ?? []) words.add(word);
  for (const alias of icon.aliases) words.add(alias.replace(/-/g, ' '));
  // Not the planning group (such as "Books, weather, and objects"): it named batches of work, not what an
  // icon is, and it made a search for weather return books. The category is the real grouping.
  words.add(icon.category);
  return [...words];
}

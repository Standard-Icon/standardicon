// Finding icons. The scoring matches the CLI's: exact names and aliases rank highest, then whole words of the
// name and keywords, then their starts, then the description of what each icon looks like and when to use it,
// so "bell with a plus" finds bell-plus.

const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// How well one word of a query matches an icon: its whole name or an alias, a word of its name or keywords,
// the start of one of those words, or a word of its description. Words match whole or from their start, never
// from the middle, so "city" doesn't find "opacity".
function termScore(icon, term) {
  if (icon.name === term || icon.aliases.includes(term)) return 10;
  const nameWords = icon.name.split('-');
  const keywordWords = [...icon.aliases, ...icon.keywords].flatMap((k) => k.toLowerCase().split(/[^a-z0-9]+/));
  if (nameWords.includes(term) || keywordWords.includes(term)) return 5;
  if (term.length >= 3 && [...nameWords, ...keywordWords].some((word) => word.startsWith(term))) return 2;
  const described = `${icon.looks ?? ''} ${icon.use ?? ''}`.toLowerCase().split(/[^a-z0-9]+/);
  if (described.includes(term) || (term.length >= 4 && described.some((word) => word.startsWith(term)))) return 1;
  return 0;
}

// Icons that match every word come first. When no icon matches them all, such as "person portrait" where the
// set has no portrait, the icons that match the most words come back instead. Ties go to the plainer name.
export function rank(icons, query, { category } = {}) {
  const terms = words(query).filter((term) => !STOP.has(term));
  if (!terms.length) return [];
  const rows = icons
    .filter((icon) => !category || icon.category === category)
    .map((icon) => {
      const scores = terms.map((term) => termScore(icon, term));
      return { icon, hits: scores.filter(Boolean).length, score: scores.reduce((a, b) => a + b, 0) };
    })
    .filter((row) => row.hits);
  const best = Math.max(0, ...rows.map((row) => row.hits));
  return rows
    .filter((row) => row.hits === best)
    .sort((a, b) => b.score - a.score || a.icon.name.split('-').length - b.icon.name.split('-').length || a.icon.name.length - b.icon.name.length)
    .map((row) => row.icon);
}

// Small words in a description-style query don't have to match anything.
const STOP = new Set(['a', 'an', 'the', 'with', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'icon', 'icons', 'small', 'that', 'is']);

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// Names close to one that doesn't exist: typos first, then icons that match its words.
export function suggest(icons, name, limit = 5) {
  const close = icons
    .map((icon) => ({ icon, d: Math.min(distance(name, icon.name), ...icon.aliases.map((a) => distance(name, a))) }))
    .filter((row) => row.d <= Math.max(2, Math.floor(name.length / 4)))
    .sort((a, b) => a.d - b.d)
    .map((row) => row.icon.name);
  const related = rank(icons, name.replace(/-/g, ' ')).map((icon) => icon.name);
  return [...new Set([...close, ...related])].slice(0, limit);
}

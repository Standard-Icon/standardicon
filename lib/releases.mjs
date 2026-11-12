// The released versions in CHANGELOG.md, for the changelog page and the sitemap's dates.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {object} Release
 * @property {string} version
 * @property {string | undefined} date YYYY-MM-DD
 * @property {string} body The section's markdown, without its heading
 */

/** @returns {Release[]} Newest first, without the Unreleased section. */
export function releases() {
  const text = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  return text
    .split(/^(?=## )/m)
    .filter((block) => block.startsWith('## '))
    .map((block) => {
      const [, version, date] = block.match(/^## (\S+)(?: \((\d{4}-\d{2}-\d{2})\))?/) ?? [];
      return { version, date, body: block.replace(/^## .*\n/, '').trim() };
    })
    .filter((r) => r.version && r.version !== 'Unreleased');
}

/** The newest release's date, or undefined if there's none. */
export const latestReleaseDate = () => {
  const date = releases().find((r) => r.date)?.date;
  return date ? new Date(`${date}T00:00:00Z`) : undefined;
};

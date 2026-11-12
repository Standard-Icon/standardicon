import { createHash } from 'node:crypto';
import { hasWeights } from '@/lib/icon.mjs';
import { COUNT, categories, icons } from '@/lib/site.mjs';
import { SpecimenControls } from './SpecimenControls';

const SAMPLE = 180;

// Icons everyone recognises at a glance, placed every fifth spot so they spread through the rows that show
// in full. The rest of the wall fills in around them.
const FEATURED = ['heart', 'star', 'search', 'settings', 'music', 'lightning-bolt', 'rocket', 'map', 'lock', 'gift', 'brush', 'compass', 'calendar', 'bookmark', 'image', 'mountain', 'moon', 'snowflake', 'fire', 'trophy', 'crown', 'gem', 'tag', 'umbrella', 'wrench'];
const FEATURED_EVERY = 5;

// Left out: icons that read as almost nothing at this size, text or symbols rather than drawings, obscure
// ones, and the gender symbols, which crowd the wall together.
const SKIP = new Set(['power-off', 'space', 'stop', 'stop-circle','hockey-puck', 'dropdown', 'password', 'hdmi-port', 'watermark', 'trademark', 'uppercase', 'option', 'rename', 'roadmap', 'towel-rack', 'kinara', 'mars', 'non-binary', 'venus-mars', 'checkbox', 'caps-lock', 'pizza', 'lungs', 'church']);

// Icons swapped for another in the same spot on the wall.
const SWAP: Record<string, string> = { 'move-down': 'shovel' };

// A spread of the set for the splash page: a few from every category in turn, in a fixed shuffle so
// each build shows the same wall, with the featured icons placed through it. Only icons drawn entirely in
// live strokes, so every weight and size shown is exactly what ships. No modifier variants (a check, plus or
// x on a base icon, cut out, laid over or integrated), no zodiac signs, and none with an empty line, which
// draws a stray dot at the corner. The icon files themselves stay offline until launch.
function sample() {
  const rank = (name: string) => createHash('sha1').update(name).digest('hex');
  // Featured icons follow the same rule as the rest, so one that stops qualifying simply drops out.
  const featured = FEATURED.map((name) => icons.find((icon) => icon.name === name)).filter((icon) => icon !== undefined && hasWeights(icon) && !icon.sizes);
  const eligible = icons.filter(
    (icon) =>
      hasWeights(icon) &&
      !icon.sizes &&
      !SKIP.has(icon.name) &&
      !FEATURED.includes(icon.name) &&
      !/-(overlay|cutout|integrated)$|-key$|^zodiac-/.test(icon.name) &&
      !/<line(?![^>]*\sx1=)/.test(icon.body),
  );
  const byCategory = categories.map((category) =>
    eligible.filter((icon) => icon.category === category).sort((a, b) => rank(a.name).localeCompare(rank(b.name))),
  );
  const spread: typeof icons = [];
  for (let round = 0; spread.length < SAMPLE && byCategory.some((list) => list.length > round); round++) {
    for (const list of byCategory) if (list[round] && spread.length < SAMPLE) spread.push(list[round]);
  }
  const picked: typeof icons = [];
  while (picked.length < SAMPLE && (spread.length || featured.length)) {
    const featureHere = picked.length % FEATURED_EVERY === 2 && featured.length > 0;
    const next = featureHere ? featured.shift() : spread.shift() ?? featured.shift();
    if (next) picked.push(next);
  }
  // Swaps made by hand, in place, so the rest of the wall keeps its order.
  for (const [out, inName] of Object.entries(SWAP)) {
    const at = picked.findIndex((icon) => icon.name === out);
    const replacement = icons.find((icon) => icon.name === inName);
    if (at >= 0 && replacement && !picked.includes(replacement)) picked[at] = replacement;
  }
  return picked;
}

export function SplashSpecimen() {
  return (
    <section className="specimen" id="specimen" aria-labelledby="specimen-title">
      <div className="specimen-head">
        <h2 className="specimen-title" id="specimen-title">{COUNT.toLocaleString('en-US')} interface icons<br />drawn by hand and crafted with care</h2>
        <p className="specimen-sub">MIT licensed • Multiple sizes and weights • Extensive • Ever-growing</p>
      </div>
      <SpecimenControls />
      <ul className="specimen-wall weighted" aria-label={`A sample of the ${COUNT} icons`}>
        {sample().map((icon) => (
          <li key={icon.name} title={icon.title}>
            <svg className="i" viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon.body }} />
          </li>
        ))}
      </ul>
    </section>
  );
}

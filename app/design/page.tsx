import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CSSProperties, ReactNode } from 'react';
import { ActionRows, Cmd, Glyph, Grid, Page, Section } from '@/components/ui';
import { LIMITS, SIZES, WEIGHTS, strokeFor } from '@/lib/icon.mjs';
import { pageMetadata } from '@/lib/metadata';
import { CLI, NAME, icons, type Icon } from '@/lib/site.mjs';

// This page shows the real styles, so it can't drift from them. Specimens use the site's own classes
// and components, and values and counts are read from globals.css when the site is built.
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8').split('/* Design system page */')[0];
const [siteCss, examplesCss = ''] = css.split('/* Examples:');

export const metadata = {
  ...pageMetadata({
    path: '/design/',
    title: `Design system | ${NAME}`,
    description: `The colors, type, shapes, and components ${NAME} is built from.`,
  }),
  robots: { index: false, follow: false },
};

// --- Reading the CSS ---

const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
const tokens = [...rootBlock.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => ({ name, value }));
const colorTokens = tokens.filter((token) => token.value.startsWith('#'));

const readable = (value: string) =>
  value.replace(/var\(--display\)/, 'Polymath Display').replace(/var\(--text\)/, 'Polymath Text');

// The font of a rule in globals.css. A selector that has gone away should stop the build, not show a stale value.
function fontOf(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const font = new RegExp(`${escaped}\\s*\\{[^}]*?\\bfont:\\s*([^;]+);`).exec(css)?.[1];
  if (!font) throw new Error(`The design page can't find a font for "${selector}" in globals.css.`);
  return font;
}

const radiusCount = (source: string, value: string) =>
  [...source.matchAll(/border-radius:\s*([^;\s}]+)/g)].filter(([, found]) => found === value).length;

const RADIUS_VALUE = tokens.find((token) => token.name === '--radius')?.value ?? '14px';
const radiusValues = [...new Set([...css.matchAll(/border-radius:\s*([^;\s}]+)/g)].map(([, value]) => value))]
  .filter((value) => /^\d+px$/.test(value))
  .sort((a, b) => parseInt(b) - parseInt(a));
const radii = radiusValues.map((value) => {
  const viaToken = value === RADIUS_VALUE ? 'var(--radius)' : null;
  return {
    value,
    site: radiusCount(siteCss, value) + (viaToken ? radiusCount(siteCss, viaToken) : 0),
    examples: radiusCount(examplesCss, value) + (viaToken ? radiusCount(examplesCss, viaToken) : 0),
  };
});

const RADIUS_USES: Record<string, string> = {
  '999px': 'Buttons, pills, and segmented controls',
  [RADIUS_VALUE]: 'Icon tiles and menus',
  '18px': 'The large icon figure',
  '12px': 'Code blocks',
  '10px': 'Items inside menus',
};

const tokenHexes = new Set(colorTokens.map((token) => token.value.toLowerCase()));
const strayColors = [...new Set([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(([hex]) => hex.toLowerCase()))].filter((hex) => !tokenHexes.has(hex));
const shadowCount = [...css.matchAll(/box-shadow:\s*0 8px 24px/g)].length;

// --- Content ---

const COLOR_USES: Record<string, string> = {
  '--green': 'The poster, and hover on tiles and rows',
  '--green-deep': 'Text on white buttons',
  '--ink': 'Text, and anything selected',
  '--paper': 'The page, and text on green or ink',
  '--soft': 'Secondary text',
  '--hair': 'Rules and pixel grid lines',
  '--tile': 'Icon tiles and quiet controls',
};

const TYPE: { selector: string; use: string; sample: string; font?: string; className?: string }[] = [
  { selector: '.big.word', use: 'Poster headline', sample: 'Agents', className: 'big word', font: 'Polymath Display 950, min(11vw, 150px)' },
  { selector: '.detail-side h1', use: 'Icon names on their pages', sample: 'arrow-up' },
  { selector: '.group-title', use: 'Group titles above a grid', sample: 'Navigation' },
  { selector: '.titlebar', use: 'The title under a poster', sample: 'Agents and CLI' },
  { selector: '.wordmark', use: 'The wordmark', sample: NAME },
  { selector: '.side .lede', use: 'Poster intro text', sample: 'Finely crafted interface icons in multiple sizes.' },
  { selector: 'body', use: 'Body text', sample: 'Lines grow with the icon, like text.' },
  { selector: '.btn', use: 'Buttons and labels', sample: 'Copy agent prompt' },
];

const PRINCIPLES = [
  'One muted green, black, and white.',
  'Mostly rounded. Corners are soft and controls are pills.',
  'Left aligned, on a strict 12-column grid.',
  'Restrained, with no decorative extras.',
  'Sentence-case labels and plain button text, such as “Save”.',
  'Icons always sit on a tile.',
];

const WEIGHT_LABELS: Record<string, string> = { thin: 'Thin', regular: 'Regular', semibold: 'Semibold', bold: 'Bold', black: 'Black' };

const find = (name: string) => icons.find((icon) => icon.name === name);
const sample = find('search') ?? icons[0];
const samples = ['search', 'check', 'ruler', 'apps', 'layout-grid', 'pane', 'close', 'chevron-right']
  .map(find)
  .filter((icon): icon is Icon => Boolean(icon));

function Note({ children }: { children: ReactNode }) {
  return <span className="ds-note">{children}</span>;
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ds-specimen">
      <div>{children}</div>
      <Note>{label}</Note>
    </div>
  );
}

function TileState({ label, style, className = '', centered = false }: { label: string; style?: CSSProperties; className?: string; centered?: boolean }) {
  return (
    <Specimen label={label}>
      <div className={`cell ds-tile ${className}`} style={style}>
        <span className={centered ? 'hit ds-centered' : 'hit'}><Glyph body={sample.body} /></span>
        {!centered && <span className="label">{sample.name}</span>}
      </div>
    </Specimen>
  );
}

export default function DesignPage() {
  return (
    <Page
      poster={
        <>
          <p className="big word" aria-hidden="true">Design</p>
          <div className="side">
            <p className="lede">The colors, type, shapes, and components this site is built from.</p>
          </div>
          <h1 className="titlebar"><span>Design system</span><span>{tokens.length} tokens</span></h1>
        </>
      }
    >
      <Section title="How to use this">
        <p>Everything here is rendered from the site&apos;s real styles in <code>app/globals.css</code>, so it always matches. Reuse what&apos;s here. If you need something new, add it there first, and it shows up here.</p>
      </Section>

      <Section title="Principles">
        <ul className="links">{PRINCIPLES.map((line) => <li key={line}>{line}</li>)}</ul>
      </Section>

      <Section title="Color">
        <ul className="ds-swatches">
          {colorTokens.map(({ name, value }) => (
            <li key={name}>
              <div className="ds-chip" style={{ background: `var(${name})` }} />
              <b>{name}</b>
              <Note>{value}</Note>
              <Note>{COLOR_USES[name] ?? 'Not described yet'}</Note>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <ul className="ds-type">
          {TYPE.map(({ selector, use, sample: text, font, className }) => {
            const spec = font ?? fontOf(selector);
            return (
              <li key={selector}>
                <div className={className} style={className ? undefined : { font: spec }}>{text}</div>
                <Note>{use}: <code>{selector}</code>, {readable(spec)}</Note>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Corners">
        <ul className="ds-radii">
          {radii.map(({ value, site, examples }) => (
            <li key={value}>
              <div className="ds-radius" style={{ borderRadius: value }} />
              <b>{value}</b>
              <Note>{RADIUS_USES[value] ?? (site === 0 ? 'Only in the example mockups' : 'Not described yet')}</Note>
              <Note>Used {site} on the site, {examples} in examples</Note>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Layout">
        <p>Pages use 12 columns with 16px gaps and {tokens.find((token) => token.name === '--pad')?.value} of page padding, or 36px at 760px wide and below. Tiles sit 6px apart, or 5px on phones.</p>
        <div className="ds-columns" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => <span key={index}>{index + 1}</span>)}
        </div>
      </Section>

      <Section title="Icons">
        <p>Every size is the 16px drawing scaled up, so lines grow with the icon, like text. Regular is a 1.33px line at 18, the default size, 1.18px at 16 and 1.78px at 24. Icons draw in <code>currentColor</code> and pick up the text color around them.</p>
        <ul className="ds-icon-row" aria-label="Every size">
          {SIZES.map((size) => (
            <li key={size}>
              <svg className="weighted" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sample.body }} />
              <span>{size}</span>
            </li>
          ))}
        </ul>
        <p>{LIMITS}</p>
        <ul className="ds-icon-row" aria-label="Every weight, at 48">
          {Object.entries(WEIGHTS).map(([weight, width]) => (
            <li key={weight} style={{ '--weight': strokeFor(weight as keyof typeof WEIGHTS) } as CSSProperties}>
              <svg className="weighted" width={48} height={48} viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sample.body }} />
              <span>{WEIGHT_LABELS[weight]}, {width}px at 18</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Icon tiles">
        <p>Always show icons on a tile. These are live, so try hovering and clicking.</p>
        <div className="ds-grid"><Grid list={samples} /></div>
        <div className="ds-row" inert>
          <TileState label="Rest" />
          <TileState label="Hover and focus" style={{ background: 'var(--green)', color: 'var(--paper)' }} className="ds-on" />
          <TileState label="Selected or copied" className="copied" />
          <TileState label="Icons only" centered />
        </div>
      </Section>

      <Section title="Large icon">
        <p>One icon or drawing shown big on its pixel grid, on white or on the poster.</p>
        <div className="ds-row ds-figures">
          <div className="stage-figure">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sample.body }} />
          </div>
          <div className="poster ds-figure-wrap">
            <div className="figure ds-figure">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sample.body }} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="poster ds-green ds-panel">
          <Specimen label=".btn"><button className="btn" type="button">Save</button></Specimen>
          <Specimen label=".btn.quiet"><button className="btn quiet" type="button">Undo</button></Specimen>
        </div>
        <div className="ds-panel">
          <Specimen label=".btn.dark"><button className="btn dark" type="button">Save</button></Specimen>
          <Specimen label=".btn.dark.quiet"><button className="btn dark quiet" type="button">Undo</button></Specimen>
          <Specimen label=".stage-nav button">
            <div className="stage-nav ds-nav">
              <button type="button" aria-label="Previous"><Glyph body={find('chevron-left')?.body ?? ''} /></button>
              <button type="button" aria-label="Next"><Glyph body={find('chevron-right')?.body ?? ''} /></button>
            </div>
          </Specimen>
          <Specimen label="Focus: 2px outline, 2px offset">
            <button className="btn dark quiet ds-focus" type="button">Focused</button>
          </Specimen>
        </div>
      </Section>

      <Section title="Controls">
        <div className="ds-panel">
          <Specimen label=".sizes">
            <fieldset className="sizes">
              <legend>Size</legend>
              {[16, 20, 24].map((size) => (
                <label key={size}><input type="radio" name="ds-size" defaultChecked={size === 16} /><span>{size}</span></label>
              ))}
            </fieldset>
          </Specimen>
          <Specimen label=".sizes.weights">
            <fieldset className="sizes weights">
              <legend>Weight</legend>
              {['Regular', 'Medium', 'Bold'].map((weight) => (
                <label key={weight}><input type="radio" name="ds-weight" defaultChecked={weight === 'Regular'} /><span>{weight}</span></label>
              ))}
            </fieldset>
          </Specimen>
          <Specimen label=".views">
            <fieldset className="views">
              <legend className="sr">View</legend>
              {['apps', 'layout-grid', 'pane'].map((name, index) => (
                <label key={name}>
                  <input type="radio" name="ds-view" defaultChecked={index === 0} />
                  <span><Glyph body={find(name)?.body ?? ''} /><span className="sr">{name}</span></span>
                </label>
              ))}
            </fieldset>
          </Specimen>
        </div>
      </Section>

      <Section title="Surfaces">
        <Cmd text={`${CLI} add arrow-up`} copied="Copied command" />
        <div className="ds-row ds-surfaces" inert>
          <Specimen label=".menu">
            <div className="menu ds-static">
              <p className="menu-head"><b>{sample.name}</b> <span>16</span></p>
              <ActionRows />
            </div>
          </Specimen>
          <Specimen label=".toast">
            <div className="toast on ds-static">Copied command</div>
          </Specimen>
        </div>
      </Section>

      <Section title="Still to decide">
        <ul className="links">
          <li>There are {radiusValues.length} corner sizes. The proposal is to settle on 999px, 18px, 14px, and 10px, and move the example mockups onto them.</li>
          {strayColors.length > 0 && <li>{strayColors.length} colors aren&apos;t tokens yet: {strayColors.join(', ')}.</li>}
          {!css.includes(':disabled') && <li>Buttons have no disabled style. The splash page had to define its own.</li>}
          {shadowCount > 1 && <li>The floating shadow is repeated {shadowCount} times and could be a token.</li>}
        </ul>
      </Section>
    </Page>
  );
}

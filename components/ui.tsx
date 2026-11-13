import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { DEFAULT_SIZE, SIZES, WEIGHTS, bodyFor, hasWeights } from '@/lib/icon.mjs';
import { CLI, COUNT, CREATOR, NAME, ORIGIN, REQUEST_ICON, categoryTitle, icons, inCategory, type Icon } from '@/lib/site.mjs';

const bodyOf = (name: string) => icons.find((i) => i.name === name)?.body ?? '';

export function Glyph({ body }: { body: string }) {
  return <svg className="i" viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: body }} />;
}

// Labels are plain links on purpose: a next/link in every cell would hydrate hundreds of client components.
function Cell({ icon }: { icon: Icon }) {
  return (
    <li className="cell" data-name={icon.name} data-k={[icon.name, ...icon.keywords].join(' ')} data-fixed={hasWeights(icon) ? undefined : ''}>
      <button className="hit" type="button" title={icon.name} aria-label={`${icon.name}: copy or download`} aria-haspopup="dialog" aria-expanded="false">
        <Glyph body={icon.body} />
      </button>
      <a className="label" href={`/icons/${icon.name}/`}>{icon.name}</a>
    </li>
  );
}

export function Grid({ list }: { list: Icon[] }) {
  return <ul className="grid">{list.map((icon) => <Cell key={icon.name} icon={icon} />)}</ul>;
}

const WEIGHT_LABELS: Record<string, string> = { thin: 'Thin', regular: 'Regular', semibold: 'Semibold', bold: 'Bold', black: 'Black' };

function WeightPicker() {
  return (
    <fieldset className="sizes weights">
      <legend className="sr">Weight</legend>
      {Object.keys(WEIGHTS).map((weight) => (
        <label key={weight}>
          <input type="radio" name="weight" value={weight} defaultChecked={weight === 'regular'} />
          <span>{WEIGHT_LABELS[weight]}</span>
        </label>
      ))}
    </fieldset>
  );
}

function SizePicker() {
  return (
    <fieldset className="sizes">
      <legend className="sr">Size</legend>
      {SIZES.map((size) => (
        <label key={size}>
          <input type="radio" name="size" value={size} defaultChecked={size === DEFAULT_SIZE} />
          <span>{size}</span>
        </label>
      ))}
    </fieldset>
  );
}

// Search on its own row, with size, weight, and the view switcher in a toolbar below it. The pickers are
// plain words and numbers, as on the splash page, with their labels for screen readers only.
// Icon pages have no search or views, only the toolbar.
export function SearchBar({ search = true }: { search?: boolean }) {
  const glyph = icons.find((i) => i.name === 'search');
  const close = icons.find((i) => i.name === 'close');
  return (
    <div className="bar">
      {search && (
        <div className="search">
          <label htmlFor="q">
            {glyph && <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: bodyFor(glyph, 24) }} />}
            <span className="sr">Search icons</span>
          </label>
          <input id="q" type="search" placeholder={`Search ${COUNT} icons`} autoComplete="off" spellCheck={false} />
          <p className="sr" id="search-status" role="status" aria-live="polite" />
          <button className="clear" id="clear-search" type="button" aria-label="Clear search" hidden>
            <Glyph body={close?.body ?? ''} />
          </button>
        </div>
      )}
      <div className="tools">
        <SizePicker />
        <WeightPicker />
        <MobilePickers />
        {search && <ViewSwitcher />}
      </div>
    </div>
  );
}

const VIEWS = [
  { value: 'icons', label: 'Icons only', glyph: 'apps' },
  { value: 'labels', label: 'Icons and names', glyph: 'layout-grid' },
  { value: 'large', label: 'Large preview', glyph: 'pane' },
];

function ViewSwitcher() {
  return (
    <fieldset className="views">
      <legend className="sr">View</legend>
      {VIEWS.map((view) => (
        <label key={view.value} title={view.label}>
          <input type="radio" name="view" value={view.value} defaultChecked={view.value === 'labels'} />
          <span>
            <Glyph body={icons.find((i) => i.name === view.glyph)?.body ?? ''} />
            <span className="sr">{view.label}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

// The large view: one icon at a time, drawn big on its pixel grid, with arrows to step through
// whatever the search shows. Interactions fills it in.
export function Stage() {
  const step = (name: string) => icons.find((i) => i.name === name)?.body ?? '';
  return (
    <section className="stage" id="stage" aria-label="Large preview">
      <div className="stage-figure" id="stage-figure" />
      <div className="stage-side">
        <div>
          <p className="stage-count" id="stage-count" aria-live="polite" />
          <h2 className="stage-name"><a id="stage-name" href="/" /></h2>
          <p className="stage-group" id="stage-group" />
        </div>
        <ActionRows />
        <div className="stage-nav">
          <button type="button" data-stage-step="-1" aria-label="Previous icon" title="Previous (←)"><Glyph body={step('chevron-left')} /></button>
          <button type="button" data-stage-step="1" aria-label="Next icon" title="Next (→)"><Glyph body={step('chevron-right')} /></button>
        </div>
      </div>
    </section>
  );
}

// On narrower screens the two pill rows become dropdowns in the toolbar. The radio inputs above
// stay the single source of truth.
//
// The buttons are icon-only: weight is a squircle drawn at the current line thickness, and size is a ruler.
// The options are plain words and numbers.
const SQUIRCLE = '<path d="M8 2.5C12.53 2.5 13.5 3.47 13.5 8C13.5 12.53 12.53 13.5 8 13.5C3.47 13.5 2.5 12.53 2.5 8C2.5 3.47 3.47 2.5 8 2.5Z" stroke="currentColor" stroke-linejoin="round"/>';

function MobilePickers() {
  const pickers = [
    {
      name: 'weight',
      label: 'Weight',
      trigger: <svg className="mpick-squircle" width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SQUIRCLE }} />,
      options: Object.keys(WEIGHTS).map((value) => ({ value, text: WEIGHT_LABELS[value] })),
    },
    {
      name: 'size',
      label: 'Size',
      trigger: <Glyph body={icons.find((i) => i.name === 'ruler')?.body ?? ''} />,
      options: SIZES.map((size) => ({ value: String(size), text: String(size) })),
    },
  ];
  return (
    <div className="mpicks">
      {pickers.map((picker) => (
        <div className="mpick" key={picker.name}>
          <button className="mpick-toggle" type="button" data-mpick-toggle={picker.name} aria-label={picker.label} aria-haspopup="listbox" aria-expanded="false">
            {picker.trigger}
          </button>
          <ul className="mpick-list" role="listbox" aria-label={picker.label} data-mpick-list={picker.name} hidden>
            {picker.options.map((option) => (
              <li key={option.value}>
                <button type="button" role="option" aria-selected="false" data-mpick={picker.name} data-value={option.value}>
                  {option.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Where "Request it" points. TODO(Morgan): confirm the address, or switch to the GitHub icon-request
// issue template once the public repo exists. Interactions adds the search to the subject.
// The GitHub icon request form, titled with the search. Interactions.tsx appends ": <search>".
const ICON_REQUEST_URL = `${REQUEST_ICON}&title=Icon%20request`;

// Shown when a search finds nothing. Interactions fills in the words and the close matches.
export function EmptyState() {
  return (
    <div className="empty" id="empty" hidden>
      <p>No icons match <b id="empty-q" />.</p>
      <div className="empty-suggest" id="empty-suggest" hidden>
        <p id="empty-suggest-label">Did you mean</p>
        <div className="actions" id="empty-suggestions" role="group" aria-labelledby="empty-suggest-label" />
      </div>
      <p className="empty-more">
        Try a broader word, like arrow or file. Still missing? <a id="empty-request" href={ICON_REQUEST_URL} data-base={ICON_REQUEST_URL}>Request it</a> and it may be drawn next.
      </p>
    </div>
  );
}

export function CategorySection({ category }: { category: string }) {
  const list = inCategory(category);
  return (
    <section data-group id={category}>
      <h2 className="group-title">
        <Link href={`/categories/${category}/`} prefetch={false}>{categoryTitle(category)}</Link>
        <span className="n">{list.length}</span>
      </h2>
      <Grid list={list} />
    </section>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      <div className="body">{children}</div>
    </section>
  );
}

export function Cmd({ text, copied, wrap = false }: { text: string; copied: string; wrap?: boolean }) {
  return (
    <div className="cmd">
      <pre className={wrap ? 'code wrap' : 'code'}><code>{text}</code></pre>
      <button className="btn dark quiet" type="button" data-copy={text} data-copied={copied}>Copy</button>
    </div>
  );
}

// One menu for the whole page, positioned under whichever icon was clicked.
export function IconMenu() {
  return (
    <div id="icon-menu" className="menu" role="dialog" aria-label="Copy or download this icon" hidden>
      <p className="menu-head"><b id="menu-name" /> <span id="menu-size" /></p>
      <p className="menu-note" id="menu-note" hidden>Regular only, because this icon has filled shapes.</p>
      <a id="menu-link" className="view-row" href="/"><span>View</span><span>Icon page, every size, and code</span></a>
      <ActionRows />
    </div>
  );
}

// Copy and download for each format, as icon buttons named for screen readers and tooltips.
export function ActionRows({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className={onDark ? 'action-rows on-dark' : 'action-rows'}>
      {(['svg', 'png'] as const).map((format) => (
        <div className="action-row" key={format}>
          <span>{format.toUpperCase()}</span>
          <button type="button" data-action={`${format}-copy`} aria-label={`Copy ${format.toUpperCase()}`} title={`Copy ${format.toUpperCase()}`}><Glyph body={bodyOf('copy')} /></button>
          <button type="button" data-action={`${format}-download`} aria-label={`Download ${format.toUpperCase()}`} title={`Download ${format.toUpperCase()}`}><Glyph body={bodyOf('download')} /></button>
        </div>
      ))}
    </div>
  );
}

// Every way to use an icon, in one box: pick a tab and copy what's in it. Interactions fills each tab in for
// the size and weight picked, so this markup only carries the starting SVG and what the tabs need to know.
export const CODE_TABS = [
  { id: 'svg', label: 'SVG', note: 'Paste it into HTML. It draws in currentColor, so it takes the colour of the text around it.' },
  { id: 'jsx', label: 'JSX', note: 'The same drawing for React, with React’s attribute names.' },
  { id: 'css', label: 'CSS', note: 'A CSS mask, coloured by currentColor. Change the width and height to resize it.' },
  { id: 'url', label: 'URL', note: 'The raw file at this size and weight.' },
  { id: 'npx', label: 'npx', note: 'Writes the SVG into ./icons in your project. Nothing to install first.' },
  { id: 'agent', label: 'Agent', note: 'Paste it into a coding agent, like Claude Code or Cursor. It reads llms.txt and adds the icon.' },
  { id: 'mcp', label: 'MCP', note: 'Gives your agent the whole set as tools: searching, and getting any icon at any size and weight. For Claude Code, run: claude mcp add standardicon -- npx -y @standardicon/mcp' },
] as const;

export const MCP_CONFIG = '{\n  "mcpServers": {\n    "standardicon": { "command": "npx", "args": ["-y", "@standardicon/mcp"] }\n  }\n}';

export function CodeTabs({ name, svg }: { name: string; svg: string }) {
  return (
    <div className="code-tabs" id="code-tabs" data-name={name} data-cli={CLI} data-origin={ORIGIN} data-mcp={MCP_CONFIG}>
      <fieldset className="sizes code-tab-list">
        <legend className="sr">Format</legend>
        {CODE_TABS.map((tab) => (
          <label key={tab.id}>
            <input type="radio" name="code-tab" value={tab.id} defaultChecked={tab.id === 'svg'} data-note={tab.note} />
            <span>{tab.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="code-panel">
        <pre className="code"><code id="code-text">{svg}</code></pre>
        <button className="code-copy" type="button" id="code-copy" aria-label="Copy" title="Copy"><Glyph body={bodyOf('copy')} /></button>
      </div>
      <p className="code-note" id="code-note">{CODE_TABS[0].note}</p>
    </div>
  );
}

export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

// The site's own icons sit beside each link in the nav.
// The green poster that opens every page. Its contents go in the 12-column grid below the masthead.
// The home page leaves out the wordmark, because its poster has the full logo instead.
export function Poster({ children, wordmark = true, className }: { children: ReactNode; wordmark?: boolean; className?: string }) {
  return (
    <header className={className ? `poster ${className}` : 'poster'}>
      <div className="masthead">
        {wordmark && <Link className="wordmark" href="/" prefetch={false}><Logo />{NAME}</Link>}
        <nav aria-label="Site">
          <Link href="/" prefetch={false}><Glyph body={bodyOf('layout-grid')} />Icons</Link>
          <Link href="/examples/"><Glyph body={bodyOf('app-window')} />Examples</Link>
          <Link href="/agents/"><Glyph body={bodyOf('agent')} />Agents</Link>
          <Link href="/license/" prefetch={false}><Glyph body={bodyOf('certificate')} />MIT</Link>
        </nav>
      </div>
      {children}
    </header>
  );
}

export function Page({ poster, children, wordmark = true, posterClass }: { poster: ReactNode; children: ReactNode; wordmark?: boolean; posterClass?: string }) {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Poster wordmark={wordmark} className={posterClass}>{poster}</Poster>
      <main id="main">{children}</main>
      <footer className="foot">
        <p>{COUNT} icons, free under the <Link href="/license/" prefetch={false}>MIT license</Link>. Drawn by {CREATOR}. The set is still growing.</p>
        <p><Link href="/examples/">Examples</Link> <Link href="/agents/">Agents and CLI</Link> <a href="/icons.json">icons.json</a> <a href="/llms.txt">llms.txt</a> <Link href="/changelog/" prefetch={false}>Changelog</Link> <Link href="/license/" prefetch={false}>License</Link> <Link href="/privacy/" prefetch={false}>Privacy</Link> <button className="foot-link" type="button" data-consent-open="">Privacy choices</button></p>
      </footer>
    </>
  );
}

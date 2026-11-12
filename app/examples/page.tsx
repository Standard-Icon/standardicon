import type { ReactNode } from 'react';
import { DM_Sans, IBM_Plex_Mono, IBM_Plex_Sans, Inter, Source_Serif_4, Space_Grotesk } from 'next/font/google';
import Link from 'next/link';
import { ExampleInteractions } from '@/components/ExampleInteractions';
import { Page } from '@/components/ui';
import { WEIGHTS, bodyFor, weighBody } from '@/lib/icon.mjs';
import { pageMetadata } from '@/lib/metadata';
import { COUNT, NAME, icons } from '@/lib/site.mjs';

export const metadata = pageMetadata({
  path: '/examples/',
  title: `Icons in real interfaces | ${NAME}`,
  description: `See ${NAME} at work in interfaces you can click: an app sidebar, an editor toolbar, a media player, chat, settings, files, notifications, a phone app, a pull request, and a checkout.`,
});

type Weight = keyof typeof WEIGHTS;

// Typefaces to try the mocks in. next/font downloads them at build time and serves them from this site.
const inter = Inter({ subsets: ['latin'], variable: '--ex-inter', display: 'swap' });
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '700'], variable: '--ex-plex', display: 'swap' });
const dm = DM_Sans({ subsets: ['latin'], variable: '--ex-dm', display: 'swap' });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--ex-grotesk', display: 'swap' });
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--ex-serif', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--ex-mono', display: 'swap' });
const FONT_VARS = [inter, plex, dm, grotesk, serif, mono].map((font) => font.variable).join(' ');

const FONTS = [
  { label: 'Polymath', family: 'var(--text)' },
  { label: 'System', family: 'system-ui, -apple-system, sans-serif' },
  { label: 'Inter', family: 'var(--ex-inter)' },
  { label: 'IBM Plex Sans', family: 'var(--ex-plex)' },
  { label: 'DM Sans', family: 'var(--ex-dm)' },
  { label: 'Space Grotesk', family: 'var(--ex-grotesk)' },
  { label: 'Source Serif', family: 'var(--ex-serif)' },
  { label: 'IBM Plex Mono', family: 'var(--ex-mono)' },
];

// Each mock draws its icons through `use`, which also records them for the caption underneath.
// A name that isn't in the set fails the build, so the examples can't drift from what ships.
function iconSet() {
  const used = new Set<string>();
  const use = (name: string, size = 20, weight: Weight = 'regular') => {
    const icon = icons.find((i) => i.name === name);
    if (!icon) throw new Error(`Examples use "${name}", which isn't in the set.`);
    used.add(name);
    return <svg className="ex-i" width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: weighBody(bodyFor(icon, size), weight) }} />;
  };
  // Two icons in one spot, such as play and pause. The `.on` class on the parent picks which shows.
  const swap = (off: ReactNode, on: ReactNode) => (
    <>
      <span className="ex-off">{off}</span>
      <span className="ex-on">{on}</span>
    </>
  );
  return { use, swap, used };
}
type Kit = ReturnType<typeof iconSet>;

// Interactions are wired by data attributes and handled in ExampleInteractions:
//   data-ex-pick       a group where one [data-ex-item] is selected at a time
//   data-ex-toggle     flips .on and aria-pressed
//   data-ex-action     anything more specific, handled by name
const Toggle = ({ on, label }: { on: boolean; label: string }) => (
  <button type="button" className={on ? 'ex-toggle on' : 'ex-toggle'} data-ex-toggle aria-pressed={on} aria-label={label} />
);

const MOCKS: { title: string; spec: string; wide?: boolean; draw: (kit: Kit) => ReactNode }[] = [
  {
    title: 'App sidebar',
    spec: '20px, regular',
    draw: ({ use }) => (
      <nav className="ex-sidebar">
        <p className="ex-workspace">{use('organization')} Northwind</p>
        <div className="ex-nav" data-ex-pick>
          <button type="button" data-ex-item className="on">{use('home')} Home</button>
          <button type="button" data-ex-item>{use('inbox')} Inbox <span className="ex-badge">12</span></button>
          <button type="button" data-ex-item>{use('calendar')} Calendar</button>
          <button type="button" data-ex-item>{use('files')} Files</button>
          <button type="button" data-ex-item>{use('chart')} Reports</button>
          <button type="button" data-ex-item>{use('person-circle')} Account</button>
        </div>
        <button type="button" className="ex-foot" data-ex-action="flash">{use('logout')} Sign out</button>
      </nav>
    ),
  },
  {
    title: 'Media player',
    spec: '20px regular, with a 40px regular play button',
    draw: ({ use, swap }) => (
      <div className="ex-player" data-ex-player data-tracks={JSON.stringify([['Night Drive', 'Low Tide', 221], ['Paper Moons', 'Halcyon', 187], ['Glasshouse', 'Mira Vale', 254]])}>
        <div className="ex-art">{use('music', 40, 'regular')}</div>
        <p className="ex-track"><b data-ex-title>Night Drive</b><span data-ex-artist>Low Tide</span></p>
        <div className="ex-progress" data-ex-seek="progress"><span data-ex-bar style={{ width: '38%' }} /></div>
        <p className="ex-times"><span data-ex-time>1:24</span><span data-ex-length>3:41</span></p>
        <div className="ex-controls">
          <button type="button" data-ex-toggle aria-pressed="false" aria-label="Shuffle">{use('shuffle')}</button>
          <button type="button" data-ex-action="prev" aria-label="Previous track">{use('skip-back', 24)}</button>
          <button type="button" className="ex-play" data-ex-action="play" aria-label="Play">{swap(use('play', 40, 'regular'), use('pause', 40, 'regular'))}</button>
          <button type="button" data-ex-action="next" aria-label="Next track">{use('skip-forward', 24)}</button>
          <button type="button" data-ex-toggle aria-pressed="false" aria-label="Repeat">{use('repeat')}</button>
        </div>
        <div className="ex-volume">
          <button type="button" data-ex-action="mute" aria-label="Mute">{use('volume-low', 18)}</button>
          <div className="ex-progress" data-ex-seek="volume"><span style={{ width: '64%' }} /></div>
          <button type="button" data-ex-action="loud" aria-label="Full volume">{use('volume-high', 18)}</button>
        </div>
      </div>
    ),
  },
  {
    title: 'Editor toolbar',
    spec: '18px, regular',
    wide: true,
    draw: ({ use, swap }) => (
      <div className="ex-editor" data-ex-editor>
        <div className="ex-toolbar">
          <button type="button" data-ex-action="flash" aria-label="Undo">{use('undo', 18)}</button>
          <button type="button" data-ex-action="flash" aria-label="Redo">{use('redo', 18)}</button>
          <i />
          <button type="button" data-ex-toggle data-ex-format="heading" aria-pressed="false" aria-label="Heading">{use('heading-1', 18)}</button>
          <button type="button" data-ex-toggle data-ex-format="bold" aria-pressed="false" aria-label="Bold">{use('bold', 18)}</button>
          <button type="button" data-ex-toggle data-ex-format="italic" aria-pressed="false" aria-label="Italic">{use('italic', 18)}</button>
          <button type="button" data-ex-toggle data-ex-format="underline" aria-pressed="false" aria-label="Underline">{use('underline', 18)}</button>
          <button type="button" data-ex-toggle data-ex-format="strike" aria-pressed="false" aria-label="Strikethrough">{use('strikethrough', 18)}</button>
          <i />
          <button type="button" data-ex-toggle data-ex-format="link" aria-pressed="false" aria-label="Link">{use('link', 18)}</button>
          <button type="button" data-ex-toggle data-ex-format="bullets" aria-pressed="false" aria-label="Bulleted list">{use('bullet-list', 18)}</button>
          <button type="button" data-ex-action="flash" aria-label="Checklist">{use('list-check', 18)}</button>
          <button type="button" data-ex-toggle data-ex-format="code" aria-pressed="false" aria-label="Code">{use('code-block', 18)}</button>
          <i />
          <span className="ex-align" data-ex-pick>
            <button type="button" data-ex-item data-ex-align="left" className="on" aria-label="Align left">{use('align-text-left', 18)}</button>
            <button type="button" data-ex-item data-ex-align="center" aria-label="Align center">{use('align-text-center', 18)}</button>
          </span>
        </div>
        <div className="ex-doc">
          <h3>Launch notes</h3>
          <p data-ex-text>Ship the icon set with every size and weight, then update the docs before Friday.</p>
          <button type="button" className="ex-check on" data-ex-toggle aria-pressed="true">{swap(use('checkbox', 18), use('checkbox-checked', 18))} Export SVGs</button>
          <button type="button" className="ex-check" data-ex-toggle aria-pressed="false">{swap(use('checkbox', 18), use('checkbox-checked', 18))} Write the changelog</button>
        </div>
      </div>
    ),
  },
  {
    title: 'Chat',
    spec: '20px, regular',
    draw: ({ use }) => (
      <div className="ex-chat">
        <header>{use('messages')} <b>#design</b><span>
          <button type="button" data-ex-action="flash" aria-label="Call">{use('phone-call', 18)}</button>
          <button type="button" data-ex-action="flash" aria-label="Video call">{use('video-call', 18)}</button>
          <button type="button" data-ex-action="flash" aria-label="More">{use('more-vertical', 18)}</button>
        </span></header>
        <div className="ex-thread" data-ex-thread>
          <p className="them">Are the new arrows in?</p>
          <p className="me">Yes, all four sizes. Sending the SVGs now.</p>
          <p className="ex-file">{use('file-zip')} arrows.zip<button type="button" data-ex-action="flash" aria-label="Download arrows.zip">{use('download', 18)}</button></p>
        </div>
        <form className="ex-compose" data-ex-compose>
          <button type="button" data-ex-action="flash" aria-label="Attach a file">{use('attach')}</button>
          <button type="button" data-ex-action="mention" aria-label="Mention someone">{use('at-sign')}</button>
          <input className="ex-input" name="message" placeholder="Message #design" autoComplete="off" aria-label="Message" />
          <button type="submit" className="ex-send" aria-label="Send">{use('send', 18, 'regular')}</button>
        </form>
      </div>
    ),
  },
  {
    title: 'Settings',
    spec: '20px, regular',
    draw: ({ use }) => (
      <ul className="ex-settings">
        <li>{use('wifi')} Wi-Fi <span>Home</span> <Toggle on label="Wi-Fi" /></li>
        <li>{use('airplane-mode')} Airplane mode <Toggle on={false} label="Airplane mode" /></li>
        <li>{use('bell')} Notifications <Toggle on label="Notifications" /></li>
        <li>{use('lock')} Passcode <Toggle on label="Passcode" /></li>
        <li>{use('globe-simple')} Language <span>English</span></li>
        <li>{use('cloud')} Backup <span>Today, 9:41</span></li>
      </ul>
    ),
  },
  {
    title: 'Files',
    spec: '20px regular, actions at 18px',
    wide: true,
    draw: ({ use }) => (
      <div className="ex-files">
        <header>
          <b>Files</b>
          <label className="ex-field">{use('search', 18)}<input data-ex-filter placeholder="Search files" autoComplete="off" aria-label="Search files" /></label>
          <button type="button" className="ex-button" data-ex-action="flash">{use('upload', 18, 'regular')} Upload</button>
        </header>
        <table>
          <tbody>
            {[
              ['file-pdf', 'Q3 report.pdf', '2.4 MB', 'Today'],
              ['file-image', 'Hero banner.png', '840 KB', 'Yesterday'],
              ['file-zip', 'Brand assets.zip', '18 MB', 'Mon'],
              ['file-text', 'Meeting notes.md', '6 KB', 'Mon'],
              ['file-spreadsheet', 'Budget 2027.xlsx', '120 KB', 'Oct 2'],
            ].map(([icon, name, size, date]) => (
              <tr key={name}>
                <td>{use(icon)} {name}</td>
                <td>{size}</td>
                <td>{date}</td>
                <td className="ex-actions">
                  <button type="button" data-ex-action="flash" aria-label={`Download ${name}`}>{use('download', 18)}</button>
                  <button type="button" data-ex-action="flash" aria-label={`Share ${name}`}>{use('share', 18)}</button>
                  <button type="button" data-ex-action="delete" aria-label={`Delete ${name}`}>{use('trash', 18)}</button>
                  <button type="button" data-ex-action="flash" aria-label={`More for ${name}`}>{use('more-vertical', 18)}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ex-none" data-ex-none hidden>No files match. <button type="button" data-ex-action="restore-files">Show all files</button></p>
      </div>
    ),
  },
  {
    title: 'Notifications',
    spec: '20px, semibold',
    draw: ({ use, swap }) => (
      <div className="ex-toasts" data-ex-toasts>
        <p className="ok">{use('check-circle', 20, 'semibold')}<span className="ex-msg"><b>Changes saved</b>Your profile is up to date.</span><button type="button" data-ex-action="dismiss" aria-label="Dismiss">{use('close', 18)}</button></p>
        <p className="warn">{use('alert-triangle', 20, 'semibold')}<span className="ex-msg"><b>Storage almost full</b>You've used 9.4 of 10 GB.</span><button type="button" data-ex-action="dismiss" aria-label="Dismiss">{use('close', 18)}</button></p>
        <p className="bad" data-ex-retryable>
          <span className="ex-state">{swap(use('x-circle', 20, 'semibold'), use('check-circle', 20, 'semibold'))}</span>
          <span className="ex-msg"><b data-ex-head>Upload failed</b><span data-ex-body>Check your connection and try again.</span></span>
          <button type="button" className="ex-link" data-ex-action="retry">{use('refresh', 16)} Retry</button>
        </p>
        <button type="button" className="ex-again" data-ex-action="restore-toasts" hidden>{use('bell', 18)} Show notifications again</button>
      </div>
    ),
  },
  {
    title: 'Phone app',
    spec: '24px, regular',
    draw: ({ use }) => (
      <div className="ex-phone">
        <header>
          <button type="button" data-ex-action="flash" aria-label="Menu">{use('menu', 24, 'regular')}</button>
          <b data-ex-screen>Trips</b>
          <button type="button" data-ex-action="flash" aria-label="Search">{use('search', 24, 'regular')}</button>
        </header>
        <ul data-ex-pick>
          <li><button type="button" data-ex-item>{use('map-pin', 24, 'regular')}<span><b>Lisbon</b>Mar 4 to Mar 9</span></button></li>
          <li><button type="button" data-ex-item>{use('ship', 24, 'regular')}<span><b>Island ferry</b>Mar 6, 8:15</span></button></li>
          <li><button type="button" data-ex-item>{use('luggage', 24, 'regular')}<span><b>Packing list</b>14 of 20 packed</span></button></li>
          <li><button type="button" data-ex-item>{use('route', 24, 'regular')}<span><b>Coast drive</b>212 km</span></button></li>
        </ul>
        <nav data-ex-pick data-ex-tabs>
          <button type="button" data-ex-item className="on" data-ex-name="Trips" aria-label="Trips">{use('home', 24, 'regular')}</button>
          <button type="button" data-ex-item data-ex-name="Explore" aria-label="Explore">{use('compass', 24, 'regular')}</button>
          <button type="button" className="ex-fab" data-ex-action="flash" aria-label="New trip">{use('plus', 24, 'semibold')}</button>
          <button type="button" data-ex-item data-ex-name="Alerts" aria-label="Alerts">{use('bell', 24, 'regular')}</button>
          <button type="button" data-ex-item data-ex-name="Profile" aria-label="Profile">{use('person-circle', 24, 'regular')}</button>
        </nav>
      </div>
    ),
  },
  {
    title: 'Pull request',
    spec: '16px, regular',
    draw: ({ use }) => (
      <div className="ex-pr" data-ex-pr>
        <p className="ex-pr-title">{use('pull-request', 16)} <b>Add the large preview view</b><span className="ex-pill" data-ex-pill>Open</span></p>
        <p className="ex-pr-meta"><span>{use('branch', 16)} view-switcher into main</span><span>{use('commit', 16)} 6 commits</span></p>
        <ul>
          <li>{use('check-circle', 16)} Build passed</li>
          <li>{use('check-circle', 16)} Tests passed</li>
          <li>{use('messages', 16)} 3 comments</li>
        </ul>
        <button type="button" className="ex-merge" data-ex-action="merge">{use('merge', 16, 'regular')} <span>Merge</span></button>
      </div>
    ),
  },
  {
    title: 'Checkout',
    spec: '20px regular, 18px in the button',
    draw: ({ use, swap }) => (
      <div className="ex-checkout">
        <p className="ex-row">{use('bag')}<span><b>Canvas tote</b>Natural, one size</span><b>$48</b></p>
        <p className="ex-row">{use('gift')}<span><b>Gift wrap</b>Recycled paper</span><b>$4</b></p>
        <p className="ex-row ex-promo">{use('tag')}<span>Code <b>SPRING10</b> applied</span><b>−$5</b></p>
        <p className="ex-total"><span>Total</span><b>$47</b></p>
        <button type="button" className="ex-pay" data-ex-action="pay">
          <span className="ex-state">{swap(use('lock', 18, 'regular'), use('check-circle', 18, 'regular'))}</span>
          <span data-ex-label>Pay with</span> {use('credit-card', 18, 'regular')} •••• 4242
        </button>
      </div>
    ),
  },
];

export default function ExamplesPage() {
  const mocks = MOCKS.map((mock) => {
    const kit = iconSet();
    return { ...mock, body: mock.draw(kit), used: [...kit.used] };
  });
  return (
    <Page
      poster={
        <>
          <p className="big word" aria-hidden="true">Examples</p>
          <div className="side">
            <p className="lede">The set at work in everyday interfaces. Click around: every control works, and every icon ships in the set at the size and weight noted under it.</p>
          </div>
          <h1 className="titlebar"><span>Icons in real interfaces</span><span>{COUNT}</span></h1>
        </>
      }
    >
      <div className={`ex-fonts ${FONT_VARS}`}>
        <fieldset className="sizes ex-font-picker">
          <legend>Font</legend>
          {FONTS.map((font, index) => (
            <label key={font.label}>
              <input type="radio" name="ex-font" value={font.family} defaultChecked={index === 0} />
              <span style={{ fontFamily: font.family }}>{font.label}</span>
            </label>
          ))}
        </fieldset>
      <div className="examples">
        {mocks.map((mock) => (
          <figure key={mock.title} className={mock.wide ? 'example wide' : 'example'}>
            <div className="ex-frame">{mock.body}</div>
            <figcaption>
              <b>{mock.title}</b> <span>{mock.spec}</span>
              <span className="ex-used">
                {mock.used.map((name) => (
                  <Link key={name} href={`/icons/${name}/`} prefetch={false}>{name}</Link>
                ))}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      </div>
      <ExampleInteractions />
    </Page>
  );
}

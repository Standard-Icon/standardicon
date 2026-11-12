import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrintFilter } from './PrintFilter';

function read(file: string) {
  const svg = readFileSync(join(process.cwd(), 'site', file), 'utf8');
  return { viewBox: /viewBox="([^"]+)"/.exec(svg)?.[1], d: /\sd="([^"]+)"/.exec(svg)?.[1] };
}

const MARK = read('logo-mark.svg');
const FULL = read('logo.svg');
// The full logo in parts, so the ring's arcs can draw themselves in on the splash page. The arcs' file also
// has each arc's centre line, which the arcs are masked along.
const ARCS = read('logo-arcs.svg');
const ARC_LINES = [...readFileSync(join(process.cwd(), 'site', 'logo-arcs.svg'), 'utf8').matchAll(/class="centre" d="([^"]+)"/g)].map((m) => m[1]);
const WORDS = read('logo-words.svg');
const GLOBE = read('logo-globe.svg');

// The Standard logo, in whatever color the text around it is. Whatever's beside it is what's read out.
// The globe alone is for small sizes. The full logo adds the name around it, so it needs room.
// The Standard logo, in whatever color the text around it is. Whatever's beside it is what's read out.
// The globe alone is for small sizes. The full logo adds the name around it, so it needs room.
// Printed adds the texture, for the full logo at a large size. Split draws the arcs, the words and the globe
// apart, with the arcs masked along their centre lines so the splash page can draw them in.
export function Logo({ full = false, printed = false, split = false }: { full?: boolean; printed?: boolean; split?: boolean }) {
  const { viewBox, d } = full ? FULL : MARK;
  const texture = printed && full;
  const parted = full && split;
  const parts = parted
    ? [{ d: ARCS.d, className: 'logo-arcs', mask: 'url(#logo-arcs-mask)' }, { d: WORDS.d, className: 'logo-words' }, { d: GLOBE.d, className: 'logo-globe' }]
    : [{ d, className: undefined }];
  return (
    <svg className={full ? 'logo logo-full' : 'logo'} viewBox={viewBox} aria-hidden="true">
      {(texture || parted) && (
        <defs>
          {texture && <PrintFilter id="logo-print" viewBox={viewBox} />}
          {/* The arcs show only where their centre lines are drawn, a little wider than the arcs themselves. */}
          {parted && (
            <mask id="logo-arcs-mask" maskUnits="userSpaceOnUse" x="-10" y="-10" width="560" height="560">
              {ARC_LINES.map((line) => <path key={line} className="logo-arc-line" d={line} pathLength={1} fill="none" stroke="white" strokeWidth={24} />)}
            </mask>
          )}
        </defs>
      )}
      {parts.map((part, i) => (
        <g key={i} className={part.className} mask={'mask' in part ? part.mask : undefined}>
          <path d={part.d} fill="currentColor" filter={texture ? 'url(#logo-print)' : undefined} />
          {texture && <path d={part.d} fill="currentColor" opacity={0.6} />}
        </g>
      ))}
    </svg>
  );
}

// The saved icon's trip from the editor into the visitors' list. A copy of the drawing lifts off the
// canvas while its tile fades in behind it and its line takes the tile's colour, then it jumps in an arc
// to its cell. The page scrolls along with it, so the landing is in view. The cell stays empty until it lands.

const LIFT_MS = 380;
const JUMP_MS = 820;
const LIFT_PX = 14;
const LIFT_SCALE = 1.03;
const TILE_ICON_PX = 32; // .splash-tile svg
const SHADOW = '0 24px 48px rgb(0 0 0 / 0.22)';

type Box = { left: number; top: number; width: number; height: number };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// scroll: false keeps the page still, for a list that's already in view, like the sheet.
export function flyToList({ from, markup, cell, art, scroll = true }: { from: Box; markup: string; cell: HTMLElement; art?: SVGElement | null; scroll?: boolean }) {
  // The tile and line take the cell's own colours, so the flight ends looking exactly like where it lands
  // (the icon being edited has the selected, black tile).
  const target = getComputedStyle(cell);
  const tile = target.backgroundColor;
  const ink = target.color;
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff';
  const cellRadius = parseFloat(target.borderTopLeftRadius) || 14;

  const flyer = document.createElement('div');
  flyer.className = 'splash-flight';
  flyer.setAttribute('aria-hidden', 'true');
  flyer.innerHTML = `<svg viewBox="0 0 16 16" fill="none">${markup}</svg>`;
  const icon = flyer.firstElementChild as SVGElement;
  const place = (box: Box, iconPx: number) => {
    Object.assign(flyer.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    Object.assign(icon.style, { width: `${iconPx}px`, height: `${iconPx}px` });
  };
  place(from, from.width);
  flyer.style.color = paper;
  document.body.append(flyer);
  cell.style.visibility = 'hidden';
  if (art) art.style.opacity = '0';

  // Lift: up and a touch larger, with a shadow, while the tile fades in and the line takes its colour.
  const lift = flyer.animate(
    [
      { transform: 'none', boxShadow: '0 0 0 rgb(0 0 0 / 0)', backgroundColor: 'rgb(0 0 0 / 0)', color: paper },
      { transform: `translateY(-${LIFT_PX}px) scale(${LIFT_SCALE})`, boxShadow: SHADOW, backgroundColor: tile, color: ink },
    ],
    { duration: LIFT_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  );

  const finish = () => {
    flyer.remove();
    cell.style.visibility = '';
    if (art) art.style.opacity = '';
    cell.animate([{ transform: 'scale(0.9)' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
  };

  lift.finished.then(() => {
    // Carry the lifted state into plain styles, so the jump starts exactly where the lift ended.
    const lifted: Box = {
      width: from.width * LIFT_SCALE,
      height: from.height * LIFT_SCALE,
      left: from.left - (from.width * (LIFT_SCALE - 1)) / 2,
      top: from.top - LIFT_PX - (from.height * (LIFT_SCALE - 1)) / 2,
    };
    Object.assign(flyer.style, { backgroundColor: tile, color: ink, boxShadow: SHADOW });
    place(lifted, lifted.width);
    lift.cancel();

    // Scroll so the cell lands a little above the middle of the window, unless it's already in view.
    const startScroll = window.scrollY;
    const cellTop = cell.getBoundingClientRect().top;
    const inView = !scroll || (cellTop > 80 && cellTop + cell.offsetHeight < window.innerHeight - 40);
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const endScroll = inView ? startScroll : Math.max(0, Math.min(maxScroll, startScroll + cellTop - window.innerHeight * 0.45));
    const fromRadius = parseFloat(getComputedStyle(flyer).borderTopLeftRadius) || 18;

    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / JUMP_MS);
      const s = easeInOut(t);
      if (endScroll !== startScroll) window.scrollTo(0, mix(startScroll, endScroll, s));
      const to = cell.getBoundingClientRect();
      // An arc: up first, then down into the cell.
      const arc = Math.sin(Math.PI * t) * Math.min(180, Math.max(60, Math.abs(to.top - lifted.top) * 0.2));
      const box: Box = {
        left: mix(lifted.left, to.left, s),
        top: mix(lifted.top, to.top, s) - arc,
        width: mix(lifted.width, to.width, s),
        height: mix(lifted.height, to.height, s),
      };
      place(box, mix(lifted.width, TILE_ICON_PX, s));
      flyer.style.borderRadius = `${mix(fromRadius, cellRadius, s)}px`;
      flyer.style.boxShadow = `0 ${mix(24, 0, s)}px ${mix(48, 0, s)}px rgb(0 0 0 / ${mix(0.22, 0, s)})`;
      if (t < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }, finish);
}

// Sizes: icons drawn smaller than the 12px drawing area, and what they'd look like grown. Each icon shows as
// drawn, grown to fill the 12px square, and grown to fill the 13.33px circle (the keyline round icons use),
// big on the grid and at real size beside icons that already fill the area. The choice for each (keep, square
// or circle) is saved to icons/size-review.json, so the chosen ones can then be grown in Figma.
//
// Sizes are measured here from the synced drawings: the bounds of every part, plus half its line, so a 1px
// line drawn from 2 to 14 measures 12. Growing scales the drawing about its own centre and keeps every line
// at its width, then nudges it back inside the area if it would spill out.

import { bodyFor, wrapSvg } from '/lib/icon.mjs';

const KEY = 'wb-sizes';
const state = { under: 11, stage: 'all', category: 'all', small: false, decided: true, selected: null, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
const save = () => localStorage.setItem(KEY, JSON.stringify({ ...state }));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Icons meant to sit small: arrows, chevrons and other marks that pair with text, and badge variants, whose
// size comes from their parent. Hidden unless asked for.
const SMALL = /^(arrow|chevron|caret|triangle|dot|ellipsis|more-|corner|sort|grip|drag|move)|^(plus|minus|x|check|divide|equals|hash|at|percent|slash|period|comma|quote|asterisk|ampersand)$|-(overlay|cutout|integrated)$/;
// Icons that already fill the area, shown beside each one at real size.
const REFERENCES = ['search', 'settings', 'folder', 'bell', 'trash'];
const TARGETS = { square: 12, circle: 12 * 10 / 9 };
const CHOICES = [['keep', 'Keep', 'K'], ['square', 'Square', 'S'], ['circle', 'Circle', 'C']];

let root = null;
let data = null;
let helpers = {};
let review = null; // name → { choice, at }
const measured = new Map(); // name → { x, y, w, h, pad } in the icon's 16px units

// ---- Measuring ----

function measureAll(icons) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.style.cssText = 'position:absolute;left:-9999px;top:0;width:16px;height:16px;visibility:hidden';
  document.body.append(svg);
  for (const icon of icons) {
    if (measured.has(icon.name)) continue;
    svg.innerHTML = bodyFor(icon, 16);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pad = 0;
    for (const el of svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon')) {
      const box = el.getBBox();
      const stroked = el.getAttribute('stroke') && el.getAttribute('stroke') !== 'none';
      const half = stroked ? Number(el.getAttribute('stroke-width') ?? 1) / 2 : 0;
      pad = Math.max(pad, half);
      x0 = Math.min(x0, box.x - half); y0 = Math.min(y0, box.y - half);
      x1 = Math.max(x1, box.x + box.width + half); y1 = Math.max(y1, box.y + box.height + half);
    }
    if (x0 < Infinity) measured.set(icon.name, { x: x0, y: y0, w: x1 - x0, h: y1 - y0, pad });
  }
  svg.remove();
}

// ---- Growing ----

// The drawing grown so its longest side is `target`, lines kept at their width. Returns the body and the scale.
function grown(icon, target) {
  const m = measured.get(icon.name);
  const body = bodyFor(icon, 16);
  if (!m) return { body, k: 1 };
  const long = Math.max(m.w, m.h);
  const k = (target - 2 * m.pad) / (long - 2 * m.pad);
  if (!(k > 1)) return { body, k: 1 };
  // Where it lands: about its own centre, then nudged inside the target box centred on the frame.
  const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
  const w = m.w * k - 2 * m.pad * (k - 1), h = m.h * k - 2 * m.pad * (k - 1);
  const lo = 8 - target / 2, hi = 8 + target / 2;
  const fit = (c, size) => Math.min(hi - size / 2, Math.max(lo + size / 2, c));
  const nx = fit(cx, w), ny = fit(cy, h);
  const lines = body.replace(/<(\w+)((?:\s[^>]*?)?)\s*(\/?)>/g, (element, tag, attrs, close) => {
    if (!/\sstroke="(?!none)/.test(attrs)) return element;
    const width = Number(attrs.match(/\sstroke-width="([^"]*)"/)?.[1] ?? 1);
    let out = attrs.replace(/\sstroke-width="[^"]*"/, '') + ` stroke-width="${+(width / k).toFixed(4)}"`;
    out = out.replace(/\sstroke-dasharray="([^"]*)"/, (_, d) => ` stroke-dasharray="${d.split(/[\s,]+/).map((n) => +(Number(n) / k).toFixed(4)).join(' ')}"`);
    return `<${tag}${out}${close ? '/' : ''}>`;
  });
  return { body: `<g transform="translate(${+nx.toFixed(3)} ${+ny.toFixed(3)}) scale(${+k.toFixed(4)}) translate(${+(-cx).toFixed(3)} ${+(-cy).toFixed(3)})">${lines}</g>`, k };
}

const bodyOf = (icon, how) => (how === 'now' || how === 'keep' ? bodyFor(icon, 16) : grown(icon, TARGETS[how]).body);
// Any 16px body drawn at a size; lines scale with it, as the set's own sizes do.
const svgOf = (body, size) => wrapSvg(body, 16).replace(/width="16" height="16"/, `width="${size}" height="${size}"`);

// The pixel grid and both keylines, behind a big drawing.
function plate(body) {
  let grid = '';
  for (let i = 1; i < 16; i++) grid += `M${i} 0V16M0 ${i}H16`;
  const r = TARGETS.circle / 2;
  return `<svg class="sz-plate" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="${grid}" stroke="#dfe2e5" stroke-width="0.5" vector-effect="non-scaling-stroke"/>
    <rect x="2" y="2" width="12" height="12" stroke="#7aa7ff" vector-effect="non-scaling-stroke"/>
    <circle cx="8" cy="8" r="${r}" stroke="#ff4fd8" vector-effect="non-scaling-stroke"/>
    <g color="#000">${body}</g></svg>`;
}

// ---- The list ----

function candidates() {
  return data.icons
    .filter((icon) => measured.has(icon.name))
    .map((icon) => ({ icon, m: measured.get(icon.name), long: Math.max(measured.get(icon.name).w, measured.get(icon.name).h) }))
    .filter(({ icon, long }) => long < state.under - 0.005 && (state.small || !SMALL.test(icon.name)))
    .sort((a, b) => a.long - b.long || a.icon.name.localeCompare(b.icon.name));
}

function visible() {
  return candidates().filter(({ icon }) => {
    if (state.category !== 'all' && icon.category !== state.category) return false;
    if (state.stage !== 'all' && stageOf(icon) !== state.stage) return false;
    if (!state.decided && review[icon.name]?.choice) return false;
    return true;
  });
}

const stageOf = (icon) => helpers.statusLabel?.(icon).label ?? (icon.released ? 'Live' : 'New');

function draw() {
  const all = candidates();
  const shown = visible();
  if (!shown.some((c) => c.icon.name === state.selected)) state.selected = shown[0]?.icon.name ?? null;
  const counts = { keep: 0, square: 0, circle: 0 };
  for (const { icon } of all) if (review[icon.name]?.choice) counts[review[icon.name].choice]++;
  const undecided = all.length - counts.keep - counts.square - counts.circle;
  const stages = [...new Set(all.map(({ icon }) => stageOf(icon)))].sort();
  const categories = [...new Set(all.map(({ icon }) => icon.category).filter(Boolean))].sort();
  const option = (value, label, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;

  root.innerHTML = `
    <div class="filters sz-controls">
      <label>Longest side under <select data-k="under">${[10, 10.5, 11, 11.5, 12].map((n) => option(String(n), `${n}px`, String(state.under))).join('')}</select></label>
      <select data-k="stage" aria-label="Stage">${option('all', 'Every stage', state.stage)}${stages.map((s) => option(s, s, state.stage)).join('')}</select>
      <select data-k="category" aria-label="Category">${option('all', 'Every category', state.category)}${categories.map((c) => option(c, c.replace(/-/g, ' '), state.category)).join('')}</select>
      <label class="check"><input type="checkbox" data-k="small"${state.small ? ' checked' : ''}> Arrows, marks and badges</label>
      <label class="check"><input type="checkbox" data-k="decided"${state.decided ? ' checked' : ''}> Show decided</label>
      <span class="sz-tally">${undecided} to decide · <b>${counts.square}</b> square · <b>${counts.circle}</b> circle · <b>${counts.keep}</b> keep</span>
    </div>
    <div class="sz-main">
      <ul class="sz-list" role="listbox" aria-label="Undersized icons">${shown.map(({ icon, m }) => {
        const choice = review[icon.name]?.choice;
        return `<li role="option" data-name="${esc(icon.name)}" aria-selected="${icon.name === state.selected}">
          ${svgOf(bodyFor(icon, 16), 16)}<span class="sz-name">${esc(icon.name)}</span>
          <small>${m.w.toFixed(1)} × ${m.h.toFixed(1)}</small>
          ${choice ? `<i class="sz-choice ${choice}">${esc(CHOICES.find(([c]) => c === choice)[1])}</i>` : ''}</li>`;
      }).join('') || '<li class="none">Nothing under that size.</li>'}</ul>
      <div class="sz-detail" id="sz-detail"></div>
    </div>`;
  drawDetail();
}

function drawDetail() {
  const box = root.querySelector('#sz-detail');
  const icon = data.icons.find((i) => i.name === state.selected);
  if (!icon) { box.innerHTML = '<p class="hint">Pick an icon.</p>'; return; }
  const m = measured.get(icon.name);
  const choice = review[icon.name]?.choice ?? null;
  const refs = REFERENCES.map((n) => data.icons.find((i) => i.name === n)).filter(Boolean);
  const ways = [['now', 'As drawn', `${m.w.toFixed(2)} × ${m.h.toFixed(2)}`, 'keep'],
    ['square', 'Fill the square', `longest side 12 · ×${grown(icon, TARGETS.square).k.toFixed(2)}`, 'square'],
    ['circle', 'Fill the circle', `longest side 13.33 · ×${grown(icon, TARGETS.circle).k.toFixed(2)}`, 'circle']];
  const strip = (how, size) => {
    const mid = Math.floor(refs.length / 2);
    const row = refs.map((r) => `<span class="ref">${svgOf(bodyFor(r, 16), size)}</span>`);
    row.splice(mid, 0, `<span class="it">${svgOf(bodyOf(icon, how), size)}</span>`);
    return `<div class="sz-strip" style="--s:${size}px">${row.join('')}</div>`;
  };
  const stage = helpers.statusLabel?.(icon);
  box.innerHTML = `
    <header class="sz-head">
      <h2>${esc(icon.name)}</h2>
      <span class="sz-meta">${esc(icon.category?.replace(/-/g, ' ') ?? '')} · ${esc(stageOf(icon))}${stage?.color ? ` <i class="sz-dot" style="--c:${stage.color}"></i>` : ''} · drawn ${m.w.toFixed(1)} × ${m.h.toFixed(1)} in the 12 × 12 area</span>
      <a class="btn" href="/compare/${esc(icon.name)}">Open in Compare</a>
    </header>
    <div class="sz-ways">${ways.map(([how, title, note, pick]) => `
      <button type="button" class="sz-way${choice === pick ? ' on' : ''}" data-choice="${pick}" title="${esc(CHOICES.find(([c]) => c === pick)[1])} (${CHOICES.find(([c]) => c === pick)[2]})">
        ${plate(bodyOf(icon, how))}
        <span class="sz-title">${esc(title)} <kbd>${CHOICES.find(([c]) => c === pick)[2]}</kbd></span>
        <small>${esc(note)}</small>
        <span class="sz-real">${strip(how, 16)}${strip(how, 24)}</span>
      </button>`).join('')}
    </div>
    <p class="hint">Click one, or press <kbd>K</kbd> keep, <kbd>S</kbd> square, <kbd>C</kbd> circle; it moves to the next icon. <kbd>↑</kbd> <kbd>↓</kbd> move, <kbd>Backspace</kbd> clears. The blue square is the 12px area, the pink circle the 13.33px keyline round icons fill. The rows below each show it at 16 and 24 among ${refs.map((r) => r.name).join(', ')}.${choice ? ` Chosen: <b>${esc(CHOICES.find(([c]) => c === choice)[1])}</b>.` : ''}</p>`;
}

// ---- Choosing ----

async function choose(name, choice) {
  const res = await fetch('/api/size-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, choice }) });
  if (!res.ok) return alert(await res.text());
  review = await res.json();
}

function move(by) {
  const shown = visible();
  const at = shown.findIndex((c) => c.icon.name === state.selected);
  const next = shown[Math.min(shown.length - 1, Math.max(0, at + by))];
  if (next) select(next.icon.name);
}

function select(name) {
  state.selected = name;
  save();
  for (const li of root.querySelectorAll('.sz-list li[data-name]')) {
    const on = li.dataset.name === name;
    li.setAttribute('aria-selected', String(on));
    if (on) li.scrollIntoView({ block: 'nearest' });
  }
  drawDetail();
}

async function decide(choice) {
  const name = state.selected;
  if (!name) return;
  const before = visible();
  const at = before.findIndex((c) => c.icon.name === name);
  await choose(name, review[name]?.choice === choice ? null : choice);
  // On to the next one, counted from where this one was, even if deciding hid it from the list.
  if (choice) {
    const after = visible();
    const next = before.slice(at + 1).find((c) => after.some((a) => a.icon.name === c.icon.name));
    if (next) state.selected = next.icon.name;
  }
  save();
  draw();
  root.querySelector('.sz-list li[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function wire() {
  root.addEventListener('change', (event) => {
    const k = event.target.dataset.k;
    if (!k) return;
    state[k] = event.target.type === 'checkbox' ? event.target.checked : k === 'under' ? Number(event.target.value) : event.target.value;
    save();
    draw();
  });
  root.addEventListener('click', (event) => {
    const li = event.target.closest('.sz-list li[data-name]');
    if (li) return select(li.dataset.name);
    const way = event.target.closest('[data-choice]');
    if (way) return decide(way.dataset.choice);
  });
  document.addEventListener('keydown', (event) => {
    if (root.closest('.view')?.hidden) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '') && document.activeElement.type !== 'checkbox') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const pick = CHOICES.find(([, , k]) => k.toLowerCase() === key);
    if (pick) { event.preventDefault(); return decide(pick[0]); }
    if (event.key === 'Backspace' && state.selected && review[state.selected]?.choice) { event.preventDefault(); return choose(state.selected, null).then(draw); }
    if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(event.key)) {
      event.preventDefault();
      move(event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1);
    }
  });
}

export async function drawSizes(el, all, options = {}) {
  helpers = options;
  data = all;
  if (root !== el) { root = el; wire(); }
  review ??= await (await fetch('/api/size-review')).json();
  measureAll(data.icons);
  draw();
}

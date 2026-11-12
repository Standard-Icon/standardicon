import { LIMITS, SIZES, WEIGHTS, hasWeights, heaviestFor, sizesFor, toSvg, weightFits } from '/lib/icon.mjs';
import { drawWeights } from '/weights.js';
import { drawSizes } from '/sizes.js';

const $ = (selector) => document.querySelector(selector);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SF_WEIGHTS = ['ultralight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black'];
const SAVED = 'icon-workbench';

const state = {
  view: 'compare', q: '', status: '', category: '', match: '', flag: '', dupes: '', lineStacks: '',
  size: 24, weight: 'regular', sfWeight: 'regular',
  layers: { mine: true },
  opacity: { mine: 1 },
  scale: {},
  matchLine: false,
  keyGrid: false,
  selected: null,
  ...JSON.parse(localStorage.getItem(SAVED) ?? '{}'),
};
// A weight saved before the scale changed (medium) falls back to the default.
if (!Object.hasOwn(WEIGHTS, state.weight)) state.weight = 'regular';
const save = () => localStorage.setItem(SAVED, JSON.stringify({ size: state.size, weight: state.weight, sfWeight: state.sfWeight, layers: state.layers, opacity: state.opacity, scale: state.scale, matchLine: state.matchLine, keyGrid: state.keyGrid, view: state.view, selected: state.selected }));

let data = null;
let byName = new Map();
let shown = [];
// Rows showing the icon grid on their own, when the checkbox for every row is off.
const gridRows = new Set();
const gridOn = (name) => state.keyGrid || gridRows.has(name);
let recordFor = new Map();
let seenStamp = null;
let sets = [];
const setById = (id) => sets.find((set) => set.id === id);

// ---- Drawing the three sources ----

const usableWeight = (icon) => {
  const wanted = hasWeights(icon) ? state.weight : 'regular';
  return weightFits(wanted, state.size) ? wanted : heaviestFor(state.size);
};
const mineMarkup = (icon) => toSvg(icon, state.size, usableWeight(icon));
// Sets drawn on another grid need a different width to match my line at the chosen size and weight.
// Our line grows with the icon, so another set matches it with the same share of its own grid.
const matchedWidth = (set) => ((set.grid ?? 16) * WEIGHTS[weightFits(state.weight, state.size) ? state.weight : heaviestFor(state.size)]) / 18;
const setUrl = (set, name) => (set.kind === 'sf-symbols'
  ? `url("/sf/${name}@${state.sfWeight}.png")`
  : `url("/set/${set.id}/${name}.svg${state.matchLine && set.matchLine ? `?sw=${matchedWidth(set)}` : ''}")`);
const glyph = (set, name, style = '') => `<div class="glyph set-layer" style="--c:${esc(set.color)};--m:${esc(setUrl(set, name))};${style}"></div>`;

// SVG sets are inlined on the big plate, so their line can be matched to the chosen weight.
const svgText = new Map();
async function setSvg(set, name) {
  const key = `${set.id}/${name}`;
  if (!svgText.has(key)) svgText.set(key, await (await fetch(`/set/${key}.svg`)).text());
  return svgText.get(key).replace(/<!--[\s\S]*?-->/, '');
}

// ---- Compare ----

// Stage: where an icon stands, from its Figma border. Pink is approved, blue is new, dashed orange needs revision.
const COLOR_NAMES = { '#ffb000': 'Orange', '#4f4fff': 'New', '#e6e6e6': 'Gray', '#ff4fd8': 'Approved' };
function statusLabel(icon) {
  const s = icon.status;
  if (icon.released) return { label: 'Live', color: '#ff4fd8', dashed: false };
  // Approved in the workbench or pink in Figma, either way it ships on the next sync.
  const pink = s?.border?.color === '#ff4fd8' && !s.border.dashed;
  if (recordFor.get(icon.name)?.approved || pink) return { label: 'Approved', color: '#ff4fd8', dashed: true };
  if (!s?.border) return { label: 'No border', color: null, dashed: false };
  if (s.border.color === '#ffb000' && s.border.dashed) return { label: 'Needs revision', color: s.border.color, dashed: true };
  const name = COLOR_NAMES[s.border.color] ?? s.border.color;
  return { label: `${name}${s.border.dashed ? ' dashed' : ''}`, color: s.border.color, dashed: s.border.dashed };
}
const statusKey = (icon) => (icon.released ? 'released' : statusLabel(icon).label === 'Approved' ? 'approved' : icon.status?.border ? `${icon.status.border.color}${icon.status.border.dashed ? '-dashed' : ''}` : 'none');

// Possible duplicates, from workbench/duplicates.json. Each kept icon is listed straight before its duplicates.
const DUPE_KINDS = { remove: ['Duplicates to remove', 'Duplicate of'], same: ['Same drawing, other meaning', 'Same drawing as'], close: ['Close calls', 'Close to'] };
function dupeRows(kind) {
  const rows = new Map();
  for (const group of data.duplicates) {
    if (kind !== 'all' && group.kind !== kind) continue;
    if (!rows.has(group.keep)) rows.set(group.keep, { at: rows.size, label: 'Keep' });
    for (const name of group.dupes) if (!rows.has(name)) rows.set(name, { at: rows.size, label: `${DUPE_KINDS[group.kind][1]} ${group.keep}` });
  }
  return rows;
}

// Icons that draw a stack as repeated lines, from workbench/line-stacks.json. A base name also covers its badged versions.
const LINE_STACK_KINDS = { several: 'Several lines', single: 'One line', borderline: 'Borderline' };
function lineStackRows(filter) {
  const rows = new Map();
  for (const group of data.lineStacks) {
    const clear = group.kind !== 'borderline';
    if (filter === 'clear' ? !clear : filter !== 'all' && group.kind !== filter) continue;
    const label = group.reason ? `${LINE_STACK_KINDS[group.kind]}: ${group.reason.toLowerCase()}` : LINE_STACK_KINDS[group.kind];
    for (const name of group.names.flatMap((base) => [base, `${base}-cutout`, `${base}-overlay`])) rows.set(name, { at: rows.size, label });
  }
  return rows;
}

// A set's icons that none of mine match. Names kept only as old aliases don't count, and neither do ones I've drawn or marked as covered.
const plannedFrom = (set, name) => data.records.find((record) => record.status === 'planned' && record.compare?.[set.id] === name);
function missingFrom(set, terms, withPlanned = false) {
  const matched = new Set(data.icons.map((icon) => icon.matches[set.id].current));
  // An icon that's in Figma but couldn't be imported has no row of its own, but I still have it.
  const covered = new Set(data.records.filter((record) => record.status === 'covered' || record.observed.inFigma).map((record) => record.name));
  // Ones already planned from this set are on their way.
  for (const record of data.records) {
    if (typeof record.compare?.[set.id] === 'string' && !(withPlanned && record.status === 'planned')) covered.add(record.compare[set.id]);
    for (const name of record.compareAlso?.[set.id] ?? []) covered.add(name);
  }
  return (set.primary ?? set.names).filter((name) => !matched.has(name) && !covered.has(name) && terms.every((term) => [name, ...(set.tags?.[name] ?? [])].join(' ').toLowerCase().includes(term))).sort();
}
const missingRow = (set, name) => `<div class="row missing${state.missing?.name === name && state.missing?.set === set.id ? ' on' : ''}" data-missing="${esc(name)}" data-set="${esc(set.id)}">
    <div class="name"><b>${esc(name)}</b><div class="meta">${plannedFrom(set, name) ? `Planned as ${esc(plannedFrom(set, name).name)}` : `Only in ${esc(set.title)}`}</div></div>
    <div class="cell empty"></div>${sets.map((other) => `<div class="cell${other === set ? '' : ' empty'}" data-c="${esc(other.id)}"></div>`).join('')}<div class="cell overlay" data-c="overlay"></div>
  </div>`;
function drawMissing(set, terms) {
  shown = [];
  const names = missingFrom(set, terms);
  $('#count').textContent = `${names.length} ${set.title} icons I don't have`;
  $('#rows').innerHTML = names.map((name) => missingRow(set, name)).join('');
  observeRows();
}

// ---- Matching: clicking a row picks which of my icons it really is ----

// Mine that already guessed this name come first, then any that share a word with it.
function likelyFor(set, name) {
  const words = name.split('-');
  return data.icons.map((icon) => {
    const at = icon.matches[set.id].alts.indexOf(name);
    const shared = icon.name.split('-').filter((word) => words.includes(word)).length;
    return [icon, (at >= 0 ? 10 - at : 0) + shared * 3];
  }).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1] || a[0].name.length - b[0].name.length).slice(0, 8).map(([icon]) => icon);
}
const claimButton = (icon, set) => {
  const match = icon.matches[set.id];
  return `<button class="alt claim" data-claim="${esc(icon.name)}">${toSvg(icon, 16)}<span>${esc(icon.name)}${match.current ? `<small>${match.picked ? 'matched to' : 'guessed as'} ${esc(match.current)}</small>` : ''}</span></button>`;
};
const missingPlate = (set, name, mine) => `${mine ? `<div class="mine overlay-layer">${mineMarkup(mine)}</div>` : ''}<div class="overlay-layer glyph set-layer" style="--c:${esc(set.color)};--m:${esc(setUrl(set, name))}"></div>`;
function drawMissingPanel() {
  const { set: setId, name } = state.missing;
  const set = setById(setId);
  const likely = likelyFor(set, name);
  $('#stage-panel').innerHTML = `
    <div class="stage-title"><h2>${esc(name)}</h2></div>
    <span class="hint">Only in ${esc(set.title)} so far. ↑ ↓ for the next one.</span>
    <div class="plate solo-color" id="plate" style="--cells:${state.size}">${missingPlate(set, name)}</div>
    <div class="layer">
      <h3 class="claim-title">Which of mine is this?</h3>
      <p class="none-note">Point at one to overlay it. Click to save the match.</p>
      <div class="claims" data-claims>${likely.map((icon) => claimButton(icon, set)).join('') || '<p class="none-note">No likely matches. Search for one, or leave it: you may not have this icon.</p>'}</div>
      <input class="pick" type="search" placeholder="Search my icons…" data-claim-find autocomplete="off" spellcheck="false">
      <div class="claims" data-claim-results></div>
    </div>
    ${plannedFrom(set, name) ? `<p class="none-note">Planned as ${esc(plannedFrom(set, name).name)}. It'll become active once it's drawn in Figma.</p>` : `<div class="layer create-one">
      <h3 class="claim-title">Don't have it?</h3>
      <label>Name <input type="text" id="create-name" value="${esc(name)}" spellcheck="false" autocomplete="off"></label>
      <button class="btn primary" id="create-one">Create one</button>
      <p class="none-note">Adds it to the plan and files an issue to draw it.</p>
    </div>`}`;
  document.querySelectorAll('#plate svg').forEach((svg) => { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.cssText = 'width:100%;height:100%;display:block'; });
}
function selectMissing(row, scroll = false) {
  state.missing = { set: row.dataset.set, name: row.dataset.missing };
  document.querySelectorAll('#rows .row.on').forEach((r) => r.classList.remove('on'));
  row.classList.add('on');
  if (scroll) row.scrollIntoView({ block: 'nearest' });
  drawMissingPanel();
}
async function claim(iconName) {
  const { set, name } = state.missing;
  const row = document.querySelector(`#rows .row.on[data-missing]`);
  // An icon that already has a real match keeps it, so that one doesn't land back on this list.
  const icon = byName.get(iconName);
  const current = icon.matches[set];
  if (current.current && (current.picked || current.current === icon.name)) rememberRecord(await send('POST', `/api/records/${iconName}/also`, { set, match: name }));
  else await saveMatch(icon, set, name);
  finishMissing(row, set, `Matched to ${iconName}`);
}
function finishMissing(row, set, message) {
  const next = row?.nextElementSibling ?? row?.previousElementSibling;
  row?.remove();
  if (state.match.startsWith('missing:')) $('#count').textContent = `${document.querySelectorAll('#rows .row').length} ${setById(set).title} icons I don't have`;
  else $('#count').textContent = `${shown.length} of mine, ${document.querySelectorAll('#rows .row.missing').length} only in other sets`;
  toast(message);
  if (next?.dataset.missing) selectMissing(next, true);
  else { state.missing = null; drawStage(); }
}
async function createOne() {
  const { set, name: match } = state.missing;
  const name = $('#create-name').value.trim();
  const row = document.querySelector(`#rows .row.on[data-missing]`);
  const saved = await send('POST', '/api/records/plan', { name, set, match, by: 'morgan' });
  rememberRecord(saved);
  await refreshIssues();
  finishMissing(row, set, `Planned ${saved.name}, and filed an issue`);
}

function applyFilters() {
  if (state.match.startsWith('missing:')) return drawMissing(setById(state.match.slice(8)), state.q.toLowerCase().split(/\s+/).filter(Boolean));
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const dupes = state.dupes ? dupeRows(state.dupes) : null;
  const lineStacks = state.lineStacks ? lineStackRows(state.lineStacks) : null;
  shown = data.icons.filter((icon) => {
    if (dupes && !dupes.has(icon.name)) return false;
    if (lineStacks && !lineStacks.has(icon.name)) return false;
    if (state.status && statusKey(icon) !== state.status) return false;
    if (state.category && icon.category !== state.category) return false;
    const [matchKind, matchSet] = state.match.split(':');
    if (matchKind === 'no' && icon.matches[matchSet].current) return false;
    if (matchKind === 'confirmed' && !icon.matches[matchSet].none) return false;
    if (matchKind === 'unreviewed' && (icon.matches[matchSet].picked || icon.matches[matchSet].none)) return false;
    if (matchKind === 'picked' && !Object.values(icon.matches).some((m) => m.picked)) return false;
    if (state.flag && !(recordFor.get(icon.name)?.flags ?? []).includes(state.flag)) return false;
    const hay = [icon.name, ...(icon.aliases ?? []), ...(icon.keywords ?? [])].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const grouped = dupes ?? lineStacks;
  if (grouped) shown.sort((a, b) => grouped.get(a.name).at - grouped.get(b.name).at);
  if (state.view === 'compare') $('#count').textContent = `${shown.length} of ${data.icons.length} icons`;
  // A plain search also finds what other sets have and I don't, listed after mine.
  const searching = terms.length && !grouped && !state.status && !state.category && !state.match && !state.flag;
  const others = searching ? sets.filter((set) => set.kind === 'svg').flatMap((set) => missingFrom(set, terms, true).map((name) => [set, name])) : [];
  if (state.missing && !state.match.startsWith('missing:') && !others.some(([set, name]) => set.id === state.missing.set && name === state.missing.name)) {
    state.missing = null;
    drawStage();
  }
  if (state.view === 'compare' && others.length) $('#count').textContent = `${shown.length} of mine, ${others.length} only in other sets`;
  $('#rows').innerHTML = shown.map((icon) => {
    const s = statusLabel(icon);
    return `<div class="row${icon.name === state.selected ? ' on' : ''}" data-name="${esc(icon.name)}">
      <div class="name"><b>${esc(icon.name)}</b><i class="revision-mark"${needsRevision(icon.name) ? '' : ' hidden'} title="Needs revision"></i><button class="row-grid" data-row-grid="${esc(icon.name)}" aria-pressed="${gridOn(icon.name)}" title="Icon grid for this row (G)">#</button><div class="meta"><i class="swatch${s.dashed ? ' dashed' : ''}" style="--c:${esc(s.color ?? '#e3e5e7')}"></i>${esc(grouped ? grouped.get(icon.name).label : `${s.label} · ${icon.category}`)}</div></div>
      <div class="cell" data-c="mine"></div>${sets.map((set) => `<div class="cell" data-c="${esc(set.id)}"></div>`).join('')}<div class="cell overlay" data-c="overlay"></div>
    </div>`;
  }).join('') + others.map(([set, name]) => missingRow(set, name)).join('');
  observeRows();
}

// Rows draw when they scroll into view, so 1,500 icons don't all render at once.
let observer;
function observeRows() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      drawRow(entry.target);
      observer.unobserve(entry.target);
    }
  }, { root: $('#list'), rootMargin: '300px' });
  document.querySelectorAll('#rows .row').forEach((row) => observer.observe(row));
}
function drawRow(row) {
  if (row.dataset.missing) {
    const set = setById(row.dataset.set);
    row.querySelector(`[data-c="${CSS.escape(set.id)}"]`).innerHTML = glyph(set, row.dataset.missing);
    row.querySelector('[data-c="overlay"]').innerHTML = glyph(set, row.dataset.missing);
    return;
  }
  const icon = byName.get(row.dataset.name);
  const cell = (c) => row.querySelector(`[data-c="${c}"]`);
  cell('mine').innerHTML = `${gridOn(icon.name) ? keyGridSvg(state.size) : ''}<div class="mine">${mineMarkup(icon)}</div>`;
  cell('mine').querySelector('.mine svg').style.cssText = 'width:100%;height:100%';
  for (const set of sets) {
    const current = icon.matches[set.id].current;
    cell(set.id).innerHTML = current ? glyph(set, current) : '';
    cell(set.id).classList.toggle('empty', !current);
  }
  drawOverlayCell(cell('overlay'), icon);
}
// The icon's pixel grid, the 2px padding and the keyline circle, drawn behind the icon. Units are the icon's own pixels.
// The keylines: the 12px drawing area as a square, and a circle about 11% wider (20:18, as in Material's keylines),
// because a circle looks smaller than a square of the same width. Round icons fill the circle, square ones the square.
function keyGridSvg(size, { lines = true } = {}) {
  const s = size, u = s / 16;
  let grid = '';
  if (lines) for (let i = 1; i < s; i++) grid += `M${i} 0V${s}M0 ${i}H${s}`;
  return `<svg class="key-grid" viewBox="0 0 ${s} ${s}" fill="none" aria-hidden="true">${grid ? `<path d="${grid}" stroke="#dfe2e5" stroke-width="0.5" vector-effect="non-scaling-stroke"/>` : ''}<rect x="${2 * u}" y="${2 * u}" width="${12 * u}" height="${12 * u}" stroke="#7aa7ff" stroke-width="1" vector-effect="non-scaling-stroke"/><circle cx="${s / 2}" cy="${s / 2}" r="${(12 * 10 / 9 / 2) * u}" stroke="#ff4fd8" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
}

function drawOverlayCell(el, icon) {
  let html = gridOn(icon.name) ? keyGridSvg(state.size) : '';
  if (state.layers.mine) html += `<div class="mine" style="opacity:${state.opacity.mine}">${mineMarkup(icon)}</div>`;
  for (const set of sets) {
    const current = icon.matches[set.id].current;
    if (state.layers[set.id] && current) html += glyph(set, current, `opacity:${state.opacity[set.id]};transform:scale(${state.scale[set.id] / 100});`);
  }
  el.innerHTML = html;
  el.querySelectorAll('svg').forEach((svg) => (svg.style.cssText = 'width:100%;height:100%'));
}
const redrawOverlays = () => document.querySelectorAll('#rows .row:not(.missing)').forEach((row) => {
  const el = row.querySelector('[data-c="overlay"]');
  if (el.innerHTML || row.querySelector('[data-c="mine"]').innerHTML) drawOverlayCell(el, byName.get(row.dataset.name));
});

// ---- The stage ----

// Every mix of me and one set, each alone, and everything together.
const layersOf = (...ids) => Object.fromEntries(['mine', ...sets.map((set) => set.id)].map((id) => [id, ids.includes(id)]));
const presets = () => [
  ['All', layersOf('mine', ...sets.map((set) => set.id))],
  ...sets.map((set) => [`Mine + ${set.title}`, layersOf('mine', set.id)]),
  ['Mine', layersOf('mine')],
  ...sets.map((set) => [set.title, layersOf(set.id)]),
];
const sameLayers = (a, b) => Object.keys(b).every((key) => Boolean(a[key]) === b[key]);

async function drawPlate() {
  const icon = byName.get(state.selected);
  const plate = $('#plate');
  if (!icon || !plate) return;
  const on = Object.entries(state.layers).filter(([, v]) => v).map(([k]) => k);
  plate.style.setProperty('--cells', state.size);
  // One layer alone shows in plain ink. Several show in their own colours.
  plate.classList.toggle('solo-color', on.length === 1);
  let html = '';
  if (state.layers.mine) html += `<div class="mine overlay-layer" style="opacity:${state.opacity.mine}">${mineMarkup(icon)}</div>`;
  for (const set of sets) {
    const current = icon.matches[set.id].current;
    if (!state.layers[set.id] || !current) continue;
    const look = `opacity:${state.opacity[set.id]};transform:scale(${state.scale[set.id] / 100})`;
    if (set.kind === 'sf-symbols') {
      html += `<div class="overlay-layer glyph set-layer" style="--c:${esc(set.color)};--m:${esc(setUrl(set, current))};${look}"></div>`;
    } else {
      let svg = await setSvg(set, current);
      if (state.matchLine && set.matchLine) svg = svg.replace(/stroke-width="[^"]*"/, `stroke-width="${matchedWidth(set)}"`);
      html += `<div class="overlay-layer set-layer" style="--c:${esc(set.color)};${look}">${svg}</div>`;
    }
  }
  // The plate already shows the pixel grid, so it only adds the padding and circle.
  plate.innerHTML = (state.keyGrid ? keyGridSvg(state.size, { lines: false }) : '') + html;
  plate.querySelectorAll('svg').forEach((svg) => { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.cssText = 'width:100%;height:100%;display:block'; });
}

function layerControls(icon, set) {
  const key = set.id;
  const match = icon.matches[key];
  const alts = [...new Set([match.current, ...match.alts].filter(Boolean))];
  return `<div class="layer">
    <div class="layer-head">
      <label><input type="checkbox" data-layer="${key}" ${state.layers[key] ? 'checked' : ''}><i class="dot" style="--c:${esc(set.color)}"></i>${esc(set.title)}</label>
      <span class="target">${match.none ? 'no equivalent' : esc(match.current ?? 'no match')}${match.picked ? ' (your pick)' : ''}</span>
      <input type="range" min="0.1" max="1" step="0.05" value="${state.opacity[key]}" data-opacity="${key}" aria-label="${esc(set.title)} opacity">
    </div>
    <div class="scale"><span>Scale</span><input type="range" min="60" max="140" value="${state.scale[key]}" data-scale="${key}" aria-label="${esc(set.title)} scale"><span data-scale-value="${key}">${state.scale[key]}%</span></div>
    <div class="alts">${alts.map((n) => `<button class="alt${n === match.current ? ' on' : ''}" data-pick="${key}" data-value="${esc(n)}">${glyph(set, n)}${esc(n)}</button>`).join('')}</div>
    <input class="pick" type="search" placeholder="Find another ${esc(set.title)} icon…" data-find="${key}" autocomplete="off" spellcheck="false">
    <div class="alts" data-results="${key}"></div>
    <div>
      ${match.none ? '' : `<button class="link" data-none="${key}">${esc(set.title)} has no equivalent</button>`}
      ${match.picked || match.none ? `<button class="link" data-reset="${key}">Back to the automatic match</button>` : ''}
    </div>
  </div>`;
}

const withCode = (text) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
// Dashed orange in Figma means the same as the mark.
const orangeDashed = (name) => byName.get(name)?.status?.border?.color === '#ffb000' && byName.get(name)?.status?.border?.dashed;
const needsRevision = (name) => Boolean(recordFor.get(name)?.flags?.includes('needs-revision')) || Boolean(orangeDashed(name));
const asList = (names) => names.map((n) => (byName.has(n) ? `<a href="/compare/${esc(n)}" data-open="${esc(n)}">${esc(n)}</a>` : esc(n))).join(', ');

function recordEditor(record) {
  if (!record) return '<p class="none-note">This icon has no record yet. The next sync creates one.</p>';
  const issues = data.issues.filter((issue) => issue.icons?.includes(record.name));
  const findings = data.audit.filter((finding) => finding.icon === record.name);
  const children = data.records.filter((r) => r.parent === record.name || r.canonical === record.name).map((r) => r.name);
  return `<div class="record-edit">
    <button class="btn" data-sync-one="${esc(record.name)}">Sync this icon</button>
    <label>In the set <select data-record-status>${data.statuses.map((s) => `<option value="${s}"${s === record.status ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
    <div class="flags">${data.flags.filter((flag) => flag !== 'needs-revision').map((flag) => `<button data-flag="${flag}" aria-pressed="${(record.flags ?? []).includes(flag)}">${flag}</button>`).join('')}</div>
    ${issues.length ? `<div><h3>Issues</h3>${issues.map((issue) => `<div class="issue"><h4><a href="/issues/${esc(issue.slug)}" data-issue-link="${esc(issue.slug)}">${withCode(issue.title)}</a></h4><p>${esc(issue.status)}${issue.owner ? `, ${esc(issue.owner)}` : ''}</p></div>`).join('')}</div>` : ''}
    ${findings.length ? `<div><h3>Audit</h3>${findings.map((f) => `<p class="note"><b>${esc(f.check)}, ${esc(f.severity)}:</b> ${esc(f.detail)}</p>`).join('')}</div>` : ''}
    <dl class="facts">
      ${record.source ? `<dt>Source</dt><dd>${esc(record.source)}${record.wave ? ` · ${esc(record.wave)}` : ''}</dd>` : ''}
      ${record.parent ? `<dt>Parent</dt><dd>${asList([record.parent])}</dd>` : ''}
      ${record.canonical ? `<dt>Uses</dt><dd>${asList([record.canonical])}</dd>` : ''}
      ${children.length ? `<dt>Follows this</dt><dd>${asList(children)}</dd>` : ''}
      ${record.formerNames?.length ? `<dt>Was</dt><dd>${esc(record.formerNames.join(', '))}</dd>` : ''}
      ${Object.entries(record.compareAlso ?? {}).map(([set, names]) => `<dt>${esc(setById(set)?.title ?? set)} too</dt><dd>${esc(names.join(', '))}</dd>`).join('')}
      ${record.pick ? `<dt>Pick</dt><dd>${esc(record.pick)}</dd>` : ''}
      ${record.fillApproved ? '<dt>Fills</dt><dd>Approved</dd>' : ''}
    </dl>
    <label>Keywords <input type="text" data-record-keywords value="${esc((record.keywords ?? []).join(', '))}" placeholder="Other words people use for this icon"></label>
    <label>Looks like <textarea data-record-text="looks" rows="2" placeholder="What's drawn, for search, AI agents and the icon page">${esc(record.looks ?? '')}</textarea></label>
    <label>Use for <textarea data-record-text="use" rows="2" placeholder="Use for …">${esc(record.use ?? '')}</textarea></label>
    ${(record.notes ?? []).map((note) => `<p class="note"><b>${esc(note.by)}, ${esc(note.at)}:</b> ${esc(note.text)}</p>`).join('')}
    <textarea data-note placeholder="Add a note. It also files an issue."></textarea>
    <div><button class="btn" id="add-note">Add note</button></div>
  </div>`;
}

function drawStage() {
  if (state.missing) return drawMissingPanel();
  const panel = $('#stage-panel');
  const icon = byName.get(state.selected);
  if (!icon) {
    panel.innerHTML = '<p style="color:var(--soft)">Pick an icon to overlay it.</p>';
    return;
  }
  const s = statusLabel(icon);
  const nodeId = icon.status?.id?.replace(':', '-');
  panel.innerHTML = `
    <div class="stage-title"><h2>${esc(icon.name)}</h2>${icon.released ? '' : `<button class="btn approve" id="approve" aria-pressed="${Boolean(recordFor.get(icon.name)?.approved)}" title="A">${recordFor.get(icon.name)?.approved ? 'Approved' : 'Approve'}</button>`}<button class="btn revision" id="needs-revision" aria-pressed="${needsRevision(icon.name)}">Needs revision</button></div>
    <span class="hint">← → next · 1–${sets.length + 1} alone · 0 all · A approve</span>
    <div class="plate" id="plate" style="--cells:${state.size}"></div>
    <div class="presets">${presets().map(([label, layers]) => `<button data-preset="${label}" aria-pressed="${sameLayers(state.layers, layers)}">${label}</button>`).join('')}</div>
    <div class="layers">
      <div class="layer"><div class="layer-head">
        <label><input type="checkbox" data-layer="mine" ${state.layers.mine ? 'checked' : ''}><i class="dot" style="--c:var(--mine)"></i>Mine</label>
        <span class="target">${state.size}px ${usableWeight(icon)}</span>
        <input type="range" min="0.1" max="1" step="0.05" value="${state.opacity.mine}" data-opacity="mine" aria-label="Mine opacity">
      </div></div>
      ${sets.map((set) => layerControls(icon, set)).join('')}
    </div>
    <div class="strip">${SIZES.map((size) => {
      const fits = weightFits(usableWeight(icon), size);
      return `<div class="${fits ? '' : 'off'}">${toSvg(icon, size, fits ? usableWeight(icon) : 'regular')}<span>${size}</span></div>`;
    }).join('')}</div>
    <div class="history" id="history"></div>
    <dl class="facts">
      <dt>Stage</dt><dd><i class="swatch${s.dashed ? ' dashed' : ''}" style="--c:${esc(s.color ?? '#e3e5e7')}"></i> ${esc(s.label)}</dd>
      <dt>Category</dt><dd>${esc(icon.category)}${icon.group ? ` · ${esc(icon.group)}` : ''}</dd>
      ${icon.aliases?.length ? `<dt>Also</dt><dd>${esc(icon.aliases.join(', '))}</dd>` : ''}
    </dl>
    <div class="actions">
      ${nodeId ? `<a class="btn" href="${esc(data.figma)}?node-id=${esc(nodeId)}" target="_blank" rel="noreferrer" data-figma="${esc(nodeId)}">Open in Figma</a>` : ''}
      ${icon.released ? `<a class="btn" href="http://localhost:4173/icons/${esc(icon.name)}/" target="_blank" rel="noreferrer">Site page</a>` : ''}
      <button class="btn" id="copy-svg">Copy my SVG</button>
    </div>
    ${recordEditor(recordFor.get(icon.name))}`;
  drawPlate();
  drawHistory(icon.name);
}

// Approving ships the drawing as it is now. The next sync releases it, and the Figma plugin turns its border pink.
const staleApprovals = new Set(); // approved, then redrawn, so approving again renews it rather than taking it back
async function toggleApproval(name) {
  const icon = byName.get(name);
  if (!icon || icon.released || !recordFor.get(name)) return;
  const undo = Boolean(recordFor.get(name).approved) && !staleApprovals.has(name);
  staleApprovals.delete(name);
  try {
    rememberRecord(await send('POST', `/api/records/${name}/approve`, { by: 'morgan', undo }));
  } catch {
    return; // send() has already shown why
  }
  // After an approval, move on to the next icon in the list. Worked out before refiltering, since a status
  // filter can drop the approved icon from the list.
  const at = shown.findIndex((i) => i.name === name);
  const next = !undo && at >= 0 ? shown[at + 1] : null;
  applyFilters();
  if (next && state.selected === name) select(next.name, true, 'replace');
  else if (state.selected === name) drawStage();
  toast(undo ? `Took back the approval for ${name}` : `Approved ${name}. It ships on the next sync.`);
}

// The A key only ever approves. Taking an approval back is the button's job, so a stray keypress can't undo one.
function approveByKey(name) {
  const icon = byName.get(name);
  if (!icon) return;
  if (icon.released) return toast(`${name} is already live`);
  if (!recordFor.get(name)) return toast(`${name} has no record yet. Sync it first.`);
  if (recordFor.get(name).approved && !staleApprovals.has(name)) return toast(`${name} is already approved`);
  return toggleApproval(name);
}

// Every drawing the icon has had, oldest first, from icons/history. The last one is what's in Figma now.
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
async function drawHistory(name) {
  const versions = await fetch(`/api/history?name=${encodeURIComponent(name)}`).then((r) => r.json()).catch(() => []);
  const box = $('#history');
  if (!box || state.selected !== name) return;
  // An approval covers the drawing it was given to. Say so when there's been a redraw since.
  const approved = recordFor.get(name)?.approved;
  if (approved && versions.length && versions.at(-1).at !== approved.version) {
    staleApprovals.add(name);
    const button = $('#approve');
    if (button) { button.textContent = 'Approve again'; button.setAttribute('aria-pressed', 'false'); }
    box.insertAdjacentHTML('beforebegin', '<p class="stale-approval" id="stale-approval">Redrawn since you approved it, so it won\'t ship until you approve it again.</p>');
  }
  if (versions.length < 2) {
    box.innerHTML = `<h3>History</h3><p class="hint">${versions.length ? 'Only one drawing so far.' : 'No history yet. The next sync starts it.'}</p>`;
    return;
  }
  box.innerHTML = `<h3>History <span class="hint">${versions.length} drawings</span></h3><div class="versions">${versions
    .map((v, i) => {
      const now = i === versions.length - 1;
      const label = now ? 'Now' : day.format(new Date(v.at));
      return `<figure class="${now ? 'now' : ''}" title="${esc(`${v.at} · ${v.source}${v.released ? ' · released' : ' · not released'}`)}">${toSvg({ ...v, name }, 32)}<figcaption>${esc(label)}${v.released ? '<i class="shipped" aria-label="released"></i>' : ''}</figcaption></figure>`;
    })
    .reverse()
    .join('')}</div>`;
}

// Each icon has its own address, /compare/<name>. Clicking adds to the history; arrow keys just update it.
const pathFor = (view) => (view === 'compare' && state.selected ? `/compare/${state.selected}` : view === 'issues' && state.issue && state.issue !== 'new' ? `/issues/${state.issue}` : `/${view}`);

function select(name, scroll = true, how = 'push') {
  state.missing = null;
  state.selected = name;
  save();
  if (how && state.view === 'compare' && location.pathname !== pathFor('compare')) history[how === 'push' ? 'pushState' : 'replaceState'](null, '', pathFor('compare'));
  document.querySelectorAll('#rows .row.on').forEach((r) => r.classList.remove('on'));
  const row = document.querySelector(`#rows .row[data-name="${CSS.escape(name)}"]`);
  row?.classList.add('on');
  if (scroll) row?.scrollIntoView({ block: 'nearest' });
  drawStage();
}

// A match is a set's name for this icon, false for no equivalent, or null to go back to the automatic guess.
async function saveMatch(icon, setId, value) {
  await saveRecord(icon.name, { compare: { [setId]: value } });
  // Look the icon up again, in case the data reloaded during the save.
  const match = byName.get(icon.name).matches[setId];
  match.none = value === false;
  match.picked = typeof value === 'string';
  match.current = value === false ? null : value ?? match.alts[0] ?? null;
  const row = document.querySelector(`#rows .row[data-name="${CSS.escape(icon.name)}"]`);
  if (row) drawRow(row);
  drawStage();
}

async function send(method, url, body) {
  const response = await fetch(url, { method, body: JSON.stringify(body) });
  if (!response.ok) {
    toast(await response.text());
    throw new Error(`${url} failed`);
  }
  return response.json();
}
async function saveRecord(name, changes) {
  const saved = await send('PATCH', `/api/records/${name}`, changes);
  rememberRecord(saved);
  return saved;
}
function rememberRecord(saved) {
  recordFor.set(saved.name, saved);
  const at = data.records.findIndex((r) => r.name === saved.name);
  if (at >= 0) data.records[at] = saved;
  else data.records.push(saved);
  // This page already shows its own change, so it doesn't need to reload for it.
  fetch('/api/stamp').then((response) => response.text()).then((now) => { seenStamp = now; });
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 1600);
}

// ---- Records ----

const STAGE_LABEL = { ready: 'Approved', refine: 'Gray', new: 'New', 'needs-revision': 'Needs revision', none: 'No border', absent: 'Not drawn', other: 'Other' };
const fillSelect = (id, label, values, describe = (v) => v) => {
  const el = $(id);
  const was = el.value;
  el.innerHTML = `<option value="">${label}</option>${values.map((v) => `<option value="${esc(v)}">${esc(describe(v))}</option>`).join('')}`;
  el.value = was;
};
const unique = (read) => [...new Set(data.records.flatMap(read).filter(Boolean))].sort();

function fillRecordFilters() {
  fillSelect('#r-stage', 'Every stage', unique((r) => r.observed.stage), (v) => STAGE_LABEL[v] ?? v);
  fillSelect('#r-status', 'In the set: any', data.statuses, (s) => s[0].toUpperCase() + s.slice(1));
  fillSelect('#r-flag', 'Every flag', data.flags);
  fillSelect('#r-source', 'Every source', unique((r) => r.source));
  fillSelect('#r-wave', 'Every wave', unique((r) => r.wave));
  fillSelect('#r-section', 'Every section', unique((r) => r.observed.section));
}

function drawRecords() {
  const terms = $('#r-q').value.toLowerCase().split(/\s+/).filter(Boolean);
  const filters = { stage: $('#r-stage').value, status: $('#r-status').value, flag: $('#r-flag').value, source: $('#r-source').value, wave: $('#r-wave').value, section: $('#r-section').value };
  const items = data.records.filter((r) => {
    if (filters.stage && r.observed.stage !== filters.stage) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.flag && !(r.flags ?? []).includes(filters.flag)) return false;
    if (filters.source && r.source !== filters.source) return false;
    if (filters.wave && r.wave !== filters.wave) return false;
    if (filters.section && r.observed.section !== filters.section) return false;
    const hay = [r.name, ...(r.formerNames ?? []), ...(r.aliases ?? []), ...(r.keywords ?? []), r.coveredBy ?? '', r.looks ?? '', r.use ?? '', ...(r.notes ?? []).map((n) => n.text)].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  $('#r-count').textContent = `${items.length} of ${data.records.length} records`;
  let html = '';
  if (data.rules) html += `<details><summary>Rules for every icon</summary><pre class="rules-text">${esc(data.rules)}</pre></details>`;
  const groups = new Map();
  for (const record of items) {
    const heading = record.observed.section ?? (record.status === 'active' ? 'Not in a Figma frame' : `${record.status[0].toUpperCase()}${record.status.slice(1)}`);
    (groups.get(heading) ?? groups.set(heading, []).get(heading)).push(record);
  }
  for (const [heading, records] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    html += `<h3>${esc(heading)}</h3><div class="items">${records.map((record) => {
      const drawn = byName.has(record.name);
      const pill = record.coveredBy ? `→ ${esc(record.coveredBy)}` : record.status === 'dropped' ? 'Dropped' : esc(STAGE_LABEL[record.observed.stage] ?? record.observed.stage);
      const className = record.status === 'dropped' ? 'dropped' : record.observed.stage;
      return `<button class="item${drawn ? '' : ' none'}" ${drawn ? `data-open="${esc(record.name)}"` : ''} title="${esc((record.notes ?? []).map((n) => n.text).join(' / '))}">
        <span class="box" data-icon="${drawn ? esc(record.name) : ''}"></span><span class="n">${esc(record.name)}</span>${(record.flags ?? []).length ? `<span class="pill" title="${esc(record.flags.join(', '))}">${record.flags.length}</span>` : ''}<span class="pill ${esc(className)}">${pill}</span></button>`;
    }).join('')}</div>`;
  }
  $('#records').innerHTML = html;
  document.querySelectorAll('#records [data-icon]').forEach((box) => {
    const icon = byName.get(box.dataset.icon);
    if (icon) {
      box.innerHTML = toSvg(icon, 16);
      box.firstElementChild.style.cssText = 'width:100%;height:100%';
    }
  });
}

// ---- Issues ----

const when = (at) => (at?.length > 10 ? new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : at ?? '');
const EVENT_WORDS = { created: 'opened this', comment: 'commented', decided: 'decided', done: 'marked this done', reopened: 'reopened this', claimed: 'claimed this for', unclaimed: 'released this', edited: 'edited this' };
const eventHtml = (event, withIssue) => `<div class="event"><small>${esc(event.by ?? 'unknown')} ${esc(EVENT_WORDS[event.type] ?? event.type)}${withIssue ? ` <a href="/issues/${esc(event.slug)}" data-issue-link="${esc(event.slug)}">${withCode(event.title)}</a>` : ''}, ${esc(when(event.at))}</small>${event.text ? withCode(event.text) : ''}</div>`;

async function refreshIssues() {
  data.issues = await (await fetch('/api/issues')).json();
  seenStamp = await (await fetch('/api/stamp')).text();
  updateIssueCount();
}
const updateIssueCount = () => { $('#issues-tab').textContent = `Issues (${data.issues.filter((issue) => issue.status === 'open').length})`; };

function drawIssues() {
  const terms = $('#i-q').value.toLowerCase().split(/\s+/).filter(Boolean);
  const status = $('#i-status').value, owner = $('#i-owner').value;
  const wasOwner = owner;
  const owners = [...new Set(data.issues.map((issue) => issue.owner).filter(Boolean))].sort();
  $('#i-owner').innerHTML = `<option value="">Anyone</option><option value="-">Unclaimed</option>${owners.map((o) => `<option>${esc(o)}</option>`).join('')}`;
  $('#i-owner').value = wasOwner;
  const items = data.issues.filter((issue) => {
    if (status && issue.status !== status) return false;
    if (owner === '-' ? issue.owner : owner && issue.owner !== owner) return false;
    const hay = [issue.title, issue.text, issue.decision ?? '', ...(issue.icons ?? []), ...issue.events.map((e) => e.text ?? '')].join(' ').toLowerCase();
    return terms.every((term) => hay.includes(term));
  }).sort((a, b) => b.events.at(-1).at.localeCompare(a.events.at(-1).at));
  $('#i-count').textContent = `${items.length} of ${data.issues.length} issues`;
  $('#issue-list').innerHTML = items.map((issue) => `<button class="issue-row${issue.slug === state.issue ? ' on' : ''}" data-issue-link="${esc(issue.slug)}"><b>${withCode(issue.title)}</b><span>${esc(issue.status)}${issue.owner ? `, ${esc(issue.owner)}` : ''}${issue.icons?.length ? `, ${issue.icons.length} icon${issue.icons.length === 1 ? '' : 's'}` : ''}, ${esc(when(issue.events.at(-1).at))}</span></button>`).join('') || '<p style="padding:14px;color:var(--soft)">No issues match. Try another status.</p>';
  drawIssuePanel();
}

function drawIssuePanel() {
  const panel = $('#issue-panel');
  if (state.issue === 'new') {
    panel.innerHTML = `<div class="issue-form"><h2>New issue</h2>
      <label>Title <input type="text" id="new-title"></label>
      <label>Details <textarea id="new-text"></textarea></label>
      <label>Icons, separated by commas <input type="text" id="new-icons" spellcheck="false"></label>
      <div><button class="btn primary" data-issue-act="create">Create issue</button></div></div>`;
    return;
  }
  const issue = data.issues.find((i) => i.slug === state.issue);
  if (!issue) {
    const events = data.issues.flatMap((i) => i.events.map((event) => ({ ...event, slug: i.slug, title: i.title }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
    panel.innerHTML = `<div class="issue-detail"><h2>Activity</h2><p>The same feed agents read with <code>npm run icon -- stream --as their-name</code>.</p><div>${events.map((event) => eventHtml(event, true)).join('')}</div></div>`;
    return;
  }
  panel.innerHTML = `<div class="issue-detail">
    <h2>${withCode(issue.title)}</h2>
    <p>${esc(issue.status)}${issue.owner ? `, claimed by ${esc(issue.owner)}` : ''}</p>
    ${issue.text ? `<p>${withCode(issue.text)}</p>` : ''}
    ${issue.decision ? `<p><b>Decision:</b> ${withCode(issue.decision)}</p>` : ''}
    ${issue.icons?.length ? `<div class="issue-icon-list">${issue.icons.map((name) => {
      const icon = byName.get(name);
      return icon ? `<a class="issue-icon" href="/compare/${esc(name)}" data-open="${esc(name)}">${toSvg(icon, 16)}${esc(name)}</a>` : `<span class="issue-icon">${esc(name)}</span>`;
    }).join('')}</div>` : ''}
    <div><h3>History</h3>${issue.events.map((event) => eventHtml(event, false)).join('')}</div>
    <textarea id="issue-text" placeholder="Write a comment or a decision"></textarea>
    <div class="actions">
      <button class="btn" data-issue-act="comment">Comment</button>
      ${issue.status === 'open' ? '<button class="btn" data-issue-act="decide">Record as decision</button>' : '<button class="btn" data-issue-act="reopen">Reopen</button>'}
      ${issue.status === 'done' ? '' : '<button class="btn" data-issue-act="done">Mark done</button>'}
    </div>
  </div>`;
}

async function issueAction(action) {
  try {
    if (action === 'create') {
      const icons = $('#new-icons').value.split(',').map((name) => name.trim()).filter(Boolean);
      const created = await send('POST', '/api/issues', { title: $('#new-title').value, text: $('#new-text').value, icons, by: 'morgan' });
      state.issue = created.slug;
    } else {
      const text = $('#issue-text').value.trim();
      const path = `/api/issues/${state.issue}`;
      if (action === 'comment') {
        if (!text) return toast('Write a comment first');
        await send('POST', `${path}/comment`, { text, by: 'morgan' });
      } else if (action === 'decide') {
        if (!text) return toast('Write the decision first');
        await send('PATCH', path, { status: 'decided', decision: text, by: 'morgan' });
      } else if (action === 'done') {
        await send('PATCH', path, { status: 'done', by: 'morgan' });
      } else if (action === 'reopen') {
        await send('PATCH', path, { status: 'open', by: 'morgan' });
      }
    }
  } catch {
    return;
  }
  await refreshIssues();
  history.replaceState(null, '', pathFor('issues'));
  drawIssues();
}

// ---- Tools ----

function drawTools() {
  const r = data.report;
  const names = (list) => (list?.length ? `<div class="names">${esc(list.join(', '))}</div>` : '');
  const counts = new Map();
  for (const icon of data.icons) {
    const key = statusKey(icon);
    const s = statusLabel(icon);
    counts.set(key, { ...s, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  $('#tools').innerHTML = `
    <div class="card wide">
      <h2>Run</h2>
      <div class="actions">
        <button class="btn primary" data-run="sync-changed">Sync changes</button>
        <button class="btn" data-run="sync">Sync everything</button>
        <button class="btn" data-run="sync-build">Sync and build the site</button>
        <button class="btn" data-run="check">Check the SVGs</button>
        <button class="btn" data-run="build">Build the site</button>
        <button class="btn ship" data-run="ship" title="Sync, test the deploy build, commit the icon data, publish the preview, and push live">Ship live</button>
        ${data.hasReview ? '<a class="btn" href="/review" target="_blank">Open the review page</a>' : ''}
        <a class="btn" href="http://localhost:4173/" target="_blank" rel="noreferrer">Site preview</a>
        <a class="btn" href="${esc(data.figma)}" target="_blank" rel="noreferrer" data-figma="">Figma file</a>
      </div>
      <pre class="log" id="log">Output appears here.</pre>
    </div>
    <div class="card report">
      <h2>Last sync</h2>
      ${r ? `<p>${esc(new Date(r.at).toLocaleString())}: ${r.count} icons, ${r.count - r.previous >= 0 ? '+' : ''}${r.count - r.previous}</p>
      <div><b>Added ${r.added.length}</b>${names(r.added)}</div>
      <div><b>Removed ${r.removed.length}</b>${names(r.removed)}</div>
      <div><b>Redrawn ${r.redrawn.length}</b>${names(r.redrawn)}</div>
      <div><b>Moved ${r.moved.length}</b>${names(r.moved)}</div>
      <div><b>Regular only ${r.regularOnly.length}</b>${names(r.regularOnly)}</div>
      <div><b>Fills not on the allowed list ${r.strayFills.length}</b>${names(r.strayFills)}</div>
      ${r.records ? Object.entries({ 'New records': r.records.created, 'Planned, now in Figma': r.records.activated, 'Renamed in Figma': r.records.renamed, 'Different Figma ID': r.records.idChanged, 'Dropped or covered, but in Figma': r.records.conflicts, 'Gone from the frames': r.records.missing }).filter(([, list]) => list.length).map(([label, list]) => `<div><b>${label} ${list.length}</b>${names(list)}</div>`).join('') : ''}` : '<p>No sync has run yet.</p>'}
    </div>
    <div class="card">
      <h2>Figma borders</h2>
      <p>Click one to filter the Compare list.</p>
      <div class="legend">${[...counts].sort((a, b) => b[1].n - a[1].n).map(([key, s]) => `<button data-status="${esc(key)}"><i class="swatch${s.dashed ? ' dashed' : ''}" style="--c:${esc(s.color ?? '#e3e5e7')}"></i>${esc(s.label)}: ${s.n}</button>`).join('')}</div>
    </div>
    <div class="card">
      <h2>Sizes and weights</h2>
      <table class="rules"><tr><th>Weight</th><th>Line</th><th>Sizes</th></tr>
      ${Object.entries(WEIGHTS).map(([w, px]) => `<tr><td>${w}</td><td>${px}px</td><td>${sizesFor(w).join(', ')}</td></tr>`).join('')}</table>
      <p>${esc(LIMITS)}</p>
    </div>
    <div class="card">
      <h2>Keep this local</h2>
      <p>SF Symbols are rendered from the copy in macOS into <code>.workbench/</code>, which git ignores. Use the overlays to compare, not to trace.</p>
      ${sets.map((set) => `<p><b>${esc(set.title)}</b>, ${esc(set.license)}. ${esc(set.usage)}</p>`).join('')}
    </div>
    <div class="card report">
      <h2>Audit</h2>
      <p>${data.audit.filter((f) => f.severity === 'error').length} errors and ${data.audit.filter((f) => f.severity === 'warn').length} warnings. It only reports for now, and doesn't block a release.</p>
      ${Object.entries(Object.groupBy(data.audit, (f) => `${f.check}, ${f.severity}`)).sort(([a], [b]) => a.localeCompare(b)).map(([label, rows]) => `<div><b>${esc(label)}: ${rows.length}</b>${names(rows.slice(0, 40).map((r) => r.icon))}</div>`).join('')}
    </div>
    <div class="card">
      <h2>Agents</h2>
      <p>Records and issues are files in <code>icons/</code>. Use <code>npm run icon</code> to read and change them, with or without this page open. This page picks up the changes by itself.</p><p>Check for new work with <code>npm run icon -- stream --as your-name</code>, and claim an issue with <code>owner=your-name</code>.</p>
    </div>`;
}

async function runTool(tool) {
  const log = $('#log');
  log.textContent = '';
  document.querySelectorAll('[data-run]').forEach((b) => (b.disabled = true));
  try {
    const response = await fetch(`/api/run/${tool}`, { method: 'POST' });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      log.textContent += decoder.decode(value);
      log.scrollTop = log.scrollHeight;
    }
    const before = log.textContent;
    await load();
    drawTools();
    $('#log').textContent = before;
  } catch (error) {
    log.textContent += `\n${error.message}`;
  }
  document.querySelectorAll('[data-run]').forEach((b) => (b.disabled = false));
}

async function runSyncOne(button) {
  const name = button.dataset.syncOne;
  button.disabled = true;
  button.textContent = 'Syncing…';
  try {
    const response = await fetch(`/api/run/sync-one?name=${encodeURIComponent(name)}`, { method: 'POST' });
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    const code = text.match(/finished with exit code (\d+)/)?.[1];
    if (code !== '0') throw new Error(text.match(/Not in a category frame[^\n]*/)?.[0] ?? `Couldn't sync ${name}`);
    await load();
    toast(`Synced ${name}`);
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    button.textContent = 'Sync this icon';
  }
}

function toggleRowGrid(name) {
  if (gridRows.has(name)) gridRows.delete(name);
  else gridRows.add(name);
  const row = document.querySelector(`#rows .row[data-name="${CSS.escape(name)}"]`);
  if (row) {
    drawRow(row);
    row.querySelector('[data-row-grid]')?.setAttribute('aria-pressed', String(gridOn(name)));
  }
}

// ---- Wiring ----

const VIEWS = ['compare', 'records', 'issues', 'weights', 'sizes', 'tools'];
const viewFromUrl = () => VIEWS.find((v) => location.pathname === `/${v}` || location.pathname.startsWith(`/${v}/`));
const issueFromUrl = () => location.pathname.match(/^\/issues\/([a-z0-9-]+)$/)?.[1] ?? null;
const iconFromUrl = () => location.pathname.match(/^\/compare\/([a-z0-9-]+)$/)?.[1];

// On a phone the list and the detail panel take turns on screen. Picking something shows its detail, and
// Back returns to the list. On wider screens they sit side by side and this class changes nothing.
const showDetail = () => document.body.classList.add('show-detail');
function hideDetail() {
  document.body.classList.remove('show-detail');
  document.querySelector('#rows .row.on, .issue-row.on')?.scrollIntoView({ block: 'nearest' });
}

// Each filter bar folds away behind a button on a phone, keeping only its search box.
for (const bar of document.querySelectorAll('.filters')) {
  const button = Object.assign(document.createElement('button'), { className: 'filters-toggle btn', type: 'button', textContent: 'Filters' });
  button.setAttribute('aria-expanded', 'false');
  const search = bar.querySelector('input[type="search"]');
  if (search) search.after(button);
  else bar.prepend(button);
}

function setView(view, { push = true } = {}) {
  if (view !== state.view) document.body.classList.remove('show-detail');
  state.view = view;
  save();
  if (push && location.pathname !== pathFor(view)) history.pushState(null, '', pathFor(view));
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll('#tabs a').forEach((a) => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (view === 'records') drawRecords();
  if (view === 'issues') drawIssues();
  if (view === 'tools') drawTools();
  if (view === 'weights') drawWeights($('#weights'), data);
  if (view === 'sizes') drawSizes($('#sizes'), data, { statusLabel });
  if (view === 'compare') { if (!state.match.startsWith('missing:')) $('#count').textContent = `${shown.length} of ${data.icons.length} icons`; }
  else $('#count').textContent = '';
}
const setLayers = (layers) => {
  state.layers = { ...layers };
  save();
  drawStage();
  redrawOverlays();
};
const redrawAll = () => {
  save();
  applyFilters();
  drawStage();
};

function fillControls() {
  $('#size').innerHTML = SIZES.map((s) => `<option${s === state.size ? ' selected' : ''}>${s}</option>`).join('');
  $('#weight').innerHTML = Object.keys(WEIGHTS).map((w) => `<option${w === state.weight ? ' selected' : ''}>${w}</option>`).join('');
  $('#sf-weight').innerHTML = SF_WEIGHTS.map((w) => `<option${w === state.sfWeight ? ' selected' : ''}>${w}</option>`).join('');
  $('#match-line').checked = state.matchLine;
  $('#key-grid').checked = state.keyGrid;
  const statuses = new Map();
  for (const icon of data.icons) statuses.set(statusKey(icon), statusLabel(icon).label);
  $('#f-status').innerHTML = `<option value="">Every stage</option>${[...statuses].map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}`;
  $('#f-status').value = state.status;
  const cats = [...new Set(data.icons.map((i) => i.category))].sort();
  $('#f-category').innerHTML = `<option value="">Every category</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}`;
  $('#f-category').value = state.category;
  const was = state.match;
  $('#f-match').innerHTML = `<option value="">Any match</option><option value="picked">Picked by hand</option>${sets.filter((set) => set.kind === 'svg').map((set) => `<option value="missing:${esc(set.id)}">In ${esc(set.title)}, not mine</option>`).join('')}${sets.map((set) => `
    <option value="no:${esc(set.id)}">No ${esc(set.title)} match</option>
    <option value="confirmed:${esc(set.id)}">${esc(set.title)}: confirmed none</option>
    <option value="unreviewed:${esc(set.id)}">${esc(set.title)}: not reviewed</option>`).join('')}`;
  $('#f-match').value = was;
  $('#f-flag').innerHTML = `<option value="">Any flag</option>${data.flags.filter((f) => f !== 'needs-revision').map((f) => `<option>${esc(f)}</option>`).join('')}`;
  $('#f-flag').value = state.flag;
  $('#f-dupes').innerHTML = `<option value="">Duplicates: off</option><option value="all">All duplicates</option>${Object.entries(DUPE_KINDS).map(([kind, [label]]) => `<option value="${kind}">${esc(label)}</option>`).join('')}`;
  $('#f-dupes').value = state.dupes;
  $('#f-line-stacks').innerHTML = `<option value="">Line stacks: off</option><option value="clear">Clear matches</option><option value="all">All, with borderline</option>${Object.entries(LINE_STACK_KINDS).map(([kind, label]) => `<option value="${kind}">${esc(label)}</option>`).join('')}`;
  $('#f-line-stacks').value = state.lineStacks;
  fillRecordFilters();
  // The list's columns follow the sets.
  $('#list').style.setProperty('--row-cols', `minmax(110px, 1.4fr) repeat(${sets.length + 2}, minmax(52px, 1fr))`);
  $('#row-head').innerHTML = ['Icon', 'Mine', ...sets.map((set) => set.title), 'Overlay'].map((label) => `<span>${esc(label)}</span>`).join('');
}

document.addEventListener('click', (event) => {
  const t = event.target;
  // Tabs without a view, like Launch, are ordinary links to other pages.
  const tab = t.closest('#tabs a[data-view]');
  // Cmd-click and the like open a new tab as usual.
  if (tab && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
    event.preventDefault();
    return setView(tab.dataset.view);
  }
  const rowGrid = t.closest('[data-row-grid]');
  if (rowGrid) return toggleRowGrid(rowGrid.dataset.rowGrid);
  const row = t.closest('#rows .row');
  if (row) showDetail();
  if (row && !row.dataset.missing) return select(row.dataset.name, false);
  if (row) return selectMissing(row);
  if (t.closest('[data-back]')) return hideDetail();
  const filtersToggle = t.closest('.filters-toggle');
  if (filtersToggle) {
    const open = filtersToggle.closest('.filters').classList.toggle('open');
    filtersToggle.setAttribute('aria-expanded', String(open));
    return;
  }
  if (t.closest('#create-one')) return createOne().catch(() => {});
  const claimed = t.closest('[data-claim]');
  if (claimed) return claim(claimed.dataset.claim);
  const preset = t.closest('[data-preset]');
  if (preset) return setLayers(presets().find(([label]) => label === preset.dataset.preset)[1]);
  const pick = t.closest('[data-pick]');
  if (pick) return saveMatch(byName.get(state.selected), pick.dataset.pick, pick.dataset.value);
  const reset = t.closest('[data-reset]');
  if (reset) return saveMatch(byName.get(state.selected), reset.dataset.reset, null);
  const none = t.closest('[data-none]');
  if (none) return saveMatch(byName.get(state.selected), none.dataset.none, false);
  const flag = t.closest('[data-flag]');
  if (flag) {
    const record = recordFor.get(state.selected);
    const flags = new Set(record.flags ?? []);
    if (flags.has(flag.dataset.flag)) flags.delete(flag.dataset.flag);
    else flags.add(flag.dataset.flag);
    saveRecord(record.name, { flags: [...flags] }).then(drawStage);
    return;
  }
  if (t.closest('#approve')) return toggleApproval(state.selected);
  if (t.closest('#needs-revision')) {
    const name = state.selected;
    const undo = needsRevision(name);
    send('POST', `/api/records/${name}/revision`, { by: 'morgan', undo }).then(async (saved) => {
      rememberRecord(saved);
      await refreshIssues();
      document.querySelector(`#rows .row[data-name="${CSS.escape(name)}"] .revision-mark`)?.toggleAttribute('hidden', !needsRevision(name));
      if (state.selected === name) drawStage();
      // The plugin only paints borders on, so a dashed orange border has to be changed in Figma.
      if (undo && orangeDashed(name)) toast('Unmarked and closed its issue. Its border in Figma is still dashed orange, so change it there.');
      else toast(undo ? 'Unmarked, and closed its issue' : 'Marked and filed an issue. The Figma plugin turns it dashed orange.');
    });
    return;
  }
  if (t.closest('#add-note')) {
    const text = document.querySelector('[data-note]').value.trim();
    if (text) send('POST', `/api/records/${state.selected}/note`, { text, by: 'morgan' }).then(async (saved) => {
      rememberRecord(saved);
      await refreshIssues();
      drawStage();
      toast('Added and filed as an issue');
    });
    return;
  }
  const issueLink = t.closest('[data-issue-link]');
  if (issueLink && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    state.issue = issueLink.dataset.issueLink;
    setView('issues');
    return showDetail();
  }
  if (t.closest('#show-activity') && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    state.issue = null;
    return setView('issues');
  }
  if (t.closest('#new-issue')) {
    state.issue = 'new';
    showDetail();
    return drawIssues();
  }
  const issueAct = t.closest('[data-issue-act]');
  if (issueAct) return issueAction(issueAct.dataset.issueAct);
  // Opens the installed app. If that fails, the link falls back to the browser.
  const figmaLink = t.closest('[data-figma]');
  if (figmaLink) {
    event.preventDefault();
    fetch(`/api/open-figma?node=${encodeURIComponent(figmaLink.dataset.figma)}`, { method: 'POST' })
      .then((res) => { if (!res.ok) throw new Error(res.statusText); })
      .catch(() => window.open(figmaLink.href, '_blank', 'noreferrer'));
    return;
  }
  const open = t.closest('[data-open]');
  if (open) {
    event.preventDefault();
    setView('compare');
    return select(open.dataset.open);
  }
  const syncOne = t.closest('[data-sync-one]');
  if (syncOne) return runSyncOne(syncOne);
  const run = t.closest('[data-run]');
  if (run) return runTool(run.dataset.run);
  const status = t.closest('[data-status]');
  if (status) {
    state.status = status.dataset.status;
    $('#f-status').value = state.status;
    applyFilters();
    return setView('compare');
  }
});

document.addEventListener('input', (event) => {
  const t = event.target;
  if (t.id === 'q') { state.q = t.value; return applyFilters(); }
  if (t.dataset.claimFind !== undefined) {
    const set = setById(state.missing.set);
    const terms = t.value.toLowerCase().split(/\s+/).filter(Boolean);
    // Names come first. Group and category names are left out, or "book" finds everything in "Books, weather, and objects".
    const words = (icon) => [icon.name, ...(icon.keywords ?? []).filter((k) => k !== icon.category && k !== icon.group?.toLowerCase())].join(' ').toLowerCase();
    const rank = (icon) => (terms.every((term) => icon.name.startsWith(term)) ? 0 : terms.every((term) => icon.name.includes(term)) ? 1 : 2);
    const hits = terms.length ? data.icons.filter((icon) => terms.every((term) => words(icon).includes(term))).sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length).slice(0, 24) : [];
    document.querySelector('[data-claim-results]').innerHTML = hits.map((icon) => claimButton(icon, set)).join('');
    return;
  }
  if (t.id === 'r-q') return drawRecords();
  if (t.id === 'i-q') return drawIssues();
  if (t.dataset.opacity) {
    state.opacity[t.dataset.opacity] = +t.value;
    save();
    drawPlate();
    return redrawOverlays();
  }
  if (t.dataset.scale) {
    state.scale[t.dataset.scale] = +t.value;
    document.querySelector(`[data-scale-value="${t.dataset.scale}"]`).textContent = `${t.value}%`;
    save();
    drawPlate();
    return redrawOverlays();
  }
  if (t.dataset.find) {
    const key = t.dataset.find;
    const terms = t.value.toLowerCase().split(/[\s.-]+/).filter(Boolean);
    const set = setById(key);
    const hits = terms.length ? set.names.filter((n) => terms.every((w) => n.includes(w))).sort((a, b) => a.length - b.length).slice(0, 24) : [];
    document.querySelector(`[data-results="${key}"]`).innerHTML = hits.map((n) => `<button class="alt" data-pick="${key}" data-value="${esc(n)}">${glyph(set, n)}${esc(n)}</button>`).join('');
  }
});

document.addEventListener('change', (event) => {
  const t = event.target;
  if (t.dataset.layer) return setLayers({ ...state.layers, [t.dataset.layer]: t.checked });
  if (t.id === 'match-line') { state.matchLine = t.checked; return redrawAll(); }
  if (t.id === 'key-grid') { state.keyGrid = t.checked; return redrawAll(); }
  if (t.id === 'size') {
    state.size = +t.value;
    if (!weightFits(state.weight, state.size)) { state.weight = heaviestFor(state.size); $('#weight').value = state.weight; }
    return redrawAll();
  }
  if (t.id === 'weight') {
    state.weight = t.value;
    if (!weightFits(state.weight, state.size)) { state.size = sizesFor(state.weight)[0]; $('#size').value = state.size; toast(`${t.value} starts at ${state.size}px, so the size changed`); }
    return redrawAll();
  }
  if (t.id === 'sf-weight') { state.sfWeight = t.value; return redrawAll(); }
  if (t.id === 'f-status') { state.status = t.value; return applyFilters(); }
  if (t.id === 'f-category') { state.category = t.value; return applyFilters(); }
  if (t.id === 'f-match') {
    state.match = t.value;
    state.missing = null;
    applyFilters();
    return drawStage();
  }
  if (t.id === 'f-flag') { state.flag = t.value; return applyFilters(); }
  if (t.id === 'f-dupes') { state.dupes = t.value; return applyFilters(); }
  if (t.id === 'f-line-stacks') { state.lineStacks = t.value; return applyFilters(); }
  if (t.id?.startsWith('r-')) return drawRecords();
  if (t.id === 'i-status' || t.id === 'i-owner') return drawIssues();
  if (t.dataset.recordStatus !== undefined) {
    const record = recordFor.get(state.selected);
    if (t.value === 'covered' && !record.coveredBy) {
      const target = prompt('Which icon covers this one?');
      if (!target) return drawStage();
      saveRecord(record.name, { status: 'covered', coveredBy: target }).then(drawStage, drawStage);
      return;
    }
    saveRecord(record.name, { status: t.value }).then(drawStage, drawStage);
    return;
  }
  if (t.dataset.recordKeywords !== undefined) {
    saveRecord(state.selected, { keywords: t.value.split(',').map((k) => k.trim()).filter(Boolean) });
    return;
  }
  if (t.dataset.recordText) {
    saveRecord(state.selected, { [t.dataset.recordText]: t.value.trim().replace(/\s+/g, ' ') || null });
    return;
  }
});

// Pointing at one of my icons overlays it on the one being matched.
document.addEventListener('mouseover', (event) => {
  const button = event.target.closest?.('[data-claim]');
  const plate = $('#plate');
  if (!state.missing || !plate || !event.target.closest?.('#stage-panel') || plate.dataset.showing === (button?.dataset.claim ?? '')) return;
  plate.dataset.showing = button?.dataset.claim ?? '';
  const set = setById(state.missing.set);
  plate.classList.toggle('solo-color', !button);
  plate.innerHTML = missingPlate(set, state.missing.name, button ? byName.get(button.dataset.claim) : null);
  plate.querySelectorAll('svg').forEach((svg) => { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.cssText = 'width:100%;height:100%;display:block'; });
});

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '') && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'range';
  if (event.key === '/' && !typing) { event.preventDefault(); return $('#q').focus(); }
  if (typing || state.view !== 'compare') return;
  if (event.key.toLowerCase() === 'a' && !event.metaKey && !event.ctrlKey && !event.altKey && state.selected) return approveByKey(state.selected);
  if (event.key === 'g' && !event.metaKey && !event.ctrlKey && state.selected) return toggleRowGrid(state.selected);
  if (state.match.startsWith('missing:') || state.missing) {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const on = document.querySelector('#rows .row.on');
      const next = on ? (event.key === 'ArrowDown' ? on.nextElementSibling : on.previousElementSibling) : document.querySelector('#rows .row');
      if (next?.dataset.missing) selectMissing(next, true);
      else if (next) select(next.dataset.name, true, 'replace');
    }
    return;
  }
  if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
    event.preventDefault();
    const by = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const at = shown.findIndex((i) => i.name === state.selected);
    const next = shown[Math.min(shown.length - 1, Math.max(0, at + by))];
    if (next) select(next.name, true, 'replace');
  }
  const solo = event.key === '0' ? 'All' : event.key === '1' ? 'Mine' : sets[Number(event.key) - 2]?.title;
  if (solo) setLayers(presets().find(([label]) => label === solo)[1]);
});

async function load() {
  data = await (await fetch('/api/data')).json();
  byName = new Map(data.icons.map((i) => [i.name, i]));
  recordFor = new Map(data.records.map((r) => [r.name, r]));
  sets = data.sets;
  for (const set of sets) {
    state.layers[set.id] ??= !set.off; // Sets marked off start hidden, so the overlay isn't a pile of ten.
    state.opacity[set.id] ??= 0.75;
    state.scale[set.id] ??= 100;
  }
  fillControls();
  updateIssueCount();
  applyFilters();
  if (!byName.has(state.selected)) state.selected = shown[0]?.name ?? null;
  drawStage();
}

// Agents and the command line change records too, so pick those changes up, unless you're typing.
async function checkForChanges() {
  // The server may be restarting. The next check will catch up.
  const now = await fetch('/api/stamp').then((response) => response.text()).catch(() => null);
  if (!now) return;
  if (seenStamp && now !== seenStamp && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) {
    seenStamp = now;
    const top = $('#list').scrollTop;
    await load();
    $('#list').scrollTop = top;
    if (state.view === 'records') drawRecords();
    if (state.view === 'issues') drawIssues();
  } else if (!seenStamp) seenStamp = now;
}
setInterval(checkForChanges, 4000);

window.addEventListener('popstate', () => {
  setView(viewFromUrl() ?? 'compare', { push: false });
  const name = iconFromUrl();
  if (name && byName.has(name)) select(name, true, null);
  if (location.pathname.startsWith('/issues')) { state.issue = issueFromUrl(); drawIssues(); }
});

// The address decides the tab. A bare / opens the last one used.
state.view = viewFromUrl() ?? state.view;
if (iconFromUrl()) state.selected = iconFromUrl();
state.issue = issueFromUrl();
await load();
checkForChanges();
history.replaceState(null, '', pathFor(state.view));
setView(state.view, { push: false });
if (state.selected) document.querySelector(`#rows .row[data-name="${CSS.escape(state.selected)}"]`)?.scrollIntoView({ block: 'center' });

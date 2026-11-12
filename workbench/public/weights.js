// Weights: try the proposed weights side by side before changing the set's. Each row is one weight. Each
// column is one size, with Polymath text at that size beside the icons, so an icon weight can be matched to
// the text weight it sits with. The pixel strip shows how a line lands on 1x, 2x and 3x screens: widths that
// come out as whole screen pixels are sharp, the rest are soft at the edges.

import { bodyFor, hasWeights, wrapSvg } from '/lib/icon.mjs';

const KEY = 'wb-weights';
const DEFAULTS = {
  names: 'search, settings, bell, folder, calendar, trash, heart, microphone-off',
  weights: ['Thin', 'Regular', 'Semibold', 'Bold', 'Black'],
  limits: 'semibold 18, bold 32, black 40',
  sizes: '16, 20, 24, 32',
  text: 'Settings',
  textWeight: 400,
  font: 'Polymath Text',
  allFonts: false,
  pixels: true,
  grow: 'full',
  lucide: true,
};
// Fonts to try. Any other installed font can be typed in.
const FONTS = [
  { label: 'Polymath Text', family: "'Polymath Text'" },
  { label: 'Polymath Display', family: "'Polymath Display'" },
  { label: 'SF Pro (system)', family: 'system-ui' },
  { label: 'Helvetica Neue', family: "'Helvetica Neue'" },
  { label: 'Avenir Next', family: "'Avenir Next'" },
  { label: 'Inter', family: "'Inter'" },
  { label: 'Georgia', family: "'Georgia'" },
  { label: 'SF Mono', family: "'SF Mono', ui-monospace" },
];
// A font name as typed, as a CSS family: known labels map to their stack, anything else is quoted.
const familyOf = (name) => FONTS.find((f) => f.label.toLowerCase() === name.trim().toLowerCase())?.family ?? `'${name.trim().replace(/[^\w .-]/g, '')}'`;
const state = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
// The proposed scale, tried here before it changes the set: today's regular becomes thin, and today's medium
// becomes regular at 1.25. Widths saved with the old default move to the new one.
if (state.grow === true) state.grow = 'full';
if (state.grow === false) state.grow = 'off';
// The proposed scale, each weight's line at 16px. The page shows a row for each weight switched on.
const SCALE = [['Thin', 1], ['Regular', 1.33], ['Semibold', 1.5], ['Bold', 2], ['Black', 2.5]];
const PROPOSED = Object.fromEntries(SCALE.map(([name, width]) => [width, name]));
if (!Array.isArray(state.weights)) state.weights = [...DEFAULTS.weights];
// How a line grows with the icon. Full: in proportion, like text and Lucide, so gaps stay the same share of the
// icon and a weight that clogs at 16 clogs at every size. Gentle: by the square root of the scale, so lines
// get heavier but gaps open up, and size limits do their job. Off: the same line at every size, as the set is today.
const GROWTH = { full: (k) => k, gentle: (k) => Math.sqrt(k), off: () => 1 };
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const list = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);
const numbers = (text) => list(text).map(Number).filter((n) => n > 0);

// An icon at a size, with every live stroke set to the width. Filled parts stay as drawn.
function svgAt(icon, size, width) {
  const body = bodyFor(icon, size).replace(/<(\w+)((?:\s[^>]*?)?)\s*\/>/g, (element, tag, attrs) => {
    if (!/stroke="currentColor"/.test(attrs)) return element;
    return `<${tag}${attrs.replace(/\sstroke-width="[^"]*"/, '')} stroke-width="${width}"/>`;
  });
  return wrapSvg(body, size);
}

// How thick a font's vertical strokes are, as a share of the font size, measured from a lowercase l, at each
// weight. A font without that weight is drawn at its nearest one, and measures that way.
const TEXT_WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold']];
const weightName = (w) => TEXT_WEIGHTS.find(([n]) => n === w)?.[1] ?? String(w);
const stems = new Map();
async function measureStems(family) {
  if (stems.has(family)) return stems.get(family);
  const result = {};
  for (const [weight] of TEXT_WEIGHTS) {
    await document.fonts.load(`${weight} 300px ${family}`).catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 400;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.font = `${weight} 300px ${family}`;
    ctx.fillText('l', 100, 300);
    const row = ctx.getImageData(0, 200, 400, 1).data;
    let first = -1, last = -1;
    for (let x = 0; x < 400; x++) if (row[x * 4 + 3] > 127) { if (first < 0) first = x; last = x; }
    result[weight] = first < 0 ? null : (last - first + 1) / 300;
  }
  // Not installed: the text comes out the same width as the browser's fallback fonts.
  const ctx = document.createElement('canvas').getContext('2d');
  const width = (stack) => { ctx.font = `400 72px ${stack}`; return ctx.measureText('mmmmmmlllliiiwwWQ0').width; };
  result.installed = family === 'system-ui' || ['monospace', 'serif', 'sans-serif'].some((fallback) => width(`${family}, ${fallback}`) !== width(fallback));
  stems.set(family, result);
  return result;
}

// One line of the icon drawn at a screen density, then blown up so each screen pixel is a square.
function pixelStrip(icon, width, size) {
  return [1, 2, 3].map((density) => {
    const pixels = width * density;
    const sharp = Math.abs(pixels - Math.round(pixels)) < 0.02;
    return `<figure class="wt-px">
      <canvas data-icon="${esc(icon.name)}" data-size="${size}" data-width="${width}" data-density="${density}"></canvas>
      <figcaption>${density}x · ${+pixels.toFixed(2)} px <b class="${sharp ? 'sharp' : 'soft'}">${sharp ? 'sharp' : 'soft'}</b></figcaption>
    </figure>`;
  }).join('');
}

async function paintPixels(root, icons) {
  for (const canvas of root.querySelectorAll('.wt-px canvas')) {
    const icon = icons.get(canvas.dataset.icon);
    const size = +canvas.dataset.size, width = +canvas.dataset.width, density = +canvas.dataset.density;
    const svg = svgAt(icon, size, width).replace('<svg ', '<svg color="#000" ');
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode().catch(() => {});
    const real = size * density;
    const small = Object.assign(document.createElement('canvas'), { width: real, height: real });
    small.getContext('2d').drawImage(image, 0, 0, real, real);
    // Shown at a fixed 96px, so each screen pixel becomes a visible square.
    const show = 96 * (window.devicePixelRatio || 1);
    canvas.width = show; canvas.height = show;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, show, show);
    ctx.drawImage(small, 0, 0, show, show);
  }
}

export async function drawWeights(root, data) {
  const icons = new Map(data.icons.map((icon) => [icon.name, icon]));

  root.innerHTML = `
    <div class="filters wt-controls">
      <div class="field wt-wide"><span id="wt-names-label">Icons</span>
        <div class="wt-chips" id="wt-chips">
          <span class="wt-chip-list"></span>
          <input id="wt-names" type="text" role="combobox" aria-labelledby="wt-names-label" aria-autocomplete="list" aria-expanded="false" aria-controls="wt-suggest" placeholder="Add an icon" autocomplete="off" spellcheck="false">
          <ul class="wt-suggest" id="wt-suggest" role="listbox" hidden></ul>
        </div>
      </div>
      <div class="field wt-weights" role="group" aria-label="Weights to show">Weights ${SCALE.map(([name, width]) => `<button type="button" data-weight="${name}" aria-pressed="${state.weights.includes(name)}">${name} <span>${width}</span></button>`).join('')}</div>
      <label class="field" title="Icon size and text size, as icon/text: 16/14 is a 16px icon with 14px text. A plain 16 pairs it with 16px text.">Sizes <input id="wt-sizes" type="text" value="${esc(state.sizes)}" placeholder="16/14, 20/16" spellcheck="false"></label>
      <label class="field">Text <input id="wt-text" type="text" value="${esc(state.text)}" spellcheck="false"></label>
      <label class="field">Text weight <select id="wt-text-weight">${TEXT_WEIGHTS.map(([w, name]) => `<option value="${w}"${w === state.textWeight ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
      <label class="field">Font <input id="wt-font" type="text" list="wt-fonts" value="${esc(state.font)}" placeholder="Any installed font" spellcheck="false" ${state.allFonts ? 'disabled' : ''}></label>
      <datalist id="wt-fonts">${FONTS.map((f) => `<option value="${esc(f.label)}"></option>`).join('')}</datalist>
      <label class="field"><input id="wt-all-fonts" type="checkbox" ${state.allFonts ? 'checked' : ''}> Show all fonts</label>
      <label class="field" title="Lucide's matching icon beside each of yours, at the same size, with its own line: 2px on a 24px grid, so 1.33px at 16"><input id="wt-lucide" type="checkbox" ${state.lucide ? 'checked' : ''}> Lucide</label>
      <label class="field" title="Full: the line grows with the icon, like text. Gentle: it grows more slowly, so gaps open up at larger sizes. Off: the same line at every size, as the set is today.">Grow <select id="wt-grow">${[['full', 'Full'], ['gentle', 'Gentle'], ['off', 'Off']].map(([v, l]) => `<option value="${v}"${state.grow === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" title="The smallest size each weight comes in. Smaller sizes are shown faded as not offered.">Limits <input id="wt-limits" type="text" value="${esc(state.limits)}" spellcheck="false"></label>
      <label class="field"><input id="wt-pixels" type="checkbox" ${state.pixels ? 'checked' : ''}> Pixels</label>
      <button class="btn" id="wt-reset" type="button">Reset</button>
    </div>
    <div class="wt-body"></div>`;

  const body = root.querySelector('.wt-body');
  const update = (key, value) => { state[key] = value; save(); drawBody(body, icons); };
  const onChange = (id, key, read = (el) => el.value) => root.querySelector(id).addEventListener('change', (event) => update(key, read(event.target)));
  root.querySelector('.wt-weights').addEventListener('click', (event) => {
    const button = event.target.closest('[data-weight]');
    if (!button) return;
    const on = !state.weights.includes(button.dataset.weight);
    button.setAttribute('aria-pressed', String(on));
    update('weights', SCALE.map(([name]) => name).filter((name) => (name === button.dataset.weight ? on : state.weights.includes(name))));
  });
  onChange('#wt-sizes', 'sizes');
  onChange('#wt-text', 'text');
  onChange('#wt-text-weight', 'textWeight', (el) => Number(el.value));
  onChange('#wt-font', 'font', (el) => el.value.trim() || DEFAULTS.font);
  root.querySelector('#wt-all-fonts').addEventListener('change', (event) => {
    root.querySelector('#wt-font').disabled = event.target.checked;
    update('allFonts', event.target.checked);
  });
  onChange('#wt-pixels', 'pixels', (el) => el.checked);
  onChange('#wt-grow', 'grow');
  onChange('#wt-limits', 'limits');
  onChange('#wt-lucide', 'lucide', (el) => el.checked);
  root.querySelector('#wt-reset').addEventListener('click', () => { Object.assign(state, DEFAULTS); save(); drawWeights(root, data); });
  chipInput(root.querySelector('#wt-chips'), icons, () => drawBody(body, icons));
  drawBody(body, icons);
}

// The icons to compare, as chips. Typing suggests icons by name, then by alias, with a preview of each.
// Enter, Tab or a comma adds the highlighted one; Backspace in an empty box removes the last chip.
function chipInput(box, icons, changed) {
  const input = box.querySelector('input');
  const listEl = box.querySelector('.wt-chip-list');
  const menu = box.querySelector('.wt-suggest');
  let options = [], active = 0;
  const names = () => list(state.names);
  const setNames = (next) => { state.names = [...new Set(next)].join(', '); save(); drawChips(); changed(); };

  function drawChips() {
    listEl.innerHTML = names().map((name) => {
      const icon = icons.get(name);
      return `<span class="wt-chip${icon ? '' : ' missing'}" title="${icon ? esc(name) : `${esc(name)} isn't in the set`}">${icon ? svgAt(icon, 16, 1) : ''}<span>${esc(name)}</span><button type="button" data-remove="${esc(name)}" aria-label="Remove ${esc(name)}">×</button></span>`;
    }).join('');
  }

  function suggest() {
    const q = input.value.trim().toLowerCase().replace(/,$/, '');
    const taken = new Set(names());
    if (!q) { close(); return; }
    const all = [...icons.values()].filter((icon) => !taken.has(icon.name));
    const starts = all.filter((icon) => icon.name.startsWith(q));
    const contains = all.filter((icon) => !icon.name.startsWith(q) && icon.name.includes(q));
    const alias = all.filter((icon) => !icon.name.includes(q) && (icon.aliases ?? []).some((a) => a.toLowerCase().includes(q)));
    options = [...starts, ...contains, ...alias].slice(0, 8);
    active = 0;
    if (!options.length) { menu.innerHTML = '<li class="none">No icon matches</li>'; open(); return; }
    menu.innerHTML = options.map((icon, i) => `<li role="option" id="wt-opt-${i}" data-pick="${esc(icon.name)}" aria-selected="${i === active}">${svgAt(icon, 16, 1)}<span>${esc(icon.name)}</span>${icon.name.includes(q) ? '' : `<small>${esc((icon.aliases ?? []).find((a) => a.toLowerCase().includes(q)) ?? '')}</small>`}</li>`).join('');
    open();
  }
  const open = () => { menu.hidden = false; input.setAttribute('aria-expanded', 'true'); highlight(); };
  const close = () => { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); options = []; };
  function highlight() {
    menu.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (options.length) { input.setAttribute('aria-activedescendant', `wt-opt-${active}`); menu.querySelector(`#wt-opt-${active}`)?.scrollIntoView({ block: 'nearest' }); }
  }
  function add(name) {
    if (!name) return;
    setNames([...names(), name]);
    input.value = '';
    close();
    input.focus();
  }

  input.addEventListener('input', () => {
    // Pasting a list adds every name in it.
    if (input.value.includes(',') && input.value.split(',').filter((n) => n.trim()).length > 1) {
      const pasted = list(input.value).map((n) => n.toLowerCase());
      input.value = '';
      setNames([...names(), ...pasted]);
      close();
      return;
    }
    suggest();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && options.length) { event.preventDefault(); active = (active + 1) % options.length; highlight(); }
    else if (event.key === 'ArrowUp' && options.length) { event.preventDefault(); active = (active - 1 + options.length) % options.length; highlight(); }
    else if ((event.key === 'Enter' || event.key === 'Tab' || event.key === ',') && options.length) { event.preventDefault(); add(options[active].name); }
    else if (event.key === 'Enter' && input.value.trim()) { event.preventDefault(); add(input.value.trim().toLowerCase()); }
    else if (event.key === 'Escape') { input.value = ''; close(); }
    else if (event.key === 'Backspace' && !input.value && names().length) setNames(names().slice(0, -1));
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  menu.addEventListener('mousedown', (event) => {
    const li = event.target.closest('[data-pick]');
    if (!li) return;
    event.preventDefault(); // keep the focus in the box
    add(li.dataset.pick);
  });
  listEl.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) { setNames(names().filter((n) => n !== remove.dataset.remove)); input.focus(); }
  });
  // Clicking anywhere in the box puts the cursor in it.
  box.addEventListener('mousedown', (event) => { if (event.target === box || event.target === listEl) { event.preventDefault(); input.focus(); } });
  drawChips();
}

// Lucide's matching icon, from the workbench's own copy. Its line is 2 on a 24 grid, so it scales with the size.
const lucideSvgs = new Map();
async function lucideSvg(name) {
  if (!lucideSvgs.has(name)) lucideSvgs.set(name, fetch(`/set/lucide/${encodeURIComponent(name)}.svg`).then((r) => (r.ok ? r.text() : null)).catch(() => null));
  return lucideSvgs.get(name);
}
const lucideAt = (svg, size) => svg.replace(/<!--[\s\S]*?-->/g, '').replace(/\swidth="[^"]*"/, ` width="${size}"`).replace(/\sheight="[^"]*"/, ` height="${size}"`).replace(/\sclass="[^"]*"/, '');

async function drawBody(body, icons) {
  const wanted = state.allFonts ? FONTS : [{ label: state.font, family: familyOf(state.font) }];
  for (const font of wanted) font.stems = await measureStems(font.family);
  const notInstalled = wanted.filter((font) => !font.stems.installed).map((font) => font.label);
  const fonts = state.allFonts ? wanted.filter((font) => font.stems.installed) : wanted;
  // Each icon's Lucide match, if it has one.
  const lucide = new Map();
  if (state.lucide) for (const name of list(state.names)) {
    const match = icons.get(name)?.matches?.lucide?.current;
    const svg = match ? await lucideSvg(match) : null;
    if (svg) lucide.set(name, { name: match, svg });
  }
  const names = list(state.names);
  const picked = names.map((name) => icons.get(name)).filter(Boolean);
  const missing = names.filter((name) => !icons.has(name));
  const widths = SCALE.filter(([name]) => state.weights.includes(name)).map(([, width]) => width);
  // Each size is an icon size and a text size, written icon/text. A plain number pairs the icon with text of the same size.
  const pairs = list(state.sizes).map((entry) => {
    const [icon, text] = entry.split('/').map((n) => Number(n.trim()));
    return { size: icon, text: text > 0 ? text : icon };
  }).filter((pair) => pair.size > 0);
  const sizes = pairs.map((pair) => pair.size);
  const lucideTile = (icon, size, text) => {
    if (!state.lucide) return '';
    const match = lucide.get(icon.name);
    const font = fonts[0];
    if (!match) return `<div class="wt-tile lucide none"><small>Lucide</small><div class="wt-line">No match</div><small class="wt-font">&nbsp;</small></div>`;
    const line = +(2 * size / 24).toFixed(2);
    return `<div class="wt-tile lucide"><small>Lucide · ${line}px line</small><div class="wt-line" title="${esc(`Lucide ${match.name} at ${size}px: its line is ${line}px`)}"><div class="wt-text" style="font-size:${text}px; font-family:${esc(font.family)}; font-weight:${state.textWeight}">${lucideAt(match.svg, size)}<span>${esc(state.text)}</span></div></div><small class="wt-font">Lucide ${esc(match.name)}</small></div>`;
  };
  // A row's width at a size. Growing, it's set at 16 and scales with the size, like text stems.
  const at = (width, size) => +(width * (GROWTH[state.grow] ?? GROWTH.full)(size / 16)).toFixed(2);
  // The smallest size a weight is offered at, from "semibold 18, bold 32".
  const limits = Object.fromEntries(list(state.limits).map((entry) => { const [name, n] = entry.trim().split(/\s+/); return [name?.toLowerCase(), Number(n)]; }).filter(([, n]) => n > 0));
  const offered = (width, size) => size >= (limits[PROPOSED[width]?.toLowerCase()] ?? 0);
  const px = (share, size) => (share ? `${+(share * size).toFixed(2)}` : '?');
  const w = state.textWeight;
  const stemNote = (text) => (fonts.length === 1 ? `${fonts[0].label} ${weightName(w)} stems at ${text}px: ${px(fonts[0].stems[w], text)}px` : `${weightName(w)} stems above each tile, font below`);
  const fixed = picked.filter((icon) => !hasWeights(icon)).map((icon) => icon.name);

  body.innerHTML = `
      <p class="hint">Each row is one weight, set at 16px${state.grow === 'full' ? ' and growing in proportion with the icon' : state.grow === 'gentle' ? ' and growing more slowly than the icon, so gaps open up' : ' and the same at every size'} (each cell shows its line). Proposed scale: thin 1, regular 1.33, semibold 1.5, bold 2 and black 2.5 (today's regular is 1 and medium 1.33; the set hasn't changed yet). Faded cells are sizes a weight isn't offered in. Match a width to the text beside it: an icon line about as thick as the text's stems (shown in px) reads as the same weight.${missing.length ? ` Not found: ${esc(missing.join(', '))}.` : ''}${fixed.length ? ` ${esc(fixed.join(', '))} ${fixed.length === 1 ? 'has' : 'have'} filled parts, which stay as drawn.` : ''}${notInstalled.length ? ` Not installed on this computer${state.allFonts ? ', so left out' : ', so the browser is showing a fallback'}: ${esc(notInstalled.join(', '))}.` : ''}</p>
      <div class="wt-table" style="--cols:${sizes.length}">
        <div class="wt-head"><span>Weight</span>${pairs.map(({ size, text }) => `<span><b>${size}px icon${text === size ? '' : ` · ${text}px text`}</b><small>${esc(stemNote(text))}</small></span>`).join('')}</div>
        ${widths.map((width) => `
          <section class="wt-row">
            <div class="wt-label">${PROPOSED[width] ? `<span class="wt-name">${PROPOSED[width]}</span>` : ''}<b>${width}px</b>${state.grow !== 'off' ? '<small>at 16px</small>' : ''}${state.pixels ? `<div class="wt-pxs">${picked[0] ? pixelStrip(picked[0], at(width, sizes[0] ?? 16), sizes[0] ?? 16) : ''}</div>` : ''}</div>
            ${pairs.map(({ size, text }) => `
              <div class="wt-cell${offered(width, size) ? '' : ' not-offered'}">
                <span class="wt-at">${at(width, size)}px${offered(width, size) ? '' : ' · not offered'}</span>
                ${picked.map((icon) => `<div class="wt-pair">${fonts.map((font) => `<div class="wt-tile"><small>${weightName(w)} · ${px(font.stems[w], text)}px</small><div class="wt-line" title="${esc(`${icon.name} at ${at(width, size)}px, with ${text}px ${font.label} ${weightName(w)}, whose stems are ${px(font.stems[w], text)}px`)}"><div class="wt-text" style="font-size:${text}px; font-family:${esc(font.family)}; font-weight:${w}">${svgAt(icon, size, at(width, size))}<span>${esc(state.text)}</span></div></div><small class="wt-font">${esc(font.label)}</small></div>`).join('')}${lucideTile(icon, size, text)}</div>`).join('')}
              </div>`).join('')}
          </section>`).join('')}
      </div>`;
  if (state.pixels) paintPixels(body, icons);
}

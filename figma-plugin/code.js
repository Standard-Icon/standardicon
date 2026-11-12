// Keeps icon borders in step with the workbench while it's open. Every few seconds it asks the workbench
// (npm run workbench) what's changed and paints the component sets:
//   approved           solid 4px #ff4fd8, which is what the sync ships
//   needs revision     dashed 4px #ffb000
//   new                solid 4px #4f4fff, when an approval or a revision mark is taken back
// An approval for an icon redrawn since isn't listed, so that icon is left alone. Blue only replaces the
// border that was taken back, so a border changed by hand in the meantime stays.
//
// It works the other way too. Change an icon's border by hand and the plugin tells the workbench: pink
// approves it, dashed orange marks it for revision, and blue takes both back. Any other look (halfway through
// a change, say) is ignored. After a hand change the plugin leaves that icon's border alone for a minute, so
// it never repaints a border while you're still changing it.

const WORKBENCH = 'http://localhost:4180/api/borders';
const REPORT = 'http://localhost:4180/api/plugin/border';
const HANDS_OFF = 60000;
const EVERY = 3000;
const PINK = { color: { r: 1, g: 0x4f / 255, b: 0xd8 / 255 }, dash: [] };
const ORANGE = { color: { r: 1, g: 0xb0 / 255, b: 0 }, dash: [10, 5] };
const BLUE = { color: { r: 0x4f / 255, g: 0x4f / 255, b: 1 }, dash: [] };
const TAKEN_FROM = { pink: PINK, revision: ORANGE };

const same = (set, look) => {
  const stroke = set.strokes[0];
  const dash = set.dashPattern ?? [];
  return set.strokes.length === 1 && stroke.type === 'SOLID' && set.strokeWeight === 4
    && ['r', 'g', 'b'].every((k) => Math.round(stroke.color[k] * 255) === Math.round(look.color[k] * 255))
    && dash.length === look.dash.length && dash.every((v, i) => v === look.dash[i]);
};

// Sets this plugin just painted, so their change events aren't mistaken for yours, and sets you just changed,
// which it leaves alone for a while.
const ours = new Map();
const touched = new Map();
const paint = (set, look) => {
  ours.set(set.id, Date.now());
  reported.delete(set.id);
  set.strokes = [{ type: 'SOLID', color: look.color }];
  set.strokeWeight = 4;
  set.strokeAlign = 'OUTSIDE';
  set.dashPattern = look.dash;
};

const recent = [];
const status = (text, ok = true) => figma.ui.postMessage({ type: 'borders', text, ok, recent: recent.slice(0, 4) });

// The icons in the selection, for "Sync selected": a selected icon, any part of one, or every icon inside a
// selected frame. Only sets inside a "<category> icons" frame count, since those are the ones the sync reads.
const inCategory = (node) => {
  for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) if (/ icons$/.test(p.name)) return true;
  return false;
};
function selectedIcons() {
  const names = new Set();
  let outside = 0;
  for (const node of figma.currentPage.selection) {
    let set = node;
    while (set && set.type !== 'COMPONENT_SET' && set.type !== 'PAGE') set = set.parent;
    const sets = set && set.type === 'COMPONENT_SET' ? [set] : 'findAll' in node ? node.findAll((n) => n.type === 'COMPONENT_SET') : [];
    for (const s of sets) inCategory(s) ? names.add(s.name) : outside++;
  }
  return { names: [...names], outside };
}
const sendSelection = () => figma.ui.postMessage({ type: 'selection', ...selectedIcons() });
figma.on('selectionchange', sendSelection);

async function apply(list, look, label) {
  for (const { name, figmaId, from } of list) {
    // One icon that can't be read or painted is skipped, so it can't stop the rest.
    let set;
    try { set = await figma.getNodeByIdAsync(figmaId); } catch { continue; }
    if (!set || set.removed || set.type !== 'COMPONENT_SET' || same(set, look)) continue;
    if (Date.now() - (touched.get(figmaId) ?? 0) < HANDS_OFF) continue;
    if (from && !(TAKEN_FROM[from] && same(set, TAKEN_FROM[from]))) continue;
    try { paint(set, look); } catch (error) { skipped.set(name, String(error.message ?? error)); continue; }
    recent.unshift(`${name} → ${label}`);
    figma.notify(`${name}: ${label}`, { timeout: 1500 });
  }
}
// Icons whose border couldn't be painted, and why, shown in the panel.
const skipped = new Map();

// A border you changed: which of the three it is now, if any.
const lookOf = (set) => (same(set, PINK) ? 'pink' : same(set, ORANGE) ? 'revision' : same(set, BLUE) ? 'blue' : null);
const LABELS = { pink: 'approved', revision: 'needs revision', blue: 'new' };
const waiting = new Map();
const reported = new Map();
async function report(set) {
  const border = lookOf(set);
  if (!border || reported.get(set.id) === border) return;
  reported.set(set.id, border);
  try {
    const response = await fetch(REPORT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench-Plugin': '1' }, body: JSON.stringify({ name: set.name, figmaId: set.id, border }) });
    if (!response.ok) throw new Error(await response.text());
    recent.unshift(`${set.name} → ${LABELS[border]} (by hand)`);
    figma.notify(`${set.name}: ${LABELS[border]} in the workbench too`, { timeout: 1500 });
  } catch (error) {
    reported.delete(set.id);
    figma.notify(`${set.name}: couldn't tell the workbench (${String(error.message ?? error).slice(0, 80)})`, { timeout: 4000, error: true });
  }
}
function watchPage(page) {
  page.on('nodechange', (event) => {
    for (const change of event.nodeChanges) {
      if (change.type !== 'PROPERTY_CHANGE') continue;
      const set = change.node;
      if (!set || set.removed || set.type !== 'COMPONENT_SET' || !inCategory(set)) continue;
      if (!change.properties.some((p) => p === 'strokes' || p === 'dashPattern' || p === 'strokeWeight')) continue;
      if (Date.now() - (ours.get(set.id) ?? 0) < 2000) continue;
      touched.set(set.id, Date.now());
      // One report per change, once you've stopped: a color and a dash change arrive as separate events.
      clearTimeout(waiting.get(set.id));
      waiting.set(set.id, setTimeout(() => { waiting.delete(set.id); if (!set.removed) report(set); }, 800));
    }
  });
}
const watched = new Set();
const watchCurrent = () => { if (!watched.has(figma.currentPage.id)) { watched.add(figma.currentPage.id); watchPage(figma.currentPage); } };
figma.on('currentpagechange', watchCurrent);
watchCurrent();

async function tick() {
  // "Can't reach" only when the workbench doesn't answer. Anything else says what went wrong.
  let borders;
  try {
    const response = await fetch(WORKBENCH);
    if (!response.ok) throw new Error(`the workbench answered ${response.status}: ${(await response.text()).slice(0, 120)}`);
    borders = await response.json();
  } catch (error) {
    const unreachable = /fetch|network|load failed|connect/i.test(String(error.message ?? error));
    status(unreachable ? "Can't reach the workbench. Start it with npm run workbench." : `Couldn't read the borders: ${String(error.message ?? error).slice(0, 160)}`, false);
    return setTimeout(tick, EVERY);
  }
  try {
    const { pink, revision, blue = [] } = borders;
    await apply(pink, PINK, 'approved');
    await apply(revision, ORANGE, 'needs revision');
    await apply(blue, BLUE, 'new');
    const problems = skipped.size ? ` · couldn't paint ${[...skipped.keys()].slice(0, 3).join(', ')}: ${[...skipped.values()][0].slice(0, 80)}` : '';
    status(`Watching the workbench · ${pink.length} approved, ${revision.length} to revise${problems}`, !skipped.size);
  } catch (error) {
    status(`Painting borders failed: ${String(error.message ?? error).slice(0, 160)}`, false);
  }
  setTimeout(tick, EVERY);
}

// Every icon size gets the pixel grid and the 12px drawing area as layout grids, which never export.
// Shift+G shows or hides them. New icons pick them up the next time this plugin opens.
const gridsFor = (size) => {
  const inset = (2 * size) / 16, area = (12 * size) / 16, pink = { r: 1, g: 0.31, b: 0.85, a: 0.08 };
  return [
    { pattern: 'GRID', sectionSize: 1, visible: true, color: { r: 0, g: 0, b: 0, a: 0.08 } },
    { pattern: 'COLUMNS', alignment: 'MIN', count: 1, offset: inset, sectionSize: area, gutterSize: 0, visible: true, color: pink },
    { pattern: 'ROWS', alignment: 'MIN', count: 1, offset: inset, sectionSize: area, gutterSize: 0, visible: true, color: pink },
  ];
};
function addMissingGrids() {
  let added = 0;
  for (const set of figma.currentPage.findAllWithCriteria({ types: ['COMPONENT_SET'] })) {
    for (const variant of set.children) {
      const size = Number((variant.name.match(/Size=(\d+)/) || [])[1]);
      if (size && !(variant.layoutGrids && variant.layoutGrids.length)) { variant.layoutGrids = gridsFor(size); added++; }
    }
  }
  if (added) figma.notify(`Added the pixel grid to ${added} icon size${added === 1 ? '' : 's'}`);
}

// The Icon grid component: every icon master holds a locked instance of it named icon-grid, as its bottom
// layer. New masters get one when the plugin opens, and the panel can show or hide them all. The sync ignores it.
const GRID = 'icon-grid';
const outsideIcons = (node) => { for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) if (p.name === 'overlay badges' || p.name === 'icon grid') return true; return false; };
const masters = () => figma.currentPage.findAllWithCriteria({ types: ['COMPONENT_SET'] })
  .filter((set) => !outsideIcons(set))
  .map((set) => set.children.find((v) => v.name === 'Size=16'))
  .filter(Boolean);
function addMissingIconGrids() {
  const component = figma.currentPage.findOne((n) => n.type === 'COMPONENT' && n.name === 'Icon grid');
  if (!component) return;
  const visible = gridsVisible();
  let added = 0;
  for (const master of masters()) {
    if (master.children.some((c) => c.name === GRID)) continue;
    const grid = component.createInstance();
    master.insertChild(0, grid);
    grid.name = GRID;
    grid.x = 0;
    grid.y = 0;
    grid.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
    grid.locked = true;
    grid.visible = visible;
    added++;
  }
  if (added) figma.notify(`Added the icon grid to ${added} icon${added === 1 ? '' : 's'}`);
}
const gridLayers = () => masters().map((m) => m.children.find((c) => c.name === GRID)).filter(Boolean);
function gridsVisible() {
  const first = gridLayers()[0];
  return first ? first.visible : true;
}
function setGridsVisible(on) {
  let n = 0;
  for (const grid of gridLayers()) if (grid.visible !== on) { grid.visible = on; n++; }
  figma.notify(`${on ? 'Showing' : 'Hiding'} the icon grid${n ? ` on ${n} icons` : ''}`);
  figma.ui.postMessage({ type: 'grid', visible: on });
}

figma.showUI(__html__, { width: 320, height: 440, title: "Workbench" });
figma.ui.onmessage = (message) => {
  if (message?.type === 'ready') { sendSelection(); figma.ui.postMessage({ type: 'grid', visible: gridsVisible() }); }
  if (message?.type === 'grid') setGridsVisible(Boolean(message.visible));
  if (message?.type === 'notify') figma.notify(message.text, { timeout: 4000, error: Boolean(message.error) });
};
addMissingGrids();
addMissingIconGrids();
tick();

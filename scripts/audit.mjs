// Checks each Figma set's construction, from the file data a sync already reads. The spec is icons/AUDIT.md,
// and the check ids here match it. Results go to .sync/audit.json and never into records.
//
// For now it only reports, so an unproven check can't hold an icon back from a release. Not automated yet:
// K4 (needs closed paths told apart from open ones), B5's path comparison, B6, L1, L2, E2, E3.
import { SOLID_FAMILIES } from './solid-parts.mjs';

// Each set is one Size=16 master. Other sizes are scaled from it when the site is built.
const VARIANTS = [16];
// The three borders: pink approved, blue new, dashed orange needs revision. true means the border must be dashed.
const STAGES = { '#ff4fd8': false, '#4f4fff': false, '#ffb000': true };
const LEAVES = new Set(['VECTOR', 'RECTANGLE', 'ELLIPSE', 'STAR', 'POLYGON', 'LINE']);
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BADGE_GLYPH = { x: 2.25, plus: 2.25, minus: 2.25, check: 2.5, search: 2.6, lock: 2.6, key: 2.6, shield: 2.6, star: 2.6, settings: 2.6 };
const BADGE_SUFFIX = /-(plus|minus|check|x|search|lock|key|shield|star|settings|arrow-up|arrow-down|cog|zap|clock|backup|download|upload)(?:-overlay)?$/;
const CENTRE_EXEMPT = new Set(['align-object-top', 'align-object-bottom', 'align-object-left', 'align-object-right']);
const SMALL_PREFIX = /^(arrow-|chevron|corner-|grip-|skip-|move-)/;
const SMALL = new Set(['close', 'plus', 'minus', 'multiply', 'check', 'dot', 'pause', 'more-vertical', 'apps', 'widget-small', 'play', 'stop', 'person', 'guest']);

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const round = (n) => +n.toFixed(2);
const hex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
const shown = (paints) => (paints ?? []).filter((p) => p.visible !== false);
function* walkAll(node) {
  yield node;
  for (const child of node.children ?? []) yield* walkAll(child);
}
// Hidden layers don't export, so the geometry checks skip them. N6 lists the ones in masters.
function* walk(node) {
  yield node;
  for (const child of node.children ?? []) if (child.visible !== false) yield* walk(child);
}
const sizeOf = (variant) => {
  const match = variant.name.match(/Size=(\d+)/);
  return match ? +match[1] : null;
};
function unionOf(boxes) {
  const real = boxes.filter(Boolean);
  if (!real.length) return null;
  const x = Math.min(...real.map((b) => b.x)), y = Math.min(...real.map((b) => b.y));
  return { x, y, width: Math.max(...real.map((b) => b.x + b.width)) - x, height: Math.max(...real.map((b) => b.y + b.height)) - y };
}
const relative = (box, origin) => box && { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };

function auditSet(set, section, inFrame, recordFor, allNames, sets) {
  const record = recordFor.get(set.name);
  const findings = [];
  const add = (check, severity, detail) => {
    if (!record?.flags?.includes(`audit-ok:${check}`)) findings.push({ icon: set.name, check, severity, detail });
  };
  const name = set.name;

  // Structure
  if (!NAME.test(name)) add('S4', 'error', "The name isn't lowercase words joined by hyphens.");
  if (allNames.get(name) > 1) add('S4', 'error', `The name is used ${allNames.get(name)} times.`);
  if (!inFrame) add('S5', 'warn', 'Outside the category frames.');
  const stroke = shown(set.strokes).find((p) => p.type === 'SOLID');
  if (stroke) {
    const color = hex(stroke.color), dashed = Boolean(set.strokeDashes?.length);
    if (!(color in STAGES) || set.strokeWeight !== 4 || set.strokeAlign !== 'OUTSIDE' || dashed !== STAGES[color]) add('S6', 'warn', `Border ${color}, ${set.strokeWeight}px, ${set.strokeAlign}${dashed ? ', dashed' : ''} isn't a known stage.`);
  } else add('S6', 'warn', 'No border.');

  const variants = new Map((set.children ?? []).map((v) => [sizeOf(v), v]));
  const sizes = [...variants.keys()].filter(Boolean).sort((a, b) => a - b);
  if (sizes.join() !== VARIANTS.join()) add('S1', 'error', `Variants are ${sizes.join(', ')}, but only Size=16 is drawn.`);
  for (const [size, variant] of variants) {
    if (!size) continue;
    const box = variant.absoluteBoundingBox;
    if (!near(box.width, size, 0.01) || !near(box.height, size, 0.01)) add('S2', 'error', `Size=${size} is ${round(box.width)}×${round(box.height)}.`);
    if (size === 16) continue;
    const [only] = variant.children ?? [];
    const original = (variant.children ?? []).length === 1 && only.type === 'INSTANCE';
    if (!original) add('S3', 'error', `Size=${size} should be one instance of Size=16.`);
    else if (!near(only.absoluteBoundingBox.x, box.x, 0.01) || !near(only.absoluteBoundingBox.y, box.y, 0.01) || !near(only.absoluteBoundingBox.width, size, 0.01)) add('S3', 'error', `Size=${size}'s instance isn't at 0,0 and ${size}×${size}.`);
    for (const node of walk(variant)) {
      if (node !== variant && LEAVES.has(node.type) && shown(node.strokes).length && !near(node.strokeWeight ?? 1, 1, 0.001)) {
        add('K2', 'error', `Size=${size}: ${node.name} has a ${node.strokeWeight}px stroke.`);
        break;
      }
    }
  }

  const master = variants.get(16);
  if (!master) return findings;
  const origin = master.absoluteBoundingBox;
  // An overlay badge is an instance of its parent named Body, under an instance of its badge. Older ones are a Subtract.
  const body = (master.children ?? []).find((n) => n.name === 'Body' && (n.type === 'INSTANCE' || (n.type === 'BOOLEAN_OPERATION' && n.booleanOperation === 'SUBTRACT')));
  const badge = (master.children ?? []).find((n) => n.type === 'INSTANCE' && n.name === 'Overlay badge');
  const base = body?.type === 'INSTANCE' ? body : body?.children?.[0];
  const cutout = badge ? badge.children?.find((n) => n.name === 'Cutout') : body?.children?.at(-1);

  // Node types, paint, and strokes
  for (const node of walkAll(master)) if (node !== master && node.visible === false) add('N6', 'warn', `${node.name} is a hidden layer.`);
  let fillOnly = [];
  for (const node of walk(master)) {
    if (node === master) continue;
    const isLeaf = LEAVES.has(node.type);
    if (!isLeaf && !['BOOLEAN_OPERATION', 'GROUP', 'FRAME'].includes(node.type) && !(name === 'wifi-lock' && node.type === 'INSTANCE')) {
      if (node.type !== 'INSTANCE' || !(master.children ?? []).includes(node)) add('N1', 'error', `${node.name} is a ${node.type}.`);
    }
    if (node.type === 'FRAME' && name !== 'spinner') add('N1', 'error', `${node.name} is a wrapper frame.`);
    if (node.isMask) add('N1', 'error', `${node.name} is a mask.`);
    if (node.effects?.some((e) => e.visible !== false)) add('N1', 'error', `${node.name} has an effect.`);
    if ((node.opacity ?? 1) !== 1) add('N1', 'error', `${node.name} has ${node.opacity} opacity.`);
    if (node.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode)) add('N1', 'error', `${node.name} blends with ${node.blendMode}.`);
    if (node.type === 'BOOLEAN_OPERATION' && node !== body && !(node === base && node.booleanOperation === 'UNION')) add('N2', 'error', `${node.name} is a ${node.booleanOperation}.`);
    if (!isLeaf) continue;
    const insideBody = body && [...walk(body)].includes(node);
    if (node === cutout) continue;
    const strokes = shown(node.strokes), fills = shown(node.fills);
    for (const paint of [...strokes, ...fills]) {
      const black = paint.type === 'SOLID' && ['r', 'g', 'b'].every((c) => paint.color[c] <= 0.01) && (paint.opacity ?? 1) >= 0.99;
      if (paint.type === 'IMAGE') add('N1', 'error', `${node.name} has an image fill.`);
      else if (!black && name !== 'spinner') add('N3', 'error', `${node.name} has a paint that isn't solid black.`);
    }
    if ([...(node.strokes ?? []), ...(node.fills ?? [])].some((p) => p.visible === false)) add('N4', 'warn', `${node.name} has a hidden paint.`);
    const transform = node.relativeTransform;
    if (transform && (!near(transform[0][0], 1, 0.0001) || !near(transform[0][1], 0, 0.0001) || !near(transform[1][0], 0, 0.0001) || !near(transform[1][1], 1, 0.0001))) add('N5', 'error', `${node.name} is rotated or flipped.`);
    if (strokes.length) {
      if (!near(node.strokeWeight ?? 1, 1, 0.001)) add('K1', 'error', `${node.name} has a ${node.strokeWeight}px stroke.`);
      if (node.strokeAlign !== 'CENTER' && name !== 'robot') add('K3', 'error', `${node.name} has an ${node.strokeAlign} stroke.`);
    } else if (fills.length && !insideBody) fillOnly.push(node);
    else if (fills.length && insideBody && node !== cutout) fillOnly.push(node);
  }

  // Position and size
  // An instance's own box is its whole frame, so measure the shapes inside it.
  const measured = (master.children ?? []).filter((c) => c.visible !== false).flatMap((c) => (c.type === 'INSTANCE' ? [...walk(c)].filter((n) => LEAVES.has(n.type) && n !== cutout) : [c]));
  const visible = unionOf(measured.map((c) => relative(c.absoluteRenderBounds, origin)));
  if (visible) {
    const longest = Math.max(visible.width, visible.height);
    const cx = visible.x + visible.width / 2, cy = visible.y + visible.height / 2;
    if (!body && !CENTRE_EXEMPT.has(name) && (!near(cx, 8, 0.3) || !near(cy, 8, 0.3))) add('P1', 'warn', `Centre is at ${round(cx)}, ${round(cy)}.`);
    if (visible.x < -0.01 || visible.y < -0.01 || visible.x + visible.width > 16.01 || visible.y + visible.height > 16.01) add('P2', 'error', `Goes outside the frame: ${round(visible.x)}, ${round(visible.y)}, ${round(visible.width)}×${round(visible.height)}.`);
    if (name !== 'robot' && (visible.x - 0.25 < -0.01 || visible.y - 0.25 < -0.01 || visible.x + visible.width + 0.25 > 16.01 || visible.y + visible.height + 0.25 > 16.01)) add('P3', 'warn', "A 1.5px line wouldn't fit.");
    if (longest > 14.6) add('P4', 'warn', `Longest side is ${round(longest)}.`);
    else if (longest < 10.5 && !SMALL_PREFIX.test(name) && !SMALL.has(name)) add('P4', 'warn', `Longest side is ${round(longest)}.`);
  }

  // Badges
  if (body) {
    const at = (node) => relative(node.absoluteBoundingBox, origin);
    const onSpec = (node) => {
      const box = at(node);
      return near(box.width, 5.4, 0.01) && near(box.height, 5.4, 0.01) && near(box.x, 9.55, 0.01) && near(box.y, 9.55, 0.01) && near(node.cornerRadius ?? 0, 1, 0.01);
    };
    if (cutout?.name !== 'Cutout' || cutout.type !== 'RECTANGLE' || !shown(cutout.fills).length || shown(cutout.strokes).length || !onSpec(cutout)) add('B1', 'error', "The Cutout isn't Body's last child on the 5.4×5.4 spec.");
    const border = (badge?.children ?? master.children ?? []).find((n) => n.name === 'Badge border');
    if (!border || border.type !== 'RECTANGLE' || !onSpec(border) || !shown(border.strokes).length || !near(border.strokeWeight ?? 0, 1, 0.001) || border.strokeAlign !== 'CENTER' || shown(border.fills).length) add('B2', 'error', "The Badge border isn't on the spec.");
    const glyphParts = (badge?.children ?? master.children ?? []).filter((n) => n !== body && n !== border && n !== cutout);
    const glyph = unionOf(glyphParts.map(at));
    if (!glyph) add('B3', 'error', 'No glyph.');
    else {
      const cx = glyph.x + glyph.width / 2, cy = glyph.y + glyph.height / 2;
      if (!near(cx, 12.25, 0.1) || !near(cy, 12.25, 0.1)) add('B3', 'error', `Glyph centre is at ${round(cx)}, ${round(cy)}.`);
      const wanted = BADGE_GLYPH[name.match(BADGE_SUFFIX)?.[1]];
      if (wanted && !near(Math.max(glyph.width, glyph.height), wanted, 0.1)) add('B4', 'warn', `Glyph's longest side is ${round(Math.max(glyph.width, glyph.height))}, not ${wanted}.`);
    }
    // The part of B5 that doesn't need path data.
    const parentName = record?.parent ?? name.replace(BADGE_SUFFIX, '');
    const parentMaster = sets.get(parentName)?.children?.find((v) => sizeOf(v) === 16);
    if (parentMaster && base) {
      // Layer order can differ between the two, so line the shapes up by where they sit.
      const leaves = (root, from) => [...walk(root)].filter((n) => LEAVES.has(n.type)).sort((a, b) => {
        const A = relative(a.absoluteBoundingBox, from), B = relative(b.absoluteBoundingBox, from);
        return A.x + A.y - (B.x + B.y) || A.x - B.x || A.width - B.width;
      });
      const mine = leaves(base, origin), theirs = leaves(parentMaster, parentMaster.absoluteBoundingBox);
      if (mine.length !== theirs.length) add('B5', 'error', `Base has ${mine.length} shapes and ${parentName} has ${theirs.length}.`);
      else {
        const parentOrigin = parentMaster.absoluteBoundingBox;
        const off = mine.findIndex((leaf, i) => {
          const a = at(leaf), b = relative(theirs[i].absoluteBoundingBox, parentOrigin);
          return leaf.type !== theirs[i].type || !near(a.x, b.x, 0.02) || !near(a.y, b.y, 0.02) || !near(a.width, b.width, 0.02) || !near(a.height, b.height, 0.02);
        });
        if (off >= 0) add('B5', 'error', `Base doesn't overlay ${parentName}: ${mine[off].name} differs.`);
      }
    }
  } else if (BADGE_SUFFIX.test(name) && sets.has(name.replace(BADGE_SUFFIX, ''))) add('B7', 'warn', 'Has a badge suffix and a parent, but no Body. Valid for top-right and inside-the-shape patterns.');

  // Fills
  fillOnly = fillOnly.filter((node) => node.absoluteBoundingBox);
  if (fillOnly.length) {
    // Badges inherit their parent's filled parts, as the importer treats them.
    const parent = body ? recordFor.get(record?.parent ?? name.replace(BADGE_SUFFIX, '')) : null;
    const approved = record?.fillApproved || parent?.fillApproved || SOLID_FAMILIES.some((pattern) => pattern.test(name));
    const pink = stroke && hex(stroke.color) === '#ff4fd8' && !set.strokeDashes?.length;
    if (!approved && pink) add('F1', 'error', `Filled shape without approval: ${fillOnly[0].name}.`);
    const big = fillOnly.find((node) => Math.max(node.absoluteBoundingBox.width, node.absoluteBoundingBox.height) > 1.8);
    if (!approved && big) add('F2', 'warn', `${big.name} is a filled shape ${round(Math.max(big.absoluteBoundingBox.width, big.absoluteBoundingBox.height))}px long.`);
  }
  return findings;
}

// frames are the category frames in full. looseSets are sets found on the page outside them.
export function audit(frames, records, looseSets = []) {
  const recordFor = new Map(records.map((record) => [record.name, record]));
  const placed = [];
  for (const frame of frames) for (const node of walkAll(frame)) if (node.type === 'COMPONENT_SET') placed.push([node, frame.name, true]);
  for (const set of looseSets) placed.push([set, null, false]);
  const allNames = new Map();
  for (const [set] of placed) allNames.set(set.name, (allNames.get(set.name) ?? 0) + 1);
  const sets = new Map(placed.map(([set]) => [set.name, set]));
  const seen = new Set();
  const findings = [];
  for (const [set, section, inFrame] of placed) {
    if (seen.has(set.name)) continue;
    seen.add(set.name);
    findings.push(...auditSet(set, section, inFrame, recordFor, allNames, sets));
  }
  return findings;
}

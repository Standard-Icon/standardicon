// Icon geometry as editable anchor points. Every shape in the set becomes one or more subpaths of
// anchors with optional curve handles, and goes back to SVG as a <path>.

export type Point = { x: number; y: number };
export type Anchor = Point & { in?: Point | null; out?: Point | null };
// A path drawn with mirroring on shares its twin number with its reflection, which follows its edits.
export type Subpath = { closed: boolean; anchors: Anchor[]; twin?: number };
export type Shape = { attrs: Record<string, string>; subpaths: Subpath[] };
export type Hit = { shape: number; subpath: number; segment: number; t: number; point: Point; distance: number };

const KAPPA = 0.5523;
const GEOMETRY = new Set(['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2']);
const SAMPLES = 24;

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.0005 && Math.abs(a.y - b.y) < 0.0005;
const round = (n: number) => String(+n.toFixed(3));
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// --- From SVG ---

export function parsePath(d: string): Subpath[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const subpaths: Subpath[] = [];
  let current: Subpath | null = null;
  let index = 0;
  let command = '';
  const number = () => Number(tokens[index++]);
  const last = () => current!.anchors[current!.anchors.length - 1];

  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    if (command === 'Z') {
      const anchors = current!.anchors;
      // A closing point on top of the first one is the same anchor.
      if (anchors.length > 1 && near(anchors[0], last())) {
        anchors[0].in = last().in;
        anchors.pop();
      }
      current!.closed = true;
      continue;
    }
    if (command === 'M') {
      current = { closed: false, anchors: [{ x: number(), y: number() }] };
      subpaths.push(current);
      command = 'L';
    } else if (command === 'L') {
      current!.anchors.push({ x: number(), y: number() });
    } else if (command === 'H') {
      current!.anchors.push({ x: number(), y: last().y });
    } else if (command === 'V') {
      current!.anchors.push({ x: last().x, y: number() });
    } else if (command === 'C') {
      last().out = { x: number(), y: number() };
      const handle = { x: number(), y: number() };
      current!.anchors.push({ x: number(), y: number(), in: handle });
    } else {
      throw new Error(`Unsupported path command "${command}"`);
    }
  }
  return subpaths;
}

function rectSubpath(x: number, y: number, w: number, h: number, radius: number): Subpath {
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) return { closed: true, anchors: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] };
  const c = r * (1 - KAPPA);
  const right = x + w;
  const bottom = y + h;
  const corners: Anchor[][] = [
    [{ x: x + r, y, in: { x: x + c, y } }, { x: right - r, y, out: { x: right - c, y } }],
    [{ x: right, y: y + r, in: { x: right, y: y + c } }, { x: right, y: bottom - r, out: { x: right, y: bottom - c } }],
    [{ x: right - r, y: bottom, in: { x: right - c, y: bottom } }, { x: x + r, y: bottom, out: { x: x + c, y: bottom } }],
    [{ x, y: bottom - r, in: { x, y: bottom - c } }, { x, y: y + r, out: { x, y: y + c } }],
  ];
  // A pill's straight side has no length on its short ends, so those two anchors become one.
  const anchors: Anchor[] = [];
  for (const anchor of corners.flat()) {
    const previous = anchors[anchors.length - 1];
    if (previous && near(previous, anchor)) previous.out = anchor.out ?? previous.out;
    else anchors.push(anchor);
  }
  if (anchors.length > 1 && near(anchors[0], anchors[anchors.length - 1])) {
    anchors[0].in = anchors[anchors.length - 1].in ?? anchors[0].in;
    anchors.pop();
  }
  return { closed: true, anchors };
}

function ellipseSubpath(cx: number, cy: number, rx: number, ry: number): Subpath {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    anchors: [
      { x: cx, y: cy - ry, in: { x: cx - kx, y: cy - ry }, out: { x: cx + kx, y: cy - ry } },
      { x: cx + rx, y: cy, in: { x: cx + rx, y: cy - ky }, out: { x: cx + rx, y: cy + ky } },
      { x: cx, y: cy + ry, in: { x: cx + kx, y: cy + ry }, out: { x: cx - kx, y: cy + ry } },
      { x: cx - rx, y: cy, in: { x: cx - rx, y: cy + ky }, out: { x: cx - rx, y: cy - ky } },
    ],
  };
}

// Returns null for anything the editor can't represent, so that icon simply isn't editable.
export function parseBody(markup: string): Shape[] | null {
  const shapes: Shape[] = [];
  try {
    for (const [, tag, rawAttrs] of markup.matchAll(/<([a-zA-Z]+)([^>]*?)\/?>/g)) {
      const all: Record<string, string> = {};
      for (const [, name, value] of rawAttrs.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) all[name] = value;
      const n = (name: string) => Number(all[name] ?? 0);
      let subpaths: Subpath[];
      if (tag === 'path') subpaths = parsePath(all.d ?? '');
      else if (tag === 'rect') subpaths = [rectSubpath(n('x'), n('y'), n('width'), n('height'), n('rx'))];
      else if (tag === 'circle') subpaths = [ellipseSubpath(n('cx'), n('cy'), n('r'), n('r'))];
      else if (tag === 'ellipse') subpaths = [ellipseSubpath(n('cx'), n('cy'), n('rx'), n('ry'))];
      else if (tag === 'line') subpaths = [{ closed: false, anchors: [{ x: n('x1'), y: n('y1') }, { x: n('x2'), y: n('y2') }] }];
      else return null;
      const attrs = Object.fromEntries(Object.entries(all).filter(([name]) => !GEOMETRY.has(name)));
      shapes.push({ attrs, subpaths });
    }
  } catch {
    return null;
  }
  return shapes;
}

// --- Back to SVG ---

export function subpathData({ closed, anchors }: Subpath): string {
  if (anchors.length === 0) return '';
  const point = (p: Point) => `${round(p.x)} ${round(p.y)}`;
  let d = `M${point(anchors[0])}`;
  const count = segmentCount({ closed, anchors });
  for (let i = 0; i < count; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const curved = a.out || b.in;
    if (curved) d += `C${point(a.out ?? a)} ${point(b.in ?? b)} ${point(b)}`;
    else if (!(closed && i === count - 1)) d += `L${point(b)}`;
  }
  if (closed) d += 'Z';
  else if (anchors.length === 1) d += `L${point(anchors[0])}`; // Draws a dot with round caps.
  return d;
}

export const shapesData = (shapes: Shape[]) => shapes.flatMap((shape) => shape.subpaths.map(subpathData)).join('');

export function shapesMarkup(shapes: Shape[]): string {
  return shapes
    .filter((shape) => shape.subpaths.some((subpath) => subpath.anchors.length > 0))
    .map((shape) => {
      const attrs = Object.entries(shape.attrs).map(([name, value]) => ` ${name}="${value}"`).join('');
      return `<path d="${shape.subpaths.map(subpathData).join('')}"${attrs}/>`;
    })
    .join('');
}

// --- Editing ---

const segmentCount = ({ closed, anchors }: Subpath) => (closed ? (anchors.length > 1 ? anchors.length : 0) : Math.max(anchors.length - 1, 0));

export const isEndpoint = ({ closed, anchors }: Subpath, index: number) => !closed && (index === 0 || index === anchors.length - 1);

// Shift keeps a line straight: the point moves onto the nearest of eight directions from the origin
// (every 45°), at a distance rounded to the grid step, and stays inside the canvas when given its size.
export function constrainAngle(origin: Point, to: Point, step: number, size?: number): Point {
  const eighth = Math.PI / 4;
  const angle = Math.round(Math.atan2(to.y - origin.y, to.x - origin.x) / eighth) * eighth;
  const ux = Math.round(Math.cos(angle));
  const uy = Math.round(Math.sin(angle));
  // How far along that direction, measured per axis, so a 45° line moves the same on x and y.
  let t = Math.round(((to.x - origin.x) * ux + (to.y - origin.y) * uy) / (ux * ux + uy * uy) / step) * step;
  if (size !== undefined) {
    for (const [from, u] of [[origin.x, ux], [origin.y, uy]]) {
      if (u > 0) t = Math.min(t, size - from);
      if (u < 0) t = Math.min(t, from);
    }
    t = Math.max(0, t);
  }
  return { x: origin.x + t * ux + 0, y: origin.y + t * uy + 0 };
}

// --- Drawing shapes ---

// The box a drag draws, from where it started to the pointer. Square makes the sides equal, and centered
// grows the box out from where the drag started.
export function dragBox(from: Point, to: Point, square = false, centered = false): [Point, Point] {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  const end = { x: from.x + dx, y: from.y + dy };
  return centered ? [{ x: from.x - dx, y: from.y - dy }, end] : [{ ...from }, end];
}

const corners = ([a, b]: [Point, Point]) => ({ left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) });

// Clockwise from the top left corner.
export function rectangleSubpath(box: [Point, Point]): Subpath {
  const { left, right, top, bottom } = corners(box);
  return { closed: true, anchors: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] };
}

// The same four anchors an SVG circle or ellipse becomes, fitted to the box.
export function ellipseInBox(box: [Point, Point]): Subpath {
  const { left, right, top, bottom } = corners(box);
  return ellipseSubpath((left + right) / 2, (top + bottom) / 2, (right - left) / 2, (bottom - top) / 2);
}

export const lineSubpath = ([a, b]: [Point, Point]): Subpath => ({ closed: false, anchors: [{ ...a }, { ...b }] });

// The reflection across the canvas's vertical centre line, handles and all.
export function mirrorAnchors(anchors: Anchor[], size: number): Anchor[] {
  const flip = (p: Point) => ({ x: size - p.x + 0, y: p.y });
  return anchors.map((a) => ({ ...flip(a), in: a.in ? flip(a.in) : null, out: a.out ? flip(a.out) : null }));
}

// Handles travel with their anchor, so curves keep their shape.
export function moveAnchor(anchor: Anchor, to: Point) {
  const dx = to.x - anchor.x;
  const dy = to.y - anchor.y;
  anchor.x = to.x;
  anchor.y = to.y;
  if (anchor.in) anchor.in = { x: anchor.in.x + dx, y: anchor.in.y + dy };
  if (anchor.out) anchor.out = { x: anchor.out.x + dx, y: anchor.out.y + dy };
}

// One handle goes to the pointer and the other mirrors it, so the curve passes smoothly through the anchor.
// The pointer's handle faces forward along the path, or backward when a path is being drawn from its start.
export function setHandles(anchor: Anchor, handle: Point, reversed = false) {
  if (near(anchor, handle)) {
    clearHandles(anchor);
    return;
  }
  const mirrored = { x: 2 * anchor.x - handle.x, y: 2 * anchor.y - handle.y };
  anchor.out = reversed ? mirrored : { ...handle };
  anchor.in = reversed ? { ...handle } : mirrored;
}

// Moves one handle, and the other stays directly opposite it and grows or shrinks by the same proportion, so
// the curve runs smoothly through the anchor. With independent set, only this handle moves, making a corner.
export function moveHandle(anchor: Anchor, side: 'in' | 'out', to: Point, independent = false) {
  const otherSide = side === 'in' ? 'out' : 'in';
  const current = anchor[side];
  const other = anchor[otherSide];
  if (near(anchor, to)) {
    anchor[side] = null;
    return;
  }
  anchor[side] = { ...to };
  if (!independent && other) {
    const reach = Math.hypot(to.x - anchor.x, to.y - anchor.y);
    const before = current ? Math.hypot(current.x - anchor.x, current.y - anchor.y) : 0;
    const length = Math.hypot(other.x - anchor.x, other.y - anchor.y) * (before > 0 ? reach / before : 1);
    anchor[otherSide] = {
      x: anchor.x - ((to.x - anchor.x) / reach) * length,
      y: anchor.y - ((to.y - anchor.y) / reach) * length,
    };
  }
}

export function clearHandles(anchor: Anchor) {
  anchor.in = null;
  anchor.out = null;
}

export function deleteAnchor(subpath: Subpath, index: number) {
  const { anchors, closed } = subpath;
  if (!closed && index === 0 && anchors[1]) anchors[1].in = null;
  if (!closed && index === anchors.length - 1 && anchors[index - 1]) anchors[index - 1].out = null;
  anchors.splice(index, 1);
  // Two straight points can't enclose anything, so the path opens into a line.
  if (closed && anchors.length < 3 && anchors.every((anchor) => !anchor.in && !anchor.out)) subpath.closed = false;
  if (anchors.length < 2) subpath.closed = false;
}

// Adds an anchor partway along a segment without changing the shape of the line.
export function insertAnchor(subpath: Subpath, segment: number, t: number): number {
  const { anchors } = subpath;
  const a = anchors[segment];
  const nextIndex = (segment + 1) % anchors.length;
  const b = anchors[nextIndex];
  let added: Anchor;
  if (a.out || b.in) {
    const p1 = a.out ?? a;
    const p2 = b.in ?? b;
    const ab = lerp(a, p1, t);
    const mid = lerp(p1, p2, t);
    const cd = lerp(p2, b, t);
    const left = lerp(ab, mid, t);
    const right = lerp(mid, cd, t);
    a.out = ab;
    b.in = cd;
    added = { ...lerp(left, right, t), in: left, out: right };
  } else {
    added = lerp(a, b, t);
  }
  anchors.splice(segment + 1, 0, added);
  return segment + 1;
}

export function extendSubpath(subpath: Subpath, index: number, point: Point): number {
  if (index === 0 && subpath.anchors.length > 1) {
    subpath.anchors.unshift({ ...point });
    return 0;
  }
  subpath.anchors.push({ ...point });
  return subpath.anchors.length - 1;
}

function reverseSubpath(subpath: Subpath) {
  subpath.anchors = subpath.anchors.reverse().map(({ in: before, out: after, ...point }) => ({ ...point, in: after, out: before }));
}

// Joins two open paths at the ends given, into the first path.
export function joinSubpaths(first: Subpath, firstIndex: number, second: Subpath, secondIndex: number) {
  if (firstIndex === 0 && first.anchors.length > 1) reverseSubpath(first);
  if (secondIndex !== 0) reverseSubpath(second);
  first.anchors.push(...second.anchors);
  second.anchors = [];
}

function pointOnSegment(a: Anchor, b: Anchor, t: number): Point {
  if (!a.out && !b.in) return lerp(a, b, t);
  const p1 = a.out ?? a;
  const p2 = b.in ?? b;
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: w[0] * a.x + w[1] * p1.x + w[2] * p2.x + w[3] * b.x,
    y: w[0] * a.y + w[1] * p1.y + w[2] * p2.y + w[3] * b.y,
  };
}

export function nearestSegment(shapes: Shape[], to: Point, tolerance: number): Hit | null {
  let best: Hit | null = null;
  shapes.forEach((shape, shapeIndex) => {
    shape.subpaths.forEach((subpath, subpathIndex) => {
      const count = segmentCount(subpath);
      for (let segment = 0; segment < count; segment++) {
        const a = subpath.anchors[segment];
        const b = subpath.anchors[(segment + 1) % subpath.anchors.length];
        for (let step = 1; step < SAMPLES; step++) {
          const t = step / SAMPLES;
          const point = pointOnSegment(a, b, t);
          const distance = Math.hypot(point.x - to.x, point.y - to.y);
          if (distance <= tolerance && (!best || distance < best.distance)) {
            best = { shape: shapeIndex, subpath: subpathIndex, segment, t, point, distance };
          }
        }
      }
    });
  });
  return best;
}

// --- The splash page's saved format ---

// A saved drawing is plain numbers: { closed, anchors: [[x, y] or [x, y, inX, inY, outX, outY]] }.
export type SavedPath = { closed: boolean; anchors: number[][] };

const SAVED_ATTRS = { stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

export function shapesToPaths(shapes: Shape[]): SavedPath[] {
  const number = (n: number) => +n.toFixed(3);
  return shapes.flatMap((shape) => shape.subpaths)
    .filter((subpath) => subpath.anchors.length > 0)
    .map(({ closed, anchors }) => ({
      closed,
      anchors: anchors.map((a) => {
        const before = a.in ?? a;
        const after = a.out ?? a;
        if (near(before, a) && near(after, a)) return [number(a.x), number(a.y)];
        return [a.x, a.y, before.x, before.y, after.x, after.y].map(number);
      }),
    }));
}

export function pathsToShapes(paths: SavedPath[]): Shape[] {
  const handle = (x: number, y: number, ax: number, ay: number) => (x === ax && y === ay ? null : { x, y });
  return [{
    attrs: { ...SAVED_ATTRS },
    subpaths: paths.map(({ closed, anchors }) => ({
      closed,
      anchors: anchors.map(([x, y, ix = x, iy = y, ox = x, oy = y]) => ({ x, y, in: handle(ix, iy, x, y), out: handle(ox, oy, x, y) })),
    })),
  }];
}

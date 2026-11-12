// Cuts stroked icon geometry away where it runs inside a rounded rectangle.
//
// Overlay badges in Figma hide the parent under a white Cutout, which exports as white. So the importer
// rebuilds them from the parent's live strokes instead: every centreline is clipped against the Cutout, and what's left is emitted as open stroked
// paths. The cut ends land on the badge border's centreline, so their round caps tuck under the border
// at every weight.
//
// Works on the importer's own output: absolute path commands (M L H V C Q Z), rect, circle, and line.

const EPS = 1e-6;
const round = (n) => +n.toFixed(3);
const fmt = (n) => String(round(n));

// ---- Geometry ----

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// A segment is { type: 'L', p: [p0, p1] } or { type: 'C', p: [p0, c1, c2, p1] }.
export function pointAt(seg, t) {
  if (seg.type === 'L') return lerp(seg.p[0], seg.p[1], t);
  const [a, b, c, d] = seg.p;
  const ab = lerp(a, b, t), bc = lerp(b, c, t), cd = lerp(c, d, t);
  return lerp(lerp(ab, bc, t), lerp(bc, cd, t), t);
}

// The part of a segment between t0 and t1, by de Casteljau.
function slice(seg, t0, t1) {
  if (seg.type === 'L') return { type: 'L', p: [pointAt(seg, t0), pointAt(seg, t1)] };
  const split = (p, t) => {
    const [a, b, c, d] = p;
    const ab = lerp(a, b, t), bc = lerp(b, c, t), cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
    return [[a, ab, abc, m], [m, bcd, cd, d]];
  };
  let p = seg.p;
  if (t1 < 1) p = split(p, t1)[0];
  if (t0 > 0) p = split(p, t0 / t1)[1];
  return { type: 'C', p };
}

export function insideRoundRect([x, y, w, h, r], [px, py]) {
  if (px <= x + EPS || px >= x + w - EPS || py <= y + EPS || py >= y + h - EPS) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 < r * r - EPS;
}

// Parameter ranges of a segment that lie outside the cutout, split exactly at the boundary.
function outsideRanges(seg, cut) {
  const N = 96;
  const inside = (t) => insideRoundRect(cut, pointAt(seg, t));
  const edges = [];
  let prev = inside(0);
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const now = inside(t);
    if (now !== prev) {
      let lo = (i - 1) / N, hi = t;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (inside(mid) === prev) lo = mid;
        else hi = mid;
      }
      edges.push((lo + hi) / 2);
    }
    prev = now;
  }
  const ranges = [];
  let start = inside(0) ? null : 0;
  for (const e of edges) {
    if (start === null) start = e;
    else {
      ranges.push([start, e]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, 1]);
  return ranges.filter(([a, b]) => b - a > 1e-4);
}

// ---- Parsing the importer's elements into subpaths ----

const attr = (el, name) => el.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

export function pathToSubpaths(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const subpaths = [];
  let current = null, pen = [0, 0], start = [0, 0], cmd = '', i = 0;
  const num = () => +tokens[i++];
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'Z') {
      if (current) {
        if (Math.hypot(pen[0] - start[0], pen[1] - start[1]) > EPS) current.segs.push({ type: 'L', p: [pen, start] });
        current.closed = true;
      }
      pen = start;
      current = null;
      continue;
    }
    if (cmd === 'M') {
      pen = start = [num(), num()];
      current = { segs: [], closed: false };
      subpaths.push(current);
      cmd = 'L'; // further pairs after M are line-tos
      continue;
    }
    if (!current) {
      current = { segs: [], closed: false };
      subpaths.push(current);
      start = pen;
    }
    if (cmd === 'L') { const p = [num(), num()]; current.segs.push({ type: 'L', p: [pen, p] }); pen = p; }
    else if (cmd === 'H') { const p = [num(), pen[1]]; current.segs.push({ type: 'L', p: [pen, p] }); pen = p; }
    else if (cmd === 'V') { const p = [pen[0], num()]; current.segs.push({ type: 'L', p: [pen, p] }); pen = p; }
    else if (cmd === 'C') { const c1 = [num(), num()], c2 = [num(), num()], p = [num(), num()]; current.segs.push({ type: 'C', p: [pen, c1, c2, p] }); pen = p; }
    else if (cmd === 'Q') {
      const q = [num(), num()], p = [num(), num()];
      current.segs.push({ type: 'C', p: [pen, lerp(pen, q, 2 / 3), lerp(p, q, 2 / 3), p] });
      pen = p;
    } else throw new Error(`clip: unsupported path command ${cmd}`);
  }
  return subpaths.filter((s) => s.segs.length);
}

const K = 0.5522847498; // cubic approximation of a quarter circle

function roundRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  if (!r) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  const k = r * K;
  return [
    `M${x + r} ${y}`, `L${x + w - r} ${y}`, `C${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r}`,
    `L${x + w} ${y + h - r}`, `C${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h}`,
    `L${x + r} ${y + h}`, `C${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r}`,
    `L${x} ${y + r}`, `C${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y}`, 'Z',
  ].join('');
}

export function elementToD(el) {
  const tag = el.match(/^<(\w+)/)[1];
  if (tag === 'path') return attr(el, 'd');
  if (tag === 'line') return `M${attr(el, 'x1')} ${attr(el, 'y1')}L${attr(el, 'x2')} ${attr(el, 'y2')}`;
  if (tag === 'rect') {
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((n) => +(attr(el, n) ?? 0));
    return roundRectPath(x, y, w, h, +(attr(el, 'rx') ?? attr(el, 'ry') ?? 0));
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = +attr(el, 'cx'), cy = +attr(el, 'cy');
    const rx = +(attr(el, 'rx') ?? attr(el, 'r')), ry = +(attr(el, 'ry') ?? attr(el, 'r'));
    const kx = rx * K, ky = ry * K;
    return `M${cx + rx} ${cy}C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}Z`;
  }
  throw new Error(`clip: unsupported element <${tag}>`);
}

// ---- Clipping ----

const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4;

function clipSubpath(sub, cut) {
  // Chains of kept pieces, each a list of segments that join end to start.
  const chains = [];
  let open = null;
  let lastEnd = null;
  sub.segs.forEach((seg, index) => {
    for (const [a, b] of outsideRanges(seg, cut)) {
      const piece = slice(seg, a, b);
      const continues = open && a === 0 && lastEnd && lastEnd.index === index - 1 && lastEnd.t === 1;
      if (!continues) {
        open = { segs: [], startsAtZero: index === 0 && a === 0 };
        chains.push(open);
      }
      open.segs.push(piece);
      open.endsAtOne = index === sub.segs.length - 1 && b === 1;
      lastEnd = { index, t: b };
    }
  });
  const untouched = chains.length === 1 && chains[0].segs.length === sub.segs.length && chains[0].segs.every((s, i) => sameSeg(s, sub.segs[i]));
  if (sub.closed && untouched) return [{ segs: chains[0].segs, closed: true }];
  // On a closed subpath, the piece running through the start point is one stroke: rejoin it.
  if (sub.closed && chains.length > 1 && chains[0].startsAtZero && chains[chains.length - 1].endsAtOne) {
    const last = chains.pop();
    chains[0].segs = [...last.segs, ...chains[0].segs];
  }
  return chains.map((c) => ({ segs: c.segs, closed: false }));
}

function sameSeg(a, b) {
  return a.type === b.type && a.p.every((pt, i) => same(pt, b.p[i]));
}

function chainToD({ segs, closed }) {
  let d = `M${fmt(segs[0].p[0][0])} ${fmt(segs[0].p[0][1])}`;
  for (const s of segs) {
    if (s.type === 'L') d += `L${fmt(s.p[1][0])} ${fmt(s.p[1][1])}`;
    else d += `C${s.p.slice(1).map((pt) => `${fmt(pt[0])} ${fmt(pt[1])}`).join(' ')}`;
  }
  return closed ? `${d}Z` : d;
}

// Clips every element of an icon body against the cutout [x, y, width, height, radius].
export function clipBody(body, cut) {
  const elements = body.match(/<(path|rect|circle|ellipse|line)\b[^>]*\/>/g) ?? [];
  let out = '';
  for (const el of elements) {
    const stroked = /stroke="currentColor"/.test(el);
    if (!stroked) {
      // A deliberate filled part, such as a dot. Keep it unless it sits inside the cutout.
      const pts = (elementToD(el).match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
      const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
      const centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      if (!insideRoundRect(cut, centre)) out += el;
      continue;
    }
    const pieces = pathToSubpaths(elementToD(el)).flatMap((sub) => clipSubpath(sub, cut));
    if (!pieces.length) continue;
    const join = attr(el, 'stroke-linejoin') ?? 'round';
    out += `<path d="${pieces.map(chainToD).join('')}" stroke="currentColor" stroke-linecap="round" stroke-linejoin="${join}"/>`;
  }
  return out;
}

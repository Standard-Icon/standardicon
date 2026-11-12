// node --test lib/anchors.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pathsToShapes, shapesToPaths, clearHandles, constrainAngle, dragBox, ellipseInBox, lineSubpath, mirrorAnchors, rectangleSubpath, deleteAnchor, joinSubpaths, extendSubpath, insertAnchor, moveAnchor, moveHandle, nearestSegment, parseBody, parsePath, setHandles, shapesMarkup, subpathData } from './anchors.ts';

const icons = JSON.parse(readFileSync(new URL('../icons/icons.json', import.meta.url), 'utf8'));
const bodies = icons.flatMap((icon) =>
  [icon.body, ...Object.values(icon.sizes ?? {})].map((body) => ({ name: icon.name, body })),
);

const numbers = (d) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);

test('every drawing in the set can be edited', () => {
  assert.ok(bodies.length > 700);
  for (const { name, body } of bodies) {
    const shapes = parseBody(body);
    assert.ok(shapes, name);
    assert.ok(shapes.length > 0, name);
    for (const shape of shapes) for (const subpath of shape.subpaths) assert.ok(subpath.anchors.length > 0, name);
  }
});

test('straight and curved paths go back to the same coordinates', () => {
  for (const d of ['M1 2L3 4L5 6', 'M1 2C1 3 2 4 3 4L5 6', 'M2 2H10V8H2Z', 'M1 1L5 1L5 5C4 6 2 6 1 5Z', 'M1 1L2 2M3 3L4 4']) {
    const out = parsePath(d).map(subpathData).join('');
    const expanded = parsePath(out).map(subpathData).join('');
    assert.equal(out, expanded, d);
  }
  assert.equal(subpathData(parsePath('M1 2C1 3 2 4 3 4')[0]), 'M1 2C1 3 2 4 3 4');
  assert.deepEqual(numbers(subpathData(parsePath('M2 2H10V8H2Z')[0])), [2, 2, 10, 2, 10, 8, 2, 8]);
});

test('a closing point on top of the first anchor is one anchor, and keeps its curve', () => {
  const [path] = parsePath('M2 2L6 2C6 4 4 6 2 2Z');
  assert.equal(path.closed, true);
  assert.equal(path.anchors.length, 2);
  assert.deepEqual(path.anchors[0].in, { x: 4, y: 6 });
  assert.equal(subpathData(path), 'M2 2L6 2C6 4 4 6 2 2Z');
});

test('shapes keep their stroke and fill, and drop their old geometry', () => {
  const shapes = parseBody('<rect x="2" y="3" width="10" height="8" rx="1" stroke="currentColor" stroke-linejoin="round"/>');
  assert.deepEqual(shapes[0].attrs, { stroke: 'currentColor', 'stroke-linejoin': 'round' });
  assert.equal(shapes[0].subpaths[0].anchors.length, 8);
  const markup = shapesMarkup(shapes);
  assert.match(markup, /^<path d="M3 3L/);
  assert.match(markup, /stroke-linejoin="round"\/>$/);
  assert.doesNotMatch(markup, /\brx=|width=/);
  const circle = parseBody('<circle cx="8" cy="8" r="2" fill="currentColor"/>');
  assert.equal(circle[0].subpaths[0].anchors.length, 4);
  assert.deepEqual(circle[0].attrs, { fill: 'currentColor' });
});

test('a pill has no doubled anchors on its short ends', () => {
  const [{ subpaths }] = parseBody('<rect x="2" y="6" width="12" height="4" rx="2"/>');
  const { anchors } = subpaths[0];
  assert.equal(anchors.length, 6);
  for (let i = 0; i < anchors.length; i++) {
    const next = anchors[(i + 1) % anchors.length];
    assert.ok(Math.hypot(anchors[i].x - next.x, anchors[i].y - next.y) > 0.01);
  }
});

test('unknown elements and path commands leave an icon uneditable', () => {
  assert.equal(parseBody('<g><path d="M1 1L2 2"/></g>'), null);
  assert.equal(parseBody('<path d="M1 1Q2 2 3 3"/>'), null);
});

test('moving an anchor carries its handles', () => {
  const [path] = parsePath('M0 0C1 0 2 1 2 2C2 3 3 4 4 4');
  moveAnchor(path.anchors[1], { x: 3, y: 3 });
  assert.deepEqual({ x: path.anchors[1].x, y: path.anchors[1].y }, { x: 3, y: 3 });
  assert.deepEqual(path.anchors[1].in, { x: 3, y: 2 });
  assert.deepEqual(path.anchors[1].out, { x: 3, y: 4 });
});

test('setting handles mirrors them around the anchor and bends the lines on both sides', () => {
  const [path] = parsePath('M0 0L4 4L8 0');
  setHandles(path.anchors[1], { x: 6, y: 4 });
  assert.deepEqual(path.anchors[1].out, { x: 6, y: 4 });
  assert.deepEqual(path.anchors[1].in, { x: 2, y: 4 });
  assert.equal(subpathData(path), 'M0 0C0 0 2 4 4 4C6 4 8 0 8 0');
  assert.deepEqual(parsePath(subpathData(path))[0].anchors[1].out, { x: 6, y: 4 });
});

test('a path drawn from its start keeps the curve running the way it was drawn', () => {
  const path = { closed: false, anchors: [{ x: 8, y: 8 }, { x: 12, y: 8 }] };
  assert.equal(extendSubpath(path, 0, { x: 4, y: 8 }), 0);
  setHandles(path.anchors[0], { x: 2, y: 6 }, true);
  assert.deepEqual(path.anchors[0].in, { x: 2, y: 6 });
  assert.deepEqual(path.anchors[0].out, { x: 6, y: 10 });
  assert.equal(subpathData(path), 'M4 8C6 10 8 8 8 8L12 8');
});

test('handles on top of the anchor, or cleared, make a sharp corner again', () => {
  const [path] = parsePath('M0 0L4 4L8 0');
  setHandles(path.anchors[1], { x: 6, y: 4 });
  setHandles(path.anchors[1], { x: 4, y: 4 });
  assert.equal(subpathData(path), 'M0 0L4 4L8 0');
  setHandles(path.anchors[1], { x: 6, y: 4 });
  clearHandles(path.anchors[1]);
  assert.equal(subpathData(path), 'M0 0L4 4L8 0');
});

test('a normal handle drag turns the other handle and scales it by the same proportion', () => {
  const close = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  const anchor = { x: 8, y: 8, in: { x: 6, y: 8 }, out: { x: 12, y: 8 } };
  moveHandle(anchor, 'out', { x: 14, y: 8 }); // Out by half again.
  close(anchor.in, { x: 5, y: 8 });
  moveHandle(anchor, 'out', { x: 10, y: 8 }); // In to a third of that.
  close(anchor.in, { x: 7, y: 8 });
  moveHandle(anchor, 'out', { x: 8, y: 6 }); // Same length, new direction.
  close(anchor.in, { x: 8, y: 9 });
});

test('a handle can move alone with independent set', () => {
  const anchor = { x: 8, y: 8, in: { x: 6, y: 8 }, out: { x: 12, y: 8 } };
  moveHandle(anchor, 'out', { x: 8, y: 3 }, true);
  assert.deepEqual(anchor.in, { x: 6, y: 8 });
  assert.deepEqual(anchor.out, { x: 8, y: 3 });
});

test('a normal drag brings split handles back in line', () => {
  const anchor = { x: 8, y: 8, in: { x: 6, y: 8 }, out: { x: 8, y: 3 } };
  moveHandle(anchor, 'in', { x: 3, y: 8 });
  assert.deepEqual(anchor.in, { x: 3, y: 8 });
  assert.ok(anchor.out.x > 8);
  assert.ok(Math.abs(anchor.out.y - 8) < 1e-9);
});

test('an anchor with a single handle stays that way', () => {
  const single = { x: 8, y: 8, in: null, out: { x: 12, y: 8 } };
  moveHandle(single, 'out', { x: 10, y: 10 });
  assert.equal(single.in, null);
  assert.deepEqual(single.out, { x: 10, y: 10 });
});

test('a handle dragged onto its anchor is removed, and the other stays', () => {
  const anchor = { x: 8, y: 8, in: { x: 6, y: 8 }, out: { x: 12, y: 8 } };
  moveHandle(anchor, 'out', { x: 8, y: 8 });
  assert.equal(anchor.out, null);
  assert.deepEqual(anchor.in, { x: 6, y: 8 });
});

test('inserting an anchor leaves the line where it was', () => {
  const [line] = parsePath('M0 0L10 0');
  assert.equal(insertAnchor(line, 0, 0.5), 1);
  assert.equal(subpathData(line), 'M0 0L5 0L10 0');

  const [curve] = parsePath('M0 0C0 4 4 8 8 8');
  const before = nearestSegment([{ attrs: {}, subpaths: [curve] }], { x: 2.34, y: 5.66 }, 1).point;
  insertAnchor(curve, 0, 0.5);
  assert.equal(curve.anchors.length, 3);
  // At t = 0.5 the new anchor sits exactly on the old curve, with handles either side of it.
  assert.ok(Math.hypot(curve.anchors[1].x - before.x, curve.anchors[1].y - before.y) < 1);
  assert.ok(curve.anchors[1].in && curve.anchors[1].out);
});

test('a closed path can take an anchor on its closing segment', () => {
  const [path] = parsePath('M0 0H10V10Z');
  assert.equal(insertAnchor(path, 2, 0.5), 3);
  assert.deepEqual({ x: path.anchors[3].x, y: path.anchors[3].y }, { x: 5, y: 5 });
  assert.equal(path.closed, true);
});

test('deleting anchors', () => {
  const [open] = parsePath('M0 0C1 1 2 2 3 3L6 6L9 9');
  deleteAnchor(open, 0);
  assert.equal(open.anchors[0].in, null);
  assert.equal(subpathData(open), 'M3 3L6 6L9 9');

  const [middle] = parsePath('M0 0C1 0 2 0 3 3C4 6 5 6 6 6');
  deleteAnchor(middle, 1);
  assert.equal(subpathData(middle), 'M0 0C1 0 5 6 6 6');

  const [triangle] = parsePath('M0 0H10V10Z');
  deleteAnchor(triangle, 2);
  assert.equal(triangle.closed, false);
  assert.equal(subpathData(triangle), 'M0 0L10 0');

  const [dot] = parsePath('M1 1L2 2');
  deleteAnchor(dot, 1);
  assert.equal(subpathData(dot), 'M1 1L1 1');
  deleteAnchor(dot, 0);
  assert.equal(subpathData(dot), '');
  assert.equal(shapesMarkup([{ attrs: {}, subpaths: [dot] }]), '');
});

test('an open path extends from whichever end is selected', () => {
  const path = { closed: false, anchors: [{ x: 1, y: 1 }, { x: 2, y: 2 }] };
  assert.equal(extendSubpath(path, 1, { x: 3, y: 3 }), 2);
  assert.equal(extendSubpath(path, 0, { x: 0, y: 0 }), 0);
  assert.equal(subpathData(path), 'M0 0L1 1L2 2L3 3');
});

test('joining open paths meets at the chosen ends and keeps curves pointing the right way', () => {
  const tailToHead = [parsePath('M0 0L1 1')[0], parsePath('M5 5L6 6')[0]];
  joinSubpaths(tailToHead[0], 1, tailToHead[1], 0);
  assert.equal(subpathData(tailToHead[0]), 'M0 0L1 1L5 5L6 6');
  assert.equal(subpathData(tailToHead[1]), '');

  const headToHead = [parsePath('M0 0L1 1')[0], parsePath('M5 5L6 6')[0]];
  joinSubpaths(headToHead[0], 0, headToHead[1], 0);
  assert.equal(subpathData(headToHead[0]), 'M1 1L0 0L5 5L6 6');

  const tailToTail = [parsePath('M0 0L1 1')[0], parsePath('M5 5C6 5 7 6 7 7')[0]];
  joinSubpaths(tailToTail[0], 1, tailToTail[1], 1);
  assert.equal(subpathData(tailToTail[0]), 'M0 0L1 1L7 7C7 6 6 5 5 5');
});

test('finding a line near the pointer respects the tolerance', () => {
  const shapes = parseBody('<path d="M0 0L10 0"/>');
  const hit = nearestSegment(shapes, { x: 5, y: 0.2 }, 0.5);
  assert.equal(hit.segment, 0);
  assert.ok(Math.abs(hit.point.x - 5) < 0.3);
  assert.equal(nearestSegment(shapes, { x: 5, y: 3 }, 0.5), null);
});

test('a saved drawing keeps its anchors, curves, and closed paths', () => {
  const paths = [{ closed: false, anchors: [[1, 1], [4, 4, 2, 4, 6, 4], [8, 1]] }, { closed: true, anchors: [[1, 9], [5, 9], [5, 13]] }];
  const markup = shapesMarkup(pathsToShapes(paths));
  assert.match(markup, /d="M1 1C1 1 2 4 4 4C6 4 8 1 8 1M1 9L5 9L5 13Z"/);
  assert.match(markup, /stroke="currentColor"/);
  assert.deepEqual(shapesToPaths(pathsToShapes(paths)), paths);
  assert.deepEqual(shapesToPaths([{ attrs: {}, subpaths: [{ closed: false, anchors: [] }] }]), []);
});

test('Shift snaps a point to the nearest straight or 45° line, on the grid and inside the canvas', () => {
  const o = { x: 8, y: 8 };
  assert.deepEqual(constrainAngle(o, { x: 13.1, y: 8.9 }, 0.25), { x: 13, y: 8 });
  assert.deepEqual(constrainAngle(o, { x: 8.6, y: 2.2 }, 0.25), { x: 8, y: 2.25 });
  assert.deepEqual(constrainAngle(o, { x: 11, y: 12 }, 0.25), { x: 11.5, y: 11.5 });
  assert.deepEqual(constrainAngle(o, { x: 4, y: 12.4 }, 0.25), { x: 3.75, y: 12.25 });
  // Past the edge, a diagonal shortens instead of bending.
  assert.deepEqual(constrainAngle(o, { x: 30, y: 29 }, 0.25, 16), { x: 16, y: 16 });
  assert.deepEqual(constrainAngle({ x: 2, y: 8 }, { x: -6, y: 0 }, 0.25, 16), { x: 0, y: 6 });
  assert.deepEqual(constrainAngle(o, o, 0.25, 16), o);
});

test('a drag draws a box, square with Shift and from its centre with Option', () => {
  const from = { x: 4, y: 4 };
  assert.deepEqual(dragBox(from, { x: 10, y: 7 }), [{ x: 4, y: 4 }, { x: 10, y: 7 }]);
  assert.deepEqual(dragBox(from, { x: 10, y: 7 }, true), [{ x: 4, y: 4 }, { x: 10, y: 10 }]);
  assert.deepEqual(dragBox(from, { x: 1, y: 6 }, true), [{ x: 4, y: 4 }, { x: 1, y: 7 }]);
  assert.deepEqual(dragBox({ x: 8, y: 8 }, { x: 11, y: 10 }, false, true), [{ x: 5, y: 6 }, { x: 11, y: 10 }]);
});

test('rectangles, ellipses and lines are ordinary anchors', () => {
  const rect = rectangleSubpath([{ x: 10, y: 12 }, { x: 2, y: 3 }]);
  assert.equal(rect.closed, true);
  assert.deepEqual(rect.anchors, [{ x: 2, y: 3 }, { x: 10, y: 3 }, { x: 10, y: 12 }, { x: 2, y: 12 }]);
  assert.equal(subpathData(rect), 'M2 3L10 3L10 12L2 12Z');

  const circle = ellipseInBox([{ x: 2, y: 2 }, { x: 14, y: 14 }]);
  assert.equal(circle.closed, true);
  assert.deepEqual(circle.anchors.map(({ x, y }) => [x, y]), [[8, 2], [14, 8], [8, 14], [2, 8]]);
  // Halfway between the top and the right, a true circle is 6 from the centre.
  const [top, right] = circle.anchors;
  const mid = { x: (top.x + 3 * top.out.x + 3 * right.in.x + right.x) / 8, y: (top.y + 3 * top.out.y + 3 * right.in.y + right.y) / 8 };
  assert.ok(Math.abs(Math.hypot(mid.x - 8, mid.y - 8) - 6) < 0.01);

  assert.deepEqual(lineSubpath([{ x: 1, y: 2 }, { x: 3, y: 4 }]), { closed: false, anchors: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
});

test('mirroring reflects anchors and handles across the centre', () => {
  assert.deepEqual(mirrorAnchors([{ x: 3, y: 5, in: null, out: { x: 6, y: 1 } }, { x: 8, y: 2 }], 16), [
    { x: 13, y: 5, in: null, out: { x: 10, y: 1 } },
    { x: 8, y: 2, in: null, out: null },
  ]);
});

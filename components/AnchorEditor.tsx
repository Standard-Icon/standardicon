'use client';

import { useEffect } from 'react';
import { track } from '@/lib/track';
import {
  type Anchor,
  type Point,
  type Shape,
  type Subpath,
  clearHandles,
  constrainAngle,
  deleteAnchor,
  dragBox,
  ellipseInBox,
  extendSubpath,
  insertAnchor,
  isEndpoint,
  joinSubpaths,
  lineSubpath,
  mirrorAnchors,
  moveAnchor,
  moveHandle,
  nearestSegment,
  parseBody,
  rectangleSubpath,
  setHandles,
  shapesData,
  shapesMarkup,
} from '@/lib/anchors';

// Lets anyone edit the anchor points of the icon on a canvas. Edits live only in this page's memory,
// so a refresh clears them. Nothing is set up until a canvas is hovered, focused, or tapped.
const CANVASES = '.poster .figure, #stage-figure';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SNAP = 4; // Quarter pixels on the icon's grid.
const DOT_PX = 4;
const HIT_PX = 12;
const TOUCH_HIT_PX = 20;
const HANDLE_HIT_PX = 8;
const LINE_PX = 9;
const DRAG_PX = 3;
const DOUBLE_MS = 350;
const ALIGN_PX = 6;
const STROKE = { stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
// R, O and L drag out a rectangle, an ellipse, or a single line.
const DRAW_KEYS = { r: 'rectangle', o: 'ellipse', l: 'line' } as const;
type DrawKind = (typeof DRAW_KEYS)[keyof typeof DRAW_KEYS];

// The set's own icons are the cursors, each with the point that does the clicking, on its 16px grid.
const CURSORS = {
  'pen-tilted': { hotspot: [4.288, 4.038], fallback: 'crosshair' },
  'pen-anchor': { hotspot: [4.288, 4.038], fallback: 'crosshair' },
  'pen-add': { hotspot: [2.287, 2.538], fallback: 'crosshair' },
  'pen-delete': { hotspot: [2.287, 2.538], fallback: 'crosshair' },
  'cursor-bezier': { hotspot: [3.5, 3.5], fallback: 'crosshair' },
  'cursor-simple': { hotspot: [3.5, 3.5], fallback: 'default' },
  'cursor-hollow': { hotspot: [3.5, 3.5], fallback: 'default' },
  // The shape tools have no icon of their own yet.
  draw: { hotspot: [8, 8], fallback: 'crosshair' },
} as const;
type CursorName = keyof typeof CURSORS;
const CURSOR_PX = 24;

// Draws an icon to an image, black with a white outline so it shows on any part of the canvas.
function cursorImage(body: string, pixels: number): Promise<string> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 16 16" fill="none">` +
    `<g color="#fff" stroke-width="2.5">${body}</g><g color="#000" stroke-width="1">${body}</g></svg>`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pixels;
      canvas.height = pixels;
      canvas.getContext('2d')!.drawImage(image, 0, 0, pixels, pixels);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = reject;
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  });
}

async function cursorValue(name: CursorName, body: string): Promise<string> {
  const [small, large] = await Promise.all([cursorImage(body, CURSOR_PX), cursorImage(body, CURSOR_PX * 2)]);
  const { hotspot, fallback } = CURSORS[name];
  const scale = CURSOR_PX / 16;
  const at = `${Math.round(hotspot[0] * scale)} ${Math.round(hotspot[1] * scale)}`;
  const sharp = `-webkit-image-set(url("${small}") 1x, url("${large}") 2x) ${at}, ${fallback}`;
  return CSS.supports('cursor', sharp) ? sharp : `url("${small}") ${at}, ${fallback}`;
}

type Selected = { shape: number; subpath: number; anchor: number };

type Session = {
  canvas: HTMLElement;
  svg: SVGSVGElement;
  key: string;
  original: Shape[];
  shapes: Shape[];
  history: Shape[][];
  // What undo took back, for redo. Any new edit clears it.
  future: Shape[][];
  selected: Selected | null;
  // Anchors picked with a Command-drag box, which move and delete together.
  group: Selected[];
  // Each mirrored pair as last synced, to tell which half changed.
  twins: Map<number, [string, string]>;
  edited: boolean;
  art: SVGGElement;
  layer: SVGGElement;
  reset: HTMLButtonElement | null;
};

const copy = (shapes: Shape[]): Shape[] => structuredClone(shapes);

export function AnchorEditor({ cursorIcons }: { cursorIcons: Record<string, string> }) {
  useEffect(() => {
    const sessions = new WeakMap<HTMLElement, Session>();
    const observed = new WeakSet<HTMLElement>();
    const uneditable = new WeakSet<SVGSVGElement>();
    // The same icon drawn again, such as stepping away and back in the large view, keeps its edits.
    const saved = new Map<string, Shape[]>();
    let active: Session | null = null;
    let lastPress: { key: string; at: number } | null = null;
    let lastPointer: { x: number; y: number } | null = null;
    let cursorsStarted = false;
    let optionHeld = false;
    // Shift keeps new segments, dragged anchors, and handles to straight or 45° lines.
    let shiftHeld = false;
    // V selects and moves what's there. P also adds to it. R, O and L draw shapes.
    let tool: 'pen' | 'select' | DrawKind = 'pen';
    // M mirrors new paths across the canvas's vertical centre, and keeps mirrored pairs in step.
    let mirror = false;
    let nextTwin = 1;
    // Smart guides: the lines a point is snapping to.
    let guides: { x?: number; y?: number } | null = null;
    let ghost: SVGElement | null = null;
    let preview: SVGElement | null = null;
    const cursorValues: Partial<Record<CursorName, string>> = {};
    let drag: { session: Session; start: { x: number; y: number }; moved: boolean; recorded: boolean; bend: boolean; handle?: 'in' | 'out'; pen?: boolean; reversed?: boolean; deleteOnRelease?: boolean; penAnchor?: boolean; endSide?: 'in' | 'out'; origin?: Point; marquee?: { from: Point; to: Point }; group?: { pressed: Point; from: Point[] }; draw?: { kind: DrawKind; from: Point; shape: number } } | null = null;

    const viewSize = (session: Session) => session.svg.viewBox.baseVal.width || 16;
    const pxToUnits = (session: Session, px: number) => (px * viewSize(session)) / (session.svg.getBoundingClientRect().width || 1);

    const pointFrom = (session: Session, event: PointerEvent): Point => {
      const box = session.svg.getBoundingClientRect();
      const size = viewSize(session);
      return { x: ((event.clientX - box.left) / box.width) * size, y: ((event.clientY - box.top) / box.height) * size };
    };

    const snap = (session: Session, point: Point): Point => {
      const size = viewSize(session);
      const fit = (n: number) => Math.min(size, Math.max(0, Math.round(n * SNAP) / SNAP));
      return { x: fit(point.x), y: fit(point.y) };
    };

    const anchorAt = (session: Session, { shape, subpath, anchor }: Selected): Anchor | undefined =>
      session.shapes[shape]?.subpaths[subpath]?.anchors[anchor];

    const drawing = () => tool === 'rectangle' || tool === 'ellipse' || tool === 'line';

    // Every editing action goes to the site's metrics as editor_<action>, with where it happened and the tool.
    const where = (session: Session) =>
      session.canvas.dataset.anchorBoard !== undefined ? 'splash' : session.canvas.id === 'stage-figure' ? 'large view' : 'icon page';
    const note = (session: Session | null, action: string, props: Record<string, unknown> = {}) =>
      track(`editor_${action}`, { ...(session ? { canvas: where(session) } : {}), tool, ...(mirror ? { mirror: true } : {}), ...props });
    const parseLabel = (label: string): Selected => {
      const [shape, subpath, anchor] = label.split('.').map(Number);
      return { shape, subpath, anchor };
    };
    const inGroup = (session: Session, { shape, subpath, anchor }: Selected) =>
      session.group.some((g) => g.shape === shape && g.subpath === subpath && g.anchor === anchor);

    // The anchor that mirrors this one, on a path drawn with mirroring on.
    const counterpart = (session: Session, { shape, subpath, anchor }: Selected): Anchor | undefined => {
      const own = session.shapes[shape]?.subpaths[subpath];
      if (own?.twin === undefined) return undefined;
      for (const { subpaths } of session.shapes) for (const other of subpaths) if (other !== own && other.twin === own.twin) return other.anchors[anchor];
      return undefined;
    };

    // Smart guides: a point a few pixels from another anchor's x or y, or the canvas centre, lines up with it.
    const align = (session: Session, point: Point, skip: Set<Anchor | undefined>): Point => {
      const size = viewSize(session);
      let reachX = pxToUnits(session, ALIGN_PX);
      let reachY = reachX;
      const found: { x?: number; y?: number } = {};
      const consider = (x: number, y: number) => {
        if (Math.abs(x - point.x) <= reachX) [reachX, found.x] = [Math.abs(x - point.x), x];
        if (Math.abs(y - point.y) <= reachY) [reachY, found.y] = [Math.abs(y - point.y), y];
      };
      consider(size / 2, size / 2);
      for (const { subpaths } of session.shapes) for (const { anchors } of subpaths) for (const anchor of anchors) if (!skip.has(anchor)) consider(anchor.x, anchor.y);
      guides = found.x === undefined && found.y === undefined ? null : found;
      return { x: found.x ?? point.x, y: found.y ?? point.y };
    };

    // A new path, and its reflection when mirroring is on.
    const addPath = (session: Session, subpath: Subpath): number => {
      const shape: Shape = { attrs: { ...STROKE }, subpaths: [subpath] };
      if (mirror) {
        subpath.twin = nextTwin++;
        shape.subpaths.push({ closed: subpath.closed, anchors: mirrorAnchors(subpath.anchors, viewSize(session)), twin: subpath.twin });
      }
      session.shapes.push(shape);
      return session.shapes.length - 1;
    };

    // With mirroring on, whichever half of a mirrored pair changed is reflected onto the other.
    const syncTwins = (session: Session) => {
      const pairs = new Map<number, Subpath[]>();
      for (const { subpaths } of session.shapes) for (const subpath of subpaths) if (subpath.twin !== undefined) pairs.set(subpath.twin, [...(pairs.get(subpath.twin) ?? []), subpath]);
      for (const [id, [a, b]] of pairs) {
        if (!b) continue;
        const last = session.twins.get(id);
        const source = !last || JSON.stringify(a) !== last[0] ? a : JSON.stringify(b) !== last[1] ? b : null;
        if (source?.anchors.length) {
          const target = source === a ? b : a;
          target.closed = source.closed;
          target.anchors = mirrorAnchors(source.anchors, viewSize(session));
        }
        session.twins.set(id, [JSON.stringify(a), JSON.stringify(b)]);
      }
    };

    const paintGuides = (session: Session) => {
      session.layer.querySelectorAll('.anchor-guide').forEach((line) => line.remove());
      if (!guides) return;
      const size = viewSize(session);
      if (guides.x !== undefined) session.layer.prepend(svgElement('line', { class: 'anchor-guide', x1: guides.x, y1: 0, x2: guides.x, y2: size }));
      if (guides.y !== undefined) session.layer.prepend(svgElement('line', { class: 'anchor-guide', x1: 0, y1: guides.y, x2: size, y2: guides.y }));
    };

    const svgElement = (name: string, attrs: Record<string, string | number>) => {
      const element = document.createElementNS(SVG_NS, name);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
      return element;
    };

    const drawLayer = (session: Session, coarse = false) => {
      const dot = pxToUnits(session, DOT_PX);
      const hit = pxToUnits(session, coarse || matchMedia('(pointer: coarse)').matches ? TOUCH_HIT_PX : HIT_PX);
      const { selected } = session;
      const parts: SVGElement[] = [svgElement('path', { class: 'anchor-line', d: shapesData(session.shapes) })];
      const dots: SVGElement[] = [];
      let count = 0;
      session.shapes.forEach((shape, shapeIndex) => {
        shape.subpaths.forEach((subpath, subpathIndex) => {
          subpath.anchors.forEach((anchor, anchorIndex) => {
            const here = { shape: shapeIndex, subpath: subpathIndex, anchor: anchorIndex };
            const isSelected = (selected?.shape === shapeIndex && selected.subpath === subpathIndex && selected.anchor === anchorIndex) || inGroup(session, here);
            count += 1;
            dots.push(svgElement('circle', { class: isSelected ? 'anchor-dot on' : 'anchor-dot', cx: anchor.x, cy: anchor.y, r: dot }));
            const target = svgElement('circle', {
              class: 'anchor-hit',
              cx: anchor.x,
              cy: anchor.y,
              r: hit,
              tabindex: 0,
              role: 'button',
              'aria-label': `Anchor ${count}. Drag or use the arrow keys to move it. Press Delete to remove it.`,
              'data-anchor': `${shapeIndex}.${subpathIndex}.${anchorIndex}`,
            });
            dots.push(target);
          });
        });
      });
      // The selected anchor's curve handles.
      const current = selected && anchorAt(session, selected);
      const handleHits: SVGElement[] = [];
      for (const side of ['in', 'out'] as const) {
        const handle = current?.[side];
        if (!handle) continue;
        parts.push(svgElement('line', { class: 'anchor-handle-line', x1: current!.x, y1: current!.y, x2: handle.x, y2: handle.y }));
        parts.push(svgElement('circle', { class: 'anchor-handle', cx: handle.x, cy: handle.y, r: dot * 0.7 }));
        handleHits.push(svgElement('circle', { class: 'anchor-handle-hit', cx: handle.x, cy: handle.y, r: pxToUnits(session, HANDLE_HIT_PX), 'data-handle': side }));
      }
      // Handles go last, so one sitting close to its anchor can still be grabbed.
      session.layer.replaceChildren(...parts, ...dots, ...handleHits);
      const size = viewSize(session);
      if (drag?.session === session && drag.marquee) {
        const { from, to } = drag.marquee;
        session.layer.prepend(svgElement('rect', { class: 'anchor-marquee', x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) }));
      }
      if (mirror) session.layer.prepend(svgElement('line', { class: 'anchor-axis', x1: size / 2, y1: 0, x2: size / 2, y2: size }));
      paintGuides(session);
    };

    const refocusSelected = (session: Session) => {
      const { selected } = session;
      if (!selected) return;
      const target = session.layer.querySelector<SVGElement>(`[data-anchor="${selected.shape}.${selected.subpath}.${selected.anchor}"]`);
      target?.focus({ preventScroll: true });
    };

    const updateReset = (session: Session) => {
      // A drawing board has its own controls beside the canvas.
      if (session.canvas.dataset.anchorBoard !== undefined) return;
      if (session.edited && !session.reset) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = session.canvas.id === 'stage-figure' ? 'btn dark quiet anchor-reset' : 'btn quiet anchor-reset';
        button.textContent = 'Reset';
        button.addEventListener('click', () => {
          note(session, 'reset');
          resetSession(session);
        });
        session.canvas.append(button);
        session.reset = button;
      } else if (!session.edited && session.reset) {
        session.reset.remove();
        session.reset = null;
      }
    };

    const startCursors = () => {
      if (cursorsStarted) return;
      cursorsStarted = true;
      for (const name of Object.keys(CURSORS) as CursorName[]) {
        if (!cursorIcons[name]) continue;
        cursorValue(name, cursorIcons[name])
          .then((value) => {
            cursorValues[name] = value;
            updateCursor();
          })
          .catch(() => {}); // The browser's own cursor stays in place.
      }
    };

    // In the pen tool, a selected anchor is what the next click chains from. Anchors partway along a path
    // can't extend it, so a chain from one starts as a new path at the same spot, using its outgoing handle.
    const startChain = (session: Session) => {
      const { selected } = session;
      const anchor = selected && anchorAt(session, selected);
      if (!selected || !anchor) return null;
      const shape = session.shapes[selected.shape];
      const subpath = shape.subpaths[selected.subpath];
      if (isEndpoint(subpath, selected.anchor)) return { subpath, index: selected.anchor };
      const branch: Subpath = { closed: false, anchors: [{ x: anchor.x, y: anchor.y, out: anchor.out ? { ...anchor.out } : null }] };
      shape.subpaths.push(branch);
      session.selected = { shape: selected.shape, subpath: shape.subpaths.length - 1, anchor: 0 };
      return { subpath: branch, index: 0 };
    };

    // The anchor a chain would connect to: anything other than the anchor it's chaining from.
    const chainTarget = (session: Session, label: string): Selected | null => {
      const { selected } = session;
      if (tool !== 'pen' || !selected || !anchorAt(session, selected)) return null;
      const [shape, path, anchor] = label.split('.').map(Number);
      if (shape === selected.shape && path === selected.subpath && anchor === selected.anchor) return null;
      return { shape, subpath: path, anchor };
    };

    const cursorFor = (session: Session, x: number, y: number, bending: boolean): CursorName => {
      if (drawing() && !drag?.handle) return 'draw';
      if (drag?.marquee || drag?.group) return 'cursor-simple';
      // Option shows the hollow arrow with the select tool. With the pen it shows the delete cursor, but only
      // over an anchor, since that's the only thing an Option-click deletes.
      if (optionHeld && tool === 'select') return 'cursor-hollow';
      if (optionHeld && !drag && document.elementFromPoint(x, y)?.closest('[data-anchor]')) return 'pen-delete';
      if (drag?.pen) return 'pen-tilted';
      if (drag?.handle) return 'cursor-simple';
      if (drag?.bend) return 'cursor-bezier';
      if (drag && tool === 'select') return 'cursor-simple';
      // Pressing an anchor would delete it, until the press turns into a drag that sets its curve.
      if (drag) return drag.moved ? 'pen-tilted' : drag.deleteOnRelease ? 'pen-delete' : 'pen-anchor';
      const under = document.elementFromPoint(x, y);
      if (under?.closest('[data-handle]')) return 'cursor-simple';
      const label = under?.closest<SVGElement>('[data-anchor]')?.dataset.anchor;
      if (label) {
        if (bending) return 'cursor-bezier';
        if (tool === 'select' || inGroup(session, parseLabel(label))) return 'cursor-simple';
        return 'pen-anchor';
      }
      // Command-dragging empty canvas draws a selection box.
      if (bending || tool === 'select') return 'cursor-simple';
      const box = session.svg.getBoundingClientRect();
      const size = viewSize(session);
      const point = { x: ((x - box.left) / box.width) * size, y: ((y - box.top) / box.height) * size };
      if (nearestSegment(session.shapes, point, pxToUnits(session, LINE_PX))) return 'pen-add';
      return 'pen-tilted';
    };

    const clearGhost = () => {
      ghost?.remove();
      ghost = null;
      preview?.remove();
      preview = null;
    };

    // The handle an open path's end grows from: the one facing away from the rest of the path.
    const leadingSide = (subpath: Subpath, index: number) => (index === 0 && subpath.anchors.length > 1 ? 'in' : 'out');

    // Hints at what a click would do: an anchor on a line, using the same search the click itself does,
    // or, when chaining, the segment the click would draw.
    const updateGhost = (session: Session, x: number, y: number) => {
      clearGhost();
      if (!drag) {
        guides = null;
        paintGuides(session);
      }
      const under = document.elementFromPoint(x, y);
      if (tool !== 'pen' || drag || under?.closest(CANVASES) !== session.canvas) return;
      if (under.closest('[data-handle], .anchor-reset')) return;
      const box = session.svg.getBoundingClientRect();
      const size = viewSize(session);
      const point = { x: ((x - box.left) / box.width) * size, y: ((y - box.top) / box.height) * size };
      const label = under.closest<SVGElement>('[data-anchor]')?.dataset.anchor;
      const line = label || (shiftHeld && session.selected) ? null : nearestSegment(session.shapes, point, pxToUnits(session, LINE_PX));
      if (line) {
        ghost = svgElement('circle', { class: 'anchor-dot anchor-ghost', cx: line.point.x, cy: line.point.y, r: pxToUnits(session, DOT_PX) });
        session.layer.append(ghost);
      }
      const { selected } = session;
      const chain = selected && session.shapes[selected.shape]?.subpaths[selected.subpath];
      if (!selected || !chain || !chain.anchors[selected.anchor]) return;
      const target = label ? chainTarget(session, label) : null;
      if (label && !target) return;
      const from = chain.anchors[selected.anchor];
      const start = from[isEndpoint(chain, selected.anchor) ? leadingSide(chain, selected.anchor) : 'out'] ?? from;
      const other = target && session.shapes[target.shape].subpaths[target.subpath];
      const reached = other && other.anchors[target.anchor];
      const end = reached ?? line?.point ?? (shiftHeld ? constrainAngle(from, point, 1 / SNAP, size) : align(session, snap(session, point), new Set([from])));
      const arrive = reached && isEndpoint(other, target!.anchor) ? (reached[leadingSide(other, target!.anchor)] ?? reached) : end;
      preview = svgElement('path', { class: 'anchor-preview', d: `M${from.x} ${from.y}C${start.x} ${start.y} ${arrive.x} ${arrive.y} ${end.x} ${end.y}` });
      session.layer.prepend(preview);
      paintGuides(session);
    };

    function updateCursor(bending = false) {
      if (!active || !lastPointer) return;
      const name = cursorFor(active, lastPointer.x, lastPointer.y, bending);
      active.canvas.style.cursor = cursorValues[name] ?? CURSORS[name].fallback;
      updateGhost(active, lastPointer.x, lastPointer.y);
    }

    const render = (session: Session) => {
      if (mirror) syncTwins(session);
      if (session.edited) {
        session.art.innerHTML = shapesMarkup(session.shapes);
        saved.set(session.key, session.shapes);
      }
      drawLayer(session);
      updateReset(session);
      // The splash page saves what's drawn here.
      session.canvas.dispatchEvent(new CustomEvent('anchoreditor:change', { detail: { shapes: session.shapes, edited: session.edited } }));
    };

    const record = (session: Session) => {
      session.history.push(copy(session.shapes));
      session.future = [];
      if (!session.edited) track('icon_edit_start', { splash: 'anchorBoard' in session.canvas.dataset });
      session.edited = true;
    };

    const resetSession = (session: Session) => {
      session.shapes = copy(session.original);
      session.history = [];
      session.future = [];
      session.group = [];
      session.selected = null;
      session.edited = false;
      saved.delete(session.key);
      session.art.innerHTML = shapesMarkup(session.shapes);
      render(session);
    };

    const restore = (session: Session, shapes: Shape[]) => {
      session.shapes = shapes;
      session.group = [];
      // Keep the anchor selected if it's still there, so its handles stay available.
      if (session.selected && !anchorAt(session, session.selected)) session.selected = null;
      session.edited = session.history.length > 0;
      if (!session.edited) saved.delete(session.key);
      session.art.innerHTML = shapesMarkup(session.shapes);
      render(session);
    };

    const undo = (session: Session) => {
      const previous = session.history.pop();
      if (!previous) return;
      session.future.push(session.shapes);
      restore(session, previous);
    };

    const redo = (session: Session) => {
      const next = session.future.pop();
      if (!next) return;
      session.history.push(session.shapes);
      restore(session, next);
    };

    const removeGroup = (session: Session) => {
      record(session);
      // Last first, so each removal leaves the others' places unchanged.
      [...session.group].sort((a, b) => b.anchor - a.anchor).forEach(({ shape, subpath, anchor }) => deleteAnchor(session.shapes[shape].subpaths[subpath], anchor));
      session.group = [];
      session.selected = null;
      render(session);
    };

    const removeSelected = (session: Session, via: string) => {
      const { selected } = session;
      if (!selected) return;
      note(session, 'anchor_delete', { via });
      record(session);
      const shape = session.shapes[selected.shape];
      deleteAnchor(shape.subpaths[selected.subpath], selected.anchor);
      session.selected = null;
      render(session);
    };

    function open(canvas: HTMLElement): Session | null {
      const svg = canvas.querySelector<SVGSVGElement>('svg');
      if (!svg || uneditable.has(svg)) return null;
      const existing = sessions.get(canvas);
      if (existing?.svg === svg) return existing;

      const key = svg.innerHTML;
      const original = parseBody(key);
      // A canvas marked as a drawing board can start empty, and always starts from what it's given.
      const board = canvas.dataset.anchorBoard !== undefined;
      if (!original || (original.length === 0 && !board)) {
        uneditable.add(svg);
        return null;
      }
      existing?.reset?.remove();
      const art = svgElement('g', {}) as SVGGElement;
      art.innerHTML = key;
      const layer = svgElement('g', { class: 'anchor-layer' }) as SVGGElement;
      svg.replaceChildren(art, layer);
      svg.removeAttribute('aria-hidden');

      const remembered = board ? undefined : saved.get(key);
      const session: Session = {
        canvas,
        svg,
        key,
        original,
        shapes: remembered ?? copy(original),
        history: remembered ? [copy(original)] : [],
        future: [],
        selected: null,
        group: [],
        twins: new Map(),
        edited: Boolean(remembered),
        art,
        layer,
        reset: null,
      };
      sessions.set(canvas, session);
      canvas.dataset.anchors = '';
      startCursors();

      // The large view swaps its drawing as you step through icons, so follow it.
      if (!observed.has(canvas)) {
        observed.add(canvas);
        new MutationObserver(() => {
          if (canvas.querySelector('svg') !== sessions.get(canvas)?.svg) open(canvas);
        }).observe(canvas, { childList: true });
      }
      render(session);
      return session;
    }

    const onPointerOver = (event: PointerEvent) => {
      const canvas = (event.target as Element).closest?.<HTMLElement>(CANVASES);
      if (!canvas) return;
      const session = open(canvas);
      if (session) {
        active = session;
        // Show the right cursor on arrival, before the pointer moves again.
        if (event.pointerType !== 'touch') {
          lastPointer = { x: event.clientX, y: event.clientY };
          updateCursor(event.metaKey || event.ctrlKey);
        }
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const canvas = (event.target as Element).closest?.<HTMLElement>(CANVASES);
      if (canvas) active = open(canvas) ?? active;
    };

    const onPointerDown = (event: PointerEvent) => {
      const element = event.target as Element;
      if (element.closest?.('.anchor-reset')) return;
      const canvas = element.closest?.<HTMLElement>(CANVASES);
      if (!canvas) {
        // Clicking away finishes editing.
        if (active?.selected) {
          active.selected = null;
          drawLayer(active);
        }
        document.querySelectorAll<HTMLElement>('[data-anchors-touch]').forEach((touched) => delete touched.dataset.anchorsTouch);
        return;
      }
      // Control-clicking counts as a left click, because on a Mac it would otherwise be a right click.
      if (event.button !== 0 && !event.ctrlKey) return;
      const session = open(canvas);
      if (!session) return;
      active = session;

      // On touch, the first tap wakes the canvas, so a finger crossing it can still scroll the page.
      if (event.pointerType === 'touch' && canvas.dataset.anchorsTouch === undefined) {
        canvas.dataset.anchorsTouch = '';
        drawLayer(session, true);
        note(session, 'touch_wake');
        return;
      }

      event.preventDefault();
      const point = pointFrom(session, event);
      const place = snap(session, point);
      const handleSide = element.closest?.<SVGElement>('[data-handle]')?.dataset.handle as 'in' | 'out' | undefined;
      const label = element.closest?.<SVGElement>('[data-anchor]')?.dataset.anchor;
      const command = event.metaKey || event.ctrlKey;
      const start = { x: event.clientX, y: event.clientY };
      const capture = () => {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {}
      };
      // Command-dragging empty canvas draws a box that selects the anchors inside it. Shift adds to what's selected.
      if (command && !label && !handleSide) {
        lastPress = null;
        if (!event.shiftKey) session.group = [];
        session.selected = null;
        drag = { session, start, moved: false, recorded: true, bend: false, marquee: { from: point, to: point } };
        drawLayer(session);
        capture();
        updateCursor();
        return;
      }
      // With the select tool, Shift-click adds an anchor to the selection, or takes it out if it's already in.
      if (tool === 'select' && event.shiftKey && label && !command && !handleSide) {
        lastPress = null;
        const here = parseLabel(label);
        const same = (g: Selected) => g.shape === here.shape && g.subpath === here.subpath && g.anchor === here.anchor;
        const current = session.group.length ? session.group : session.selected ? [session.selected] : [];
        const removing = current.some(same);
        const next = removing ? current.filter((g) => !same(g)) : [...current, here];
        session.selected = next.length === 1 ? next[0] : null;
        session.group = next.length > 1 ? next : [];
        note(session, removing ? 'select_remove' : 'select_add', { count: next.length });
        drawLayer(session);
        // Adding one can carry straight on into dragging the whole selection.
        if (!removing && session.group.length) {
          const pressed = anchorAt(session, here)!;
          const from = session.group.map((g) => anchorAt(session, g)).map((a) => ({ x: a?.x ?? 0, y: a?.y ?? 0 }));
          drag = { session, start, moved: false, recorded: false, bend: false, group: { pressed: { x: pressed.x, y: pressed.y }, from } };
          capture();
        }
        updateCursor();
        return;
      }
      if (session.group.length) {
        // Dragging any of the selected anchors moves them all.
        if (label && !command && inGroup(session, parseLabel(label))) {
          const pressed = anchorAt(session, parseLabel(label))!;
          const from = session.group.map((g) => anchorAt(session, g)).map((a) => ({ x: a?.x ?? 0, y: a?.y ?? 0 }));
          drag = { session, start, moved: false, recorded: false, bend: false, group: { pressed: { x: pressed.x, y: pressed.y }, from } };
          capture();
          updateCursor();
          return;
        }
        // Clicking anywhere else lets go of them.
        session.group = [];
        if (!label) {
          drawLayer(session);
          updateCursor();
          return;
        }
      }
      if (drawing() && !command && !handleSide) {
        lastPress = null;
        session.selected = null;
        const from = align(session, place, new Set());
        guides = null;
        drag = { session, start, moved: false, recorded: false, bend: false, draw: { kind: tool as DrawKind, from, shape: -1 } };
        drawLayer(session);
        capture();
        return;
      }
      if (handleSide && session.selected) {
        lastPress = null;
        drag = { session, start: { x: event.clientX, y: event.clientY }, moved: false, recorded: false, bend: false, handle: handleSide };
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {}
        updateCursor();
        return;
      }
      let inserted = false;
      let penPlaced = false;
      let reversed = false;

      if (label) {
        const [shape, subpath, anchor] = label.split('.').map(Number);
        const now = performance.now();
        const target = event.metaKey || event.ctrlKey || event.altKey ? null : chainTarget(session, label);
        if (target) {
          const reached = session.shapes[target.shape].subpaths[target.subpath].anchors[target.anchor];
          record(session);
          const chain = startChain(session)!;
          const other = session.shapes[target.shape].subpaths[target.subpath];
          if (other === chain.subpath && isEndpoint(other, target.anchor)) {
            // Back to the other end of this path, which closes it.
            other.closed = true;
            session.selected = null;
            note(session, 'path_close');
          } else if (other !== chain.subpath && isEndpoint(other, target.anchor)) {
            joinSubpaths(chain.subpath, chain.index, other, target.anchor);
            // Joined paths are no longer one half of a mirrored pair.
            delete chain.subpath.twin;
            delete other.twin;
            session.selected = null;
            note(session, 'path_join');
          } else {
            // Anchors partway along a path can't branch, so the chain adds its own point on top of them.
            const added = extendSubpath(chain.subpath, chain.index, { x: reached.x, y: reached.y });
            session.selected = { ...session.selected!, anchor: added };
            note(session, 'connect_anchor');
          }
          render(session);
          lastPointer = { x: event.clientX, y: event.clientY };
          updateCursor();
          return;
        }
        session.selected = { shape, subpath, anchor };
        // Command-drag sets the curve through this anchor. See onPointerMove and onPointerUp.
        if (event.metaKey || event.ctrlKey) {
          lastPress = null;
          render(session);
          drag = { session, start: { x: event.clientX, y: event.clientY }, moved: false, recorded: false, bend: true };
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {}
          return;
        }
        // With the pen, a click on an anchor picks it up to keep drawing from, and Option-click deletes it.
        // A drag sets its curve: an end anchor gets just the handle for the next segment, ready to chain
        // from, and any other anchor gets a smooth pair.
        if (tool === 'pen') {
          lastPress = null;
          const pressedPath = session.shapes[shape].subpaths[subpath];
          const endpointSide = isEndpoint(pressedPath, anchor) ? leadingSide(pressedPath, anchor) : undefined;
          render(session);
          drag = { session, start: { x: event.clientX, y: event.clientY }, moved: false, recorded: false, bend: false, penAnchor: true, deleteOnRelease: event.altKey, endSide: endpointSide };
          updateCursor();
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {}
          return;
        }
        if (lastPress?.key === label && now - lastPress.at < DOUBLE_MS) {
          lastPress = null;
          removeSelected(session, 'double_click');
          return;
        }
        lastPress = { key: label, at: now };
        note(session, 'anchor_select');
      } else {
        const line = event.shiftKey && session.selected ? null : nearestSegment(session.shapes, point, pxToUnits(session, LINE_PX));
        if (tool === 'select') {
          session.selected = null;
        } else if (line) {
          record(session);
          const onLine = session.shapes[line.shape].subpaths[line.subpath];
          const chain = startChain(session);
          const index = insertAnchor(onLine, line.segment, line.t);
          note(session, chain ? 'connect_line' : 'anchor_insert');
          if (chain) {
            // Connect to the line: it gets a new anchor, and the chain adds a point on top of it and carries on.
            const fromIndex = onLine === chain.subpath && index <= chain.index ? chain.index + 1 : chain.index;
            const reached = onLine.anchors[index];
            reversed = fromIndex === 0 && chain.subpath.anchors.length > 1;
            const added = extendSubpath(chain.subpath, fromIndex, { x: reached.x, y: reached.y });
            session.selected = { ...session.selected!, anchor: added };
          } else {
            session.selected = { shape: line.shape, subpath: line.subpath, anchor: index };
          }
          inserted = true;
          penPlaced = true;
        } else if (session.selected) {
          record(session);
          const from = anchorAt(session, session.selected);
          const next = event.shiftKey && from ? constrainAngle(from, point, 1 / SNAP, viewSize(session)) : align(session, place, new Set([from]));
          note(session, 'pen_point', { shift: event.shiftKey, guide: !event.shiftKey && guides !== null });
          guides = null;
          const chain = startChain(session)!;
          reversed = chain.index === 0 && chain.subpath.anchors.length > 1;
          session.selected = { ...session.selected, anchor: extendSubpath(chain.subpath, chain.index, next) };
          inserted = true;
          penPlaced = true;
        } else {
          record(session);
          session.selected = { shape: addPath(session, { closed: false, anchors: [place] }), subpath: 0, anchor: 0 };
          note(session, 'path_start');
          inserted = true;
          penPlaced = true;
        }
      }

      render(session);
      lastPointer = { x: event.clientX, y: event.clientY };
      updateCursor();
      if (session.selected) {
        const pressed = anchorAt(session, session.selected);
        drag = { session, start: { x: event.clientX, y: event.clientY }, moved: false, recorded: inserted, bend: penPlaced, pen: penPlaced, reversed, origin: pressed && { x: pressed.x, y: pressed.y } };
        updateCursor();
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {}
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        lastPointer = { x: event.clientX, y: event.clientY };
        const optionChanged = optionHeld !== event.altKey;
        optionHeld = event.altKey;
        shiftHeld = event.shiftKey;
        if (drag && optionChanged) updateCursor();
        if (!drag && (event.target as Element).closest?.(CANVASES)) updateCursor(event.metaKey || event.ctrlKey);
        else if (!drag) clearGhost();
      }
      if (!drag) return;
      const { session } = drag;
      if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < DRAG_PX) return;
      const size = viewSize(session);
      const fit = (n: number) => Math.min(size, Math.max(0, n));
      if (drag.marquee) {
        drag.moved = true;
        drag.marquee.to = pointFrom(session, event);
        drawLayer(session);
        return;
      }
      if (drag.group) {
        if (!drag.recorded) {
          record(session);
          drag.recorded = true;
        }
        drag.moved = true;
        const { pressed, from } = drag.group;
        const members = session.group.map((g) => anchorAt(session, g));
        const point = pointFrom(session, event);
        const target = event.shiftKey ? constrainAngle(pressed, point, 1 / SNAP) : align(session, snap(session, point), new Set(members));
        if (event.shiftKey) guides = null;
        // The whole selection stops at the canvas edge together.
        const xs = from.map((p) => p.x);
        const ys = from.map((p) => p.y);
        const dx = Math.min(size - Math.max(...xs), Math.max(-Math.min(...xs), target.x - pressed.x));
        const dy = Math.min(size - Math.max(...ys), Math.max(-Math.min(...ys), target.y - pressed.y));
        members.forEach((member, i) => member && moveAnchor(member, { x: from[i].x + dx, y: from[i].y + dy }));
        render(session);
        return;
      }
      if (drag.draw) {
        const { kind, from } = drag.draw;
        if (!drag.recorded) {
          record(session);
          drag.recorded = true;
          drag.draw.shape = addPath(session, { closed: false, anchors: [] });
        }
        drag.moved = true;
        const shape = session.shapes[drag.draw.shape];
        const point = pointFrom(session, event);
        // Shift makes a square or circle, or keeps a line straight or at 45°. Option draws from the centre.
        const straight = kind === 'line' && event.shiftKey;
        const to = straight ? constrainAngle(from, point, 1 / SNAP) : align(session, snap(session, point), new Set(shape.subpaths.flatMap((s) => s.anchors)));
        if (straight) guides = null;
        const box = dragBox(from, to, kind !== 'line' && event.shiftKey, event.altKey).map((p) => ({ x: fit(p.x), y: fit(p.y) })) as [Point, Point];
        const made = kind === 'rectangle' ? rectangleSubpath(box) : kind === 'ellipse' ? ellipseInBox(box) : lineSubpath(box);
        shape.subpaths[0].closed = made.closed;
        shape.subpaths[0].anchors = made.anchors;
        render(session);
        return;
      }
      const anchor = session.selected && anchorAt(session, session.selected);
      if (!anchor) return;
      if (!drag.recorded) {
        record(session);
        drag.recorded = true;
      }
      drag.moved = true;
      lastPress = null;
      updateCursor();
      if (drag.bend || drag.handle || drag.penAnchor) {
        // Handles can reach past the canvas, so they round to the grid without being kept inside it.
        const point = pointFrom(session, event);
        const place = event.shiftKey ? constrainAngle(anchor, point, 1 / SNAP) : { x: Math.round(point.x * SNAP) / SNAP, y: Math.round(point.y * SNAP) / SNAP };
        // Option moves one handle alone, which makes a corner. While drawing with the pen, that's the handle
        // under the pointer: the other side stays where it was when Option went down.
        if (drag.handle) moveHandle(anchor, drag.handle, place, event.altKey);
        else if (drag.endSide) moveHandle(anchor, drag.endSide, place, true);
        else if (event.altKey) moveHandle(anchor, drag.reversed ? 'in' : 'out', place, true);
        else setHandles(anchor, place, drag.reversed);
      } else {
        const point = pointFrom(session, event);
        // Shift slides the anchor along a straight or 45° line from where it started.
        const skip = new Set([anchor, counterpart(session, session.selected!)]);
        moveAnchor(anchor, event.shiftKey && drag.origin ? constrainAngle(drag.origin, point, 1 / SNAP, size) : align(session, snap(session, point), skip));
        if (event.shiftKey) guides = null;
      }
      render(session);
    };

    const onPointerUp = () => {
      guides = null;
      if (drag?.marquee) {
        const { session, moved } = drag;
        const { from, to } = drag.marquee;
        drag = null;
        if (moved) {
          const [left, right] = [Math.min(from.x, to.x), Math.max(from.x, to.x)];
          const [top, bottom] = [Math.min(from.y, to.y), Math.max(from.y, to.y)];
          session.shapes.forEach(({ subpaths }, shape) => subpaths.forEach(({ anchors }, subpath) => anchors.forEach(({ x, y }, anchor) => {
            const here = { shape, subpath, anchor };
            if (x >= left && x <= right && y >= top && y <= bottom && !inGroup(session, here)) session.group.push(here);
          })));
        }
        // One anchor is an ordinary selection, with its handles.
        if (session.group.length === 1) [session.selected, session.group] = [session.group[0], []];
        if (moved) note(session, 'select_box', { count: session.group.length || (session.selected ? 1 : 0) });
        drawLayer(session);
        updateCursor();
        return;
      }
      if (drag?.draw) {
        const { session, recorded } = drag;
        const drawn = session.shapes[drag.draw.shape]?.subpaths[0];
        const kind = drag.draw.kind;
        drag = null;
        if (recorded && drawn) {
          const xs = drawn.anchors.map((a) => a.x);
          const ys = drawn.anchors.map((a) => a.y);
          const width = Math.max(...xs) - Math.min(...xs);
          const height = Math.max(...ys) - Math.min(...ys);
          // A shape with no width or height, or a line with no length, isn't kept.
          if (kind === 'line' ? !width && !height : !width || !height) {
            undo(session);
            session.future.pop();
            note(session, 'shape_discard', { kind });
          } else {
            render(session);
            note(session, 'shape', { kind, ...(kind === 'line' ? { straight: shiftHeld } : { even: shiftHeld }), centered: optionHeld });
          }
        } else {
          drawLayer(session);
        }
        updateCursor();
        return;
      }
      if (drag?.deleteOnRelease && !drag.moved) {
        const { session } = drag;
        drag = null;
        removeSelected(session, 'option_click');
        updateCursor();
        return;
      }
      // A plain click leaves the anchor selected, so the next click carries on drawing from it.
      if (drag?.penAnchor && !drag.moved) note(drag.session, 'continue_from_anchor');
      // Command-clicking without dragging takes the curve back out. A plain click from the pen leaves it,
      // because an anchor added to a curved line needs its handles to keep the shape.
      if (drag?.bend && !drag.pen && !drag.moved) {
        const { session } = drag;
        const anchor = session.selected && anchorAt(session, session.selected);
        if (anchor && (anchor.in || anchor.out)) {
          record(session);
          clearHandles(anchorAt(session, session.selected!)!);
          render(session);
          note(session, 'curve_clear');
        }
      }
      if (drag?.moved) {
        const { session } = drag;
        if (drag.group) note(session, 'group_move', { count: session.group.length, shift: shiftHeld });
        else if (drag.handle) note(session, 'handle_drag', { independent: optionHeld, shift: shiftHeld });
        else if (drag.bend || drag.penAnchor) note(session, 'curve_drag', { via: drag.pen ? 'pen_drag' : drag.penAnchor ? 'pen_on_anchor' : 'command_drag', shift: shiftHeld });
        else note(session, 'anchor_move', { shift: shiftHeld });
      }
      const ended = drag?.session;
      drag = null;
      if (ended) drawLayer(ended);
      updateCursor();
    };

    // Pressing or releasing Command changes the cursor without the pointer moving.
    const onModifierChange = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        optionHeld = event.type === 'keydown';
        updateCursor(event.metaKey || event.ctrlKey);
      } else if (event.key === 'Shift' && !drag) {
        shiftHeld = event.type === 'keydown';
        updateCursor(event.metaKey || event.ctrlKey);
      } else if ((event.key === 'Meta' || event.key === 'Control') && !drag) {
        updateCursor(event.type === 'keydown');
      }
    };

    // Switching away while Option is down means its release never reaches this page.
    const onBlur = () => {
      optionHeld = false;
      shiftHeld = false;
      updateCursor();
    };

    // On a Mac, Control-click opens the context menu, which would interrupt Control-drag.
    const onContextMenu = (event: MouseEvent) => {
      if (event.ctrlKey && (event.target as Element).closest?.(CANVASES)) event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const session = active;
      const key = event.key.toLowerCase();
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      const typing = (event.target as Element).closest?.('input, textarea, [contenteditable]');
      if (plain && !typing && !drag && document.querySelector(CANVASES)) {
        if (key === 'v' || key === 'p' || key in DRAW_KEYS) {
          const next = key === 'v' ? 'select' : key === 'p' ? 'pen' : DRAW_KEYS[key as keyof typeof DRAW_KEYS];
          if (next !== tool) note(active, 'tool', { to: next, from: tool });
          tool = next;
          updateCursor();
          return;
        }
        if (key === 'm') {
          mirror = !mirror;
          note(active, 'mirror', { on: mirror });
          if (active) drawLayer(active);
          updateCursor();
          return;
        }
      }
      if (!session || (event.target as Element).closest?.('input, textarea')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && session.history.length > 0) {
        event.preventDefault();
        undo(session);
        note(session, 'undo');
        return;
      }
      // Shift-Command-Z, or Control-Y on Windows, puts back what undo took away.
      if ((event.metaKey || event.ctrlKey) && ((key === 'z' && event.shiftKey) || (event.ctrlKey && key === 'y')) && session.future.length > 0) {
        event.preventDefault();
        redo(session);
        note(session, 'redo');
        return;
      }
      if (session.group.length) {
        const step = event.shiftKey ? 1 : 1 / SNAP;
        const by = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[event.key];
        if (event.key === 'Delete' || event.key === 'Backspace') {
          note(session, 'group_delete', { count: session.group.length });
          removeGroup(session);
        } else if (event.key === 'Escape') {
          note(session, 'select_clear');
          session.group = [];
          drawLayer(session);
        } else if (by) {
          if (!event.repeat) note(session, 'group_nudge', { count: session.group.length, step });
          record(session);
          for (const g of session.group) {
            const member = anchorAt(session, g);
            if (member) moveAnchor(member, snap(session, { x: member.x + by.x, y: member.y + by.y }));
          }
          render(session);
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const label = (event.target as Element).closest?.<SVGElement>('[data-anchor]')?.dataset.anchor;
      if (label && !session.selected) {
        const [shape, subpath, anchor] = label.split('.').map(Number);
        session.selected = { shape, subpath, anchor };
      }
      if (!session.selected) return;
      const anchor = anchorAt(session, session.selected);
      if (!anchor) return;
      const step = event.shiftKey ? 1 : 1 / SNAP;
      const moves: Record<string, Point> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      };
      if (event.key === 'Delete' || event.key === 'Backspace') {
        removeSelected(session, 'key');
      } else if (event.key === 'Escape') {
        // Stops the chain and keeps everything drawn so far.
        note(session, 'chain_end');
        session.selected = null;
        drawLayer(session);
        updateCursor();
      } else if (moves[event.key]) {
        if (!event.repeat) note(session, 'anchor_nudge', { step });
        record(session);
        const by = moves[event.key];
        moveAnchor(anchorAt(session, session.selected)!, snap(session, { x: anchor.x + by.x, y: anchor.y + by.y }));
        render(session);
        refocusSelected(session);
      } else {
        return;
      }
      // Arrow keys step through icons in the large view, so keep them from doing both.
      event.preventDefault();
      event.stopPropagation();
    };

    // Ready the cursors up front wherever there's a canvas, so the first hover already shows the pen.
    if (document.querySelector(CANVASES)) startCursors();

    // A drawing board's page can reset it, and tell it what was just saved, which is then what Reset returns to.
    const onBoardReset = (event: Event) => {
      const session = sessions.get(event.target as HTMLElement);
      if (session) resetSession(session);
    };
    const onBoardSaved = (event: Event) => {
      const session = sessions.get(event.target as HTMLElement);
      if (!session) return;
      session.original = copy(session.shapes);
      session.history = [];
      session.future = [];
      session.edited = false;
    };
    document.addEventListener('anchoreditor:reset', onBoardReset);
    document.addEventListener('anchoreditor:saved', onBoardSaved);

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('blur', onBlur);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keydown', onModifierChange);
    document.addEventListener('keyup', onModifierChange);
    return () => {
      document.removeEventListener('anchoreditor:reset', onBoardReset);
      document.removeEventListener('anchoreditor:saved', onBoardSaved);
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keydown', onModifierChange);
      document.removeEventListener('keyup', onModifierChange);
    };
  }, [cursorIcons]);

  return null;
}

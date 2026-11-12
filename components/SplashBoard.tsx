'use client';

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type SavedPath, type Shape, pathsToShapes, shapesMarkup, shapesToPaths } from '@/lib/anchors';
import { track } from '@/lib/track';
import { flyToList, reducedMotion } from './splashFlight';

const API = '/splash/api/icons';
const STORAGE_KEY = 'splash-icons';

type Icon = { id: number; paths: SavedPath[] };
type Store = { current: number | null; tokens: Record<string, string> };

const markupOf = (paths: SavedPath[]) => (paths.length ? shapesMarkup(pathsToShapes(paths)) : '');

function readStore(): Store {
  try {
    const store = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (store && typeof store.tokens === 'object' && store.tokens) return store;
  } catch {}
  return { current: null, tokens: {} };
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {} // Without storage, saving again still works until the page is closed.
}

// The set's own icons, drawn a little heavier so they hold up on the buttons.
const ButtonIcon = ({ body }: { body: string }) => (
  <svg className="i weighted" viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: body }} />
);

type ButtonIcons = { reset: string; save: string; new: string; download: string; close?: string; drawn?: string };

// With sheet, the board goes inside the site's own header, and the visitors' icons open in a sheet that
// slides in from the side. Without it, it's the standalone drawing page, with the list below.
export function SplashBoard({ masthead, specimen, buttonIcons, sheet = false }: { masthead: ReactNode; specimen?: ReactNode; buttonIcons: ButtonIcons; sheet?: boolean }) {
  const figure = useRef<HTMLDivElement>(null);
  const store = useRef<Store>({ current: null, tokens: {} });
  const loaded = useRef('[]');
  const latest = useRef('[]');
  // A saved icon waiting to fly from the canvas into its cell, once the list has rendered it.
  const flight = useRef<{ id: number; markup: string; from: DOMRect } | null>(null);
  // What's on the board when it's loaded, and a key so each load gets a fresh canvas.
  const [board, setBoard] = useState<{ key: number; markup: string }>({ key: 0, markup: '' });
  const [paths, setPaths] = useState<SavedPath[]>([]);
  const [savedPaths, setSavedPaths] = useState('[]');
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [icons, setIcons] = useState<Icon[]>([]);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [countText, setCountText] = useState('');
  // The empty canvas explains itself until it's first pressed.
  const [touched, setTouched] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetClose = useRef<HTMLButtonElement>(null);
  const sheetOpener = useRef<HTMLButtonElement>(null);

  const dirty = JSON.stringify(paths) !== savedPaths;

  const load = useCallback((id: number | null, drawing: SavedPath[]) => {
    setCurrentId(id);
    setPaths(drawing);
    setSavedPaths(JSON.stringify(drawing));
    loaded.current = JSON.stringify(drawing);
    latest.current = loaded.current;
    setBoard((previous) => ({ key: previous.key + 1, markup: markupOf(drawing) }));
    store.current.current = id;
    writeStore(store.current);
  }, []);

  const forget = useCallback((id: number) => {
    delete store.current.tokens[id];
    if (store.current.current === id) store.current.current = null;
    writeStore(store.current);
    setIcons((list) => list.filter((icon) => icon.id !== id));
  }, []);

  const loadPage = useCallback(async (before?: number) => {
    try {
      const response = await fetch(before ? `${API}?before=${before}` : API);
      if (!response.ok) throw new Error(String(response.status));
      const page = await response.json();
      setTotal(page.total);
      setMore(page.more);
      setIcons((list) => {
        const seen = new Set(list.map((icon) => icon.id));
        return [...list, ...page.icons.filter((icon: Icon) => !seen.has(icon.id))];
      });
      setCountText('');
    } catch {
      setCountText("The saved icons didn't load. Reload to try again.");
    }
  }, []);

  // The editor reports every change to what's drawn.
  useEffect(() => {
    const canvas = figure.current;
    if (!canvas) return;
    const onChange = (event: Event) => {
      const { shapes, edited } = (event as CustomEvent<{ shapes: Shape[]; edited: boolean }>).detail;
      // Back to what was loaded, by waking the canvas or by Reset, counts as no change.
      const next = edited ? JSON.stringify(shapesToPaths(shapes)) : loaded.current;
      if (next === latest.current) return;
      latest.current = next;
      setPaths(JSON.parse(next));
      setStatus('');
    };
    canvas.addEventListener('anchoreditor:change', onChange);
    return () => canvas.removeEventListener('anchoreditor:change', onChange);
  }, []);

  useEffect(() => {
    // Each visit starts on a blank canvas. This browser's own icons stay a click away in the list.
    store.current = readStore();
    loadPage();
  }, [loadPage]);

  // The list now has the saved icon's cell, so it can fly there. Runs before paint, so the cell never shows early.
  useLayoutEffect(() => {
    const pending = flight.current;
    if (!pending) return;
    flight.current = null;
    const cell = document.querySelector<HTMLElement>(`.splash-grid [data-id="${pending.id}"]`);
    if (cell) flyToList({ from: pending.from, markup: pending.markup, cell, art: figure.current?.querySelector('svg'), scroll: !sheet });
  }, [icons, sheet]);

  // The sheet: Escape closes it, and focus moves into it and back to whatever opened it.
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    sheetOpener.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!sheetOpen) return;
    sheetClose.current?.focus({ preventScroll: true });
    // Listens ahead of the editor, which would otherwise take Escape to end the path just drawn.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeSheet();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sheetOpen, closeSheet]);

  // What's on the canvas now, saved or not, as a 16px SVG in the same form as the set's own files.
  const download = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">${markupOf(paths)}</svg>\n`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = currentId === null ? 'my-icon.svg' : `my-icon-${currentId}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    track('icon_download', { id: currentId, saved: !dirty, paths: paths.length });
  };

  const discardOk = () => !dirty || !paths.length || window.confirm('Discard your unsaved changes?');

  const save = async () => {
    setSaving(true);
    setStatus('');
    const id = currentId;
    const drawing = paths;
    let message = '';
    try {
      const response = await fetch(id === null ? API : `${API}/${id}`, {
        method: id === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', ...(id === null ? {} : { 'X-Edit-Token': store.current.tokens[id] }) },
        body: JSON.stringify({ paths: drawing }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) track('icon_save_failed', { status: response.status });
      if (response.ok) {
        const saved = id ?? result.id;
        track('icon_save', { new: id === null, id: saved, paths: drawing.length, anchors: drawing.reduce((sum, path) => sum + path.anchors.length, 0) });
        if (id === null) {
          store.current.tokens[saved] = result.token;
          setTotal((count) => count + 1);
        }
        store.current.current = saved;
        writeStore(store.current);
        setCurrentId(saved);
        setSavedPaths(JSON.stringify(drawing));
        loaded.current = JSON.stringify(drawing);
        latest.current = loaded.current;
        if (figure.current && !reducedMotion()) flight.current = { id: saved, markup: markupOf(drawing), from: figure.current.getBoundingClientRect() };
        // In the site's header, the icon lands in the sheet, so it opens to catch it.
        if (sheet) setSheetOpen(true);
        figure.current?.dispatchEvent(new CustomEvent('anchoreditor:saved', { bubbles: true }));
        setIcons((list) => (id === null ? [{ id: saved, paths: drawing }, ...list] : list.map((icon) => (icon.id === id ? { id, paths: drawing } : icon))));
      } else if (response.status === 404 && id !== null) {
        forget(id);
        setTotal((count) => Math.max(0, count - 1));
        load(null, []);
        message = 'This icon was removed.';
      } else if (response.status === 403 && id !== null) {
        forget(id);
        setCurrentId(null);
        setSavedPaths('[]');
        message = "This browser can't change that icon. Save to add it as a new one.";
      } else {
        message = result.error ?? "That didn't save. Try again.";
      }
    } catch {
      track('icon_save_failed', { status: 'network' });
      message = "That didn't save. Check your connection and try again.";
    }
    setSaving(false);
    setStatus(message);
  };

  const openOwn = async (id: number) => {
    if (id === currentId || !discardOk()) return;
    try {
      const response = await fetch(`${API}/${id}`);
      if (response.status === 404) {
        forget(id);
        setTotal((count) => Math.max(0, count - 1));
        setStatus('This icon was removed.');
      } else if (response.ok) {
        load(id, (await response.json()).paths);
        setStatus('');
        if (sheet) setSheetOpen(false);
        track('icon_open', { id });
      }
    } catch {
      setStatus("That icon didn't load. Try again.");
    }
  };

  const startNew = () => {
    if (!discardOk()) return;
    load(null, []);
    setStatus('');
    track('icon_new');
  };

  const editor = (
    <div className="splash-editor">
      <div className="figure" ref={figure} data-anchor-board="" onPointerDown={() => setTouched(true)}>
        <svg key={board.key} viewBox="0 0 16 16" fill="none" dangerouslySetInnerHTML={{ __html: board.markup }} />
        {!touched && !paths.length && currentId === null && (
          <p className="splash-hint" aria-hidden="true">
            <strong>Draw your own</strong>
          </p>
        )}
      </div>
      <div className="actions splash-actions">
        {dirty && <button className="btn quiet splash-icon-btn" type="button" aria-label="Reset" title="Reset" onClick={() => { track('icon_reset'); figure.current?.dispatchEvent(new CustomEvent('anchoreditor:reset', { bubbles: true })); }}><ButtonIcon body={buttonIcons.reset} /></button>}
        {!dirty && currentId !== null && <button className="btn quiet splash-icon-btn" type="button" aria-label="New icon" title="New icon" onClick={startNew}><ButtonIcon body={buttonIcons.new} /></button>}
        {/* In the site's header, the visitors' icons are a button away, until there's something to reset. */}
        {sheet && !dirty && currentId === null && (
          <button className="splash-sheet-open" type="button" ref={sheetOpener} aria-expanded={sheetOpen} aria-controls="drawn-sheet" onClick={() => { setSheetOpen(true); track('drawn_sheet_open'); }}>
            {buttonIcons.drawn && <ButtonIcon body={buttonIcons.drawn} />}
            <span>Drawn by visitors</span>
            {!countText && total > 0 && <span className="n">{total}</span>}
          </button>
        )}
        {paths.length > 0 && <button className="btn quiet splash-download splash-icon-btn" type="button" aria-label="Download SVG" title="Download SVG" onClick={download}><ButtonIcon body={buttonIcons.download} /></button>}
        {dirty && paths.length > 0 && <button className="btn splash-save splash-icon-btn" type="button" aria-label="Save" title="Save" disabled={saving} onClick={save}><ButtonIcon body={buttonIcons.save} /></button>}
      </div>
      <p className="splash-status" role="status">{status}</p>
    </div>
  );

  const list = (
    <>
      <h2 className="group-title splash-title">
        Drawn by visitors
        <span className="n">{countText || (total === 1 ? '1 icon' : `${total} icons`)}</span>
      </h2>
      {icons.some((icon) => store.current.tokens[icon.id]) && <p className="splash-own">Yours are marked with a dot. Click one to keep working on it.</p>}
      <ul className="grid splash-grid">
        {icons.map((icon) => {
          const drawing = <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markupOf(icon.paths) }} />;
          return (
            <li className="cell" key={icon.id} data-id={icon.id} title={store.current.tokens[icon.id] ? `Your icon ${icon.id}` : `Icon ${icon.id}`} data-own={store.current.tokens[icon.id] ? '' : undefined}>
              {store.current.tokens[icon.id]
                ? <button className="splash-tile" type="button" aria-label={`Edit icon ${icon.id}`} aria-current={icon.id === currentId} onClick={() => openOwn(icon.id)}>{drawing}</button>
                : <div className="splash-tile" role="img" aria-label={`Icon ${icon.id}`}>{drawing}</div>}
            </li>
          );
        })}
      </ul>
      {more && <button className="btn dark quiet splash-more" type="button" onClick={() => { track('icons_show_more'); loadPage(icons[icons.length - 1]?.id); }}>Show more</button>}
    </>
  );

  if (sheet) {
    return (
      <>
        {masthead}
        {editor}
        <div className="sheet-backdrop" data-open={sheetOpen ? '' : undefined} onClick={closeSheet} />
        <aside className="sheet" id="drawn-sheet" data-open={sheetOpen ? '' : undefined} aria-label="Drawn by visitors" inert={!sheetOpen}>
          <button className="sheet-close" type="button" ref={sheetClose} aria-label="Close" title="Close (Esc)" onClick={closeSheet}>
            {buttonIcons.close && <ButtonIcon body={buttonIcons.close} />}
          </button>
          <div className="sheet-body">{list}</div>
        </aside>
      </>
    );
  }

  return (
    <>
      <header className="poster splash-poster">
        {masthead}
        {editor}
      </header>
      {specimen}
      <main className="splash-list">{list}</main>
    </>
  );
}

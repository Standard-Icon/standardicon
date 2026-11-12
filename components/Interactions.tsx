'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@/lib/track';
import { DEFAULT_SIZE, SIZES, WEIGHTS, heaviestFor, strokeFor, sizesFor, weighBody, weightFits, wrapSvg } from '@/lib/icon.mjs';

// The grid is plain server-rendered HTML, because hydrating hundreds of icon components would slow every
// page down. This one component handles the icon menu, size, and search through event delegation.

const STORAGE_KEY = 'standard-icon-size';
const CODE_TAB_KEY = 'standard-icon-code-tab';
const WEIGHT_KEY = 'standard-icon-weight';
const VIEW_KEY = 'standard-icon-view';
type Weight = keyof typeof WEIGHTS;
const VIEWS = ['icons', 'labels', 'large'] as const;
type View = (typeof VIEWS)[number];

type ExactSizes = Record<string, Record<string, string>>;
type Format = 'svg' | 'png';

let exact: ExactSizes | null = null;
let exactRequest: Promise<ExactSizes> | null = null;
let toastTimer: ReturnType<typeof setTimeout>;

// Icons built from outlined shapes have different geometry at each size, so they can't be scaled in CSS.
function loadExact() {
  exactRequest ??= fetch('/sizes.json')
    .then((response) => response.json())
    .then((map: ExactSizes) => (exact = map));
  return exactRequest;
}

function readStoredSize() {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return SIZES.includes(stored) ? stored : DEFAULT_SIZE;
  } catch {
    return 16;
  }
}

function readStoredView(): View {
  try {
    const stored = localStorage.getItem(VIEW_KEY) as View | null;
    return stored && VIEWS.includes(stored) ? stored : 'labels';
  } catch {
    return 'labels';
  }
}

function readStoredWeight(): Weight {
  try {
    const stored = localStorage.getItem(WEIGHT_KEY);
    return stored && stored in WEIGHTS ? (stored as Weight) : 'regular';
  } catch {
    return 'regular';
  }
}

const label = (weight: string) => weight[0].toUpperCase() + weight.slice(1);

function showToast(message: string) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 1800);
}

// Safari only allows clipboard writes inside the click itself. Handing ClipboardItem a promise keeps the
// write inside the click while the SVG or PNG is still being prepared.
async function copyBlob(type: string, make: () => Promise<Blob>) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ [type]: make() })]);
    return;
  }
  if (type !== 'text/plain') throw new Error('This browser cannot copy images.');
  await navigator.clipboard.writeText(await (await make()).text());
}

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    showToast('Your browser blocked copying. Select the text and copy it instead.');
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Draws the SVG onto a canvas at its own size. currentColor renders as black outside a page.
async function svgToPng(svg: string, size: number) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.drawImage(image, 0, 0, size, size);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG failed'))), 'image/png'));
}

// The browser re-serializes inline SVG with closing tags, so restore the source form.
const bodyOf = (svg: Element) => svg.innerHTML.replace(/><\/(path|rect|circle|ellipse|line|polygon|polyline)>/g, '/>');

function showBody(svg: Element, body: string, viewBox: number) {
  svg.setAttribute('viewBox', `0 0 ${viewBox} ${viewBox}`);
  svg.innerHTML = body;
}

// Edit distance, counting a swap of two neighbouring letters as one typo. Gives up past the limit.
function editDistance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
    }
    if (Math.min(...row) > limit) return limit + 1;
    before = previous;
    previous = row;
  }
  return previous[b.length];
}

function flash(cell: HTMLElement | null) {
  if (!cell) return;
  cell.classList.add('copied');
  setTimeout(() => cell.classList.remove('copied'), 900);
}

export function Interactions() {
  const pathname = usePathname();

  useEffect(() => {
    let size = readStoredSize();
    let weight = readStoredWeight();
    if (!weightFits(weight, size)) weight = heaviestFor(size) as Weight;
    const detail = document.querySelector<HTMLElement>('[data-detail]');
    const input = document.querySelector<HTMLInputElement>('#q');
    const menu = document.getElementById('icon-menu') as HTMLElement;
    let menuCell: HTMLElement | null = null;
    let view = readStoredView();
    const stage = document.getElementById('stage');
    let stageName: string | null = null;
    let stageRender = 0;

    // Icons with filled shapes come in one weight, regular, drawn as they are, whatever weight is picked.
    const isFixed = (name: string) => (detail?.dataset.detail === name ? detail.dataset.fixed !== undefined : document.querySelector<HTMLElement>(`.cell[data-name="${name}"]`)?.dataset.fixed !== undefined);
    const weightFor = (name: string): Weight => (isFixed(name) ? 'regular' : weight);

    // The SVG for an icon at the current size and weight: the 16px drawing scaled up, so lines grow with it.
    const svgFor = async (name: string) => {
      const cell = document.querySelector(`.cell[data-name="${name}"] svg`);
      const body = detail && detail.dataset.detail === name ? (detail.dataset.body as string) : (exact?.[name]?.[16] ?? bodyOf(cell!));
      return wrapSvg(isFixed(name) ? body : weighBody(body, weight), size, 16);
    };

    const run = async (name: string, format: Format, action: 'copy' | 'download') => {
      const label = format.toUpperCase();
      const w = weightFor(name);
      const suffix = w === 'regular' ? '' : `-${w}`;
      const detailText = `at ${size}px${w === 'regular' ? '' : `, ${w}`}`;
      const make = async () => {
        const svg = await svgFor(name);
        return format === 'svg' ? new Blob([svg], { type: 'text/plain' }) : svgToPng(svg, size);
      };
      try {
        if (action === 'copy') {
          await copyBlob(format === 'svg' ? 'text/plain' : 'image/png', make);
          showToast(`Copied ${name} ${label} ${detailText}`);
          flash(menuCell);
          track('icon_copy', { icon: name, format, size, weight: w });
        } else {
          const blob = await make();
          download(format === 'svg' ? new Blob([blob], { type: 'image/svg+xml' }) : blob, format === 'svg' ? `${name}${suffix}.svg` : `${name}-${size}${suffix}.png`);
          showToast(`Downloaded ${name} ${label} ${detailText}`);
          track('icon_download', { icon: name, format, size, weight: w });
        }
      } catch {
        track(action === 'copy' ? 'icon_copy_failed' : 'icon_download_failed', { icon: name, format, size, weight: w });
        showToast(action === 'copy' && format === 'png' ? 'This browser can’t copy images. Download the PNG instead.' : `Couldn’t ${action} the ${label}. Try again.`);
      }
    };

    // The icon page's code box: every way to use the icon at the size and weight picked, one tab showing.
    const codeTabs = document.getElementById('code-tabs');
    let codeTexts: Record<string, string> = {};
    // Opens on the tab last used, on any icon page.
    try {
      const last = localStorage.getItem(CODE_TAB_KEY);
      const input = last && codeTabs?.querySelector<HTMLInputElement>(`input[name="code-tab"][value="${CSS.escape(last)}"]`);
      if (input) input.checked = true;
    } catch {}
    const showCodeTab = () => {
      const picked = codeTabs?.querySelector<HTMLInputElement>('input[name="code-tab"]:checked');
      if (!codeTabs || !picked) return;
      document.getElementById('code-text')!.textContent = codeTexts[picked.value] ?? '';
      document.getElementById('code-note')!.textContent = picked.dataset.note ?? '';
    };
    const renderDetail = async () => {
      if (!detail) return;
      const name = detail.dataset.detail as string;
      const svg = await svgFor(name);
      const w = weightFor(name);
      if (codeTabs) {
        const { cli, mcp } = codeTabs.dataset;
        const flags = `${size === 16 ? '' : ` --size ${size}`}${w === 'regular' ? '' : ` --weight ${w}`}`;
        const at = `${size}px${w === 'regular' ? '' : `, ${w}`}`;
        // React names hyphenated attributes in camelCase, except data- and aria- ones.
        const jsx = svg.replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (whole, attr: string) => (/^(data|aria)-/.test(attr) ? whole : ` ${attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}=`));
        const dataUri = `data:image/svg+xml,${svg.replace(/"/g, "'").replace(/[<>#%]/g, (c) => encodeURIComponent(c))}`;
        codeTexts = {
          svg,
          jsx,
          css: `.icon-${name} {\n  display: inline-block;\n  width: ${size}px;\n  height: ${size}px;\n  background-color: currentColor;\n  mask: url("${dataUri}") center / contain no-repeat;\n}`,
          url: `${location.origin}/svg/${w === 'regular' ? '' : `${w}/`}${size}/${name}.svg`,
          npx: `${cli} add ${name}${flags}`,
          agent: `Add the ${name} icon from The Standard Icon Set to this project, at ${at}. Read ${location.origin}/llms.txt and follow its instructions.`,
          mcp: mcp ?? '',
        };
        showCodeTab();
      }
    };

    // The icons the grid would show right now: everything that matches the search, in page order.
    const visibleNames = () =>
      [...document.querySelectorAll<HTMLElement>('[data-group] .cell')]
        .filter((cell) => !cell.hidden && !cell.closest<HTMLElement>('[data-group]')!.hidden)
        .map((cell) => cell.dataset.name as string);

    const renderStage = async () => {
      if (!stage || view !== 'large') return;
      const names = visibleNames();
      stage.toggleAttribute('data-empty', names.length === 0);
      if (!names.length) return;
      if (!stageName || !names.includes(stageName)) stageName = names[0];
      const name = stageName;
      const index = names.indexOf(name);
      stage.dataset.name = name;
      document.getElementById('stage-count')!.textContent = `${index + 1} of ${names.length}`;
      const link = document.getElementById('stage-name') as HTMLAnchorElement;
      link.textContent = name;
      link.href = `/icons/${name}/`;
      const group = document.querySelector(`.cell[data-name="${name}"]`)?.closest('[data-group]')?.querySelector('.group-title a');
      document.getElementById('stage-group')!.textContent = group?.textContent ?? '';
      const figure = document.getElementById('stage-figure')!;
      figure.style.setProperty('--cells', String(size));
      // Size and weight changes can overlap; only the latest render lands.
      const ticket = ++stageRender;
      const svg = await svgFor(name);
      if (ticket === stageRender) figure.innerHTML = svg;
    };

    const stepStage = (by: number) => {
      const names = visibleNames();
      if (!names.length) return;
      const index = stageName ? names.indexOf(stageName) : -1;
      stageName = names[(index + by + names.length) % names.length];
      renderStage();
    };

    const setView = (next: View) => {
      view = next;
      document.documentElement.dataset.view = view;
      const radio = document.querySelector<HTMLInputElement>(`input[name="view"][value="${view}"]`);
      if (radio) radio.checked = true;
      try {
        localStorage.setItem(VIEW_KEY, view);
      } catch {
        // The view still applies for this page when storage is unavailable.
      }
      closeMenu();
      // Open the large view on the icon whose menu was last open, if any.
      if (view === 'large' && menu.dataset.name) stageName = menu.dataset.name;
      renderStage();
    };

    const drawExact = () => {
      document.querySelectorAll<HTMLElement>('.cell').forEach((cell) => {
        const bodies = exact?.[cell.dataset.name as string];
        const svg = cell.querySelector('svg');
        if (!bodies || !svg) return;
        // Show the largest drawing at or below this size. Every icon is drawn at 16 now, and its line grows with it.
        const drawn = Math.max(...Object.keys(bodies).map(Number).filter((s) => s <= size));
        showBody(svg, bodies[drawn], drawn);
      });
    };

    // Keep the phone dropdowns in step with the radio inputs.
    const markPicked = (name: string, value: string) => {
      document.querySelectorAll<HTMLElement>(`[data-mpick="${name}"]`).forEach((option) => option.setAttribute('aria-selected', String(option.dataset.value === value)));
    };
    const closePickers = (except?: string) => {
      document.querySelectorAll<HTMLElement>('[data-mpick-list]').forEach((list) => {
        if (list.dataset.mpickList === except) return;
        list.hidden = true;
        document.querySelector(`[data-mpick-toggle="${list.dataset.mpickList}"]`)?.setAttribute('aria-expanded', 'false');
      });
    };

    const setSize = (next: number) => {
      size = next;
      markPicked('size', String(size));
      document.documentElement.style.setProperty('--size', `${size}px`);
      const radio = document.querySelector<HTMLInputElement>(`input[name="size"][value="${size}"]`);
      if (radio) radio.checked = true;
      try {
        localStorage.setItem(STORAGE_KEY, String(size));
      } catch {
        // The size still applies for this page when storage is unavailable.
      }
      renderDetail();
      renderStage();
      if (size !== 16 || exact) loadExact().then(drawExact);
      if (menuCell) updateMenuLabel(menuCell.dataset.name as string);
      // A size too small for the weight steps the weight down to the heaviest that size comes in.
      if (!weightFits(weight, size)) {
        const lighter = heaviestFor(size) as Weight;
        showToast(`${label(weight)} comes in ${sizesFor(weight)[0]} and up, so the weight is now ${lighter}.`);
        setWeight(lighter);
      }
    };

    const setWeight = (next: Weight) => {
      weight = next;
      markPicked('weight', weight);
      document.documentElement.style.setProperty('--weight', String(strokeFor(weight)));
      document.querySelectorAll<HTMLElement>('.sizes-row li').forEach((li) => li.toggleAttribute('data-off', !weightFits(weight, Number(li.dataset.size))));
      const radio = document.querySelector<HTMLInputElement>(`input[name="weight"][value="${weight}"]`);
      if (radio) radio.checked = true;
      try {
        localStorage.setItem(WEIGHT_KEY, weight);
      } catch {
        // The weight still applies for this page when storage is unavailable.
      }
      renderDetail();
      renderStage();
      if (menuCell) updateMenuLabel(menuCell.dataset.name as string);
      // Picking a weight at a size it doesn't come in steps the size up to the smallest it does.
      if (!weightFits(weight, size)) {
        showToast(`${label(weight)} comes in ${sizesFor(weight)[0]} and up, so the size is now ${sizesFor(weight)[0]}.`);
        setSize(sizesFor(weight)[0]);
      }
    };

    function updateMenuLabel(name: string) {
      const w = weightFor(name);
      document.getElementById('menu-size')!.textContent = `${size}px${w === 'regular' ? '' : ` ${w}`}`;
      // Explain why a heavier weight didn't apply, but only when one was picked.
      document.getElementById('menu-note')!.hidden = !(isFixed(name) && weight !== 'regular' && weight !== 'thin');
    }

    const closeMenu = (restoreFocus = false) => {
      if (menu.hidden) return;
      menu.hidden = true;
      menuCell?.querySelector('.hit')?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) menuCell?.querySelector<HTMLElement>('.hit')?.focus();
      menuCell = null;
    };

    const openMenu = (cell: HTMLElement) => {
      if (menuCell === cell && !menu.hidden) return closeMenu(true);
      closeMenu();
      menuCell = cell;
      const name = cell.dataset.name as string;
      menu.dataset.name = name;
      document.getElementById('menu-name')!.textContent = name;
      updateMenuLabel(name);
      (document.getElementById('menu-link') as HTMLAnchorElement).href = `/icons/${name}/`;
      menu.hidden = false;
      cell.querySelector('.hit')?.setAttribute('aria-expanded', 'true');
      // Open below the tile, or above it when there's no room, and keep it on screen.
      const rect = cell.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const below = rect.bottom + height + 8 <= window.innerHeight;
      menu.style.left = `${left}px`;
      menu.style.top = `${below ? rect.bottom - 1 : Math.max(8, rect.top - height + 1)}px`;
      menu.querySelector<HTMLElement>('#menu-link')?.focus();
      if (size !== 16) loadExact();
    };

    // Every word any icon can be found by, built once on the first search with no results.
    let keywords: string[] | null = null;
    const allKeywords = () =>
      (keywords ??= [...new Set([...document.querySelectorAll<HTMLElement>('[data-group] .cell')].flatMap((cell) => (cell.dataset.k as string).split(' ')))]);
    const matchesAny = (query: string[]) =>
      [...document.querySelectorAll<HTMLElement>('[data-group] .cell')].some((cell) => query.every((term) => (cell.dataset.k as string).includes(term)));

    // Close matches for a search that found nothing: fix typos word by word, then suggest the
    // fixed searches that find something. Words that can't be found together are offered alone.
    const closeWords = (term: string) => {
      if (matchesAny([term])) return [term];
      const limit = term.length <= 4 ? 1 : 2;
      return allKeywords()
        .map((word) => ({ word, distance: editDistance(term, word, limit) }))
        .filter(({ distance }) => distance <= limit)
        // Closest first, then words that start the same way, since typos rarely hit the first letter.
        .sort((a, b) => a.distance - b.distance || Number(b.word[0] === term[0]) - Number(a.word[0] === term[0]) || a.word.length - b.word.length)
        .slice(0, 3)
        .map(({ word }) => word);
    };
    const suggestionsFor = (terms: string[]) => {
      const options = terms.map(closeWords);
      const queries = options.reduce<string[][]>((all, words) => all.flatMap((query) => words.map((word) => [...query, word])), [[]]);
      const found = queries.filter((query) => query.length && matchesAny(query)).map((query) => query.join(' '));
      if (!found.length && terms.length > 1) found.push(...options.flat().filter((word) => matchesAny([word])));
      return [...new Set(found)].filter((query) => query !== terms.join(' ')).slice(0, 6);
    };

    const showEmpty = (value: string, terms: string[]) => {
      document.getElementById('empty-q')!.textContent = `“${value}”`;
      const suggestions = suggestionsFor(terms);
      const list = document.getElementById('empty-suggestions')!;
      list.replaceChildren(
        ...suggestions.map((query) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn dark quiet';
          button.dataset.suggest = query;
          button.textContent = query;
          return button;
        }),
      );
      document.getElementById('empty-suggest')!.hidden = !suggestions.length;
      const request = document.getElementById('empty-request') as HTMLAnchorElement | null;
      if (request) request.href = `${request.dataset.base}${encodeURIComponent(`: ${value}`)}`;
    };

    let searchTimer: ReturnType<typeof setTimeout>;
    let announceTimer: ReturnType<typeof setTimeout>;
    const applySearch = (value: string, updateUrl: boolean) => {
      const terms = value.toLowerCase().split(/\s+/).filter(Boolean);
      let total = 0;
      document.querySelectorAll<HTMLElement>('[data-group]').forEach((group) => {
        let shown = 0;
        group.querySelectorAll<HTMLElement>('.cell').forEach((cell) => {
          const match = terms.every((term) => (cell.dataset.k as string).includes(term));
          cell.hidden = !match;
          if (match) shown++;
        });
        group.hidden = shown === 0;
        total += shown;
      });
      const empty = document.getElementById('empty');
      if (empty) {
        empty.hidden = total > 0;
        if (!total) showEmpty(value, terms);
      }
      renderStage();
      if (updateUrl) {
        const url = new URL(location.href);
        if (value) url.searchParams.set('q', value);
        else url.searchParams.delete('q');
        history.replaceState(history.state, '', url);
        // One event and one screen reader announcement once typing stops, not one per keystroke.
        clearTimeout(searchTimer);
        clearTimeout(announceTimer);
        announceTimer = setTimeout(() => {
          const status = document.getElementById('search-status');
          if (status) status.textContent = !value ? '' : total ? `${total} ${total === 1 ? 'icon' : 'icons'} found` : `No icons match ${value}`;
        }, 600);
        if (value) searchTimer = setTimeout(() => track('search', { q: value, results: total }), 1000);
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      const toggle = target.closest<HTMLElement>('[data-mpick-toggle]');
      if (toggle) {
        const name = toggle.dataset.mpickToggle as string;
        const list = document.querySelector<HTMLElement>(`[data-mpick-list="${name}"]`)!;
        closePickers(name);
        closeMenu();
        list.hidden = !list.hidden;
        toggle.setAttribute('aria-expanded', String(!list.hidden));
        if (!list.hidden) list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
        return;
      }
      const option = target.closest<HTMLElement>('[data-mpick]');
      if (option) {
        document.querySelector<HTMLInputElement>(`input[name="${option.dataset.mpick}"][value="${option.dataset.value}"]`)?.click();
        closePickers();
        document.querySelector<HTMLElement>(`[data-mpick-toggle="${option.dataset.mpick}"]`)?.focus();
        return;
      }
      if (!target.closest('.mpick')) closePickers();
      if (target.closest('#clear-search')) {
        clearSearch();
        return;
      }
      const suggestion = target.closest<HTMLElement>('[data-suggest]');
      if (suggestion && input) {
        track('search_suggestion', { from: input.value, to: suggestion.dataset.suggest });
        input.value = suggestion.dataset.suggest as string;
        onInput();
        input.focus();
        return;
      }
      const hit = target.closest('.hit');
      if (hit) {
        openMenu(hit.closest<HTMLElement>('.cell')!);
        return;
      }
      const stepper = target.closest<HTMLElement>('[data-stage-step]');
      if (stepper) {
        stepStage(Number(stepper.dataset.stageStep));
        return;
      }
      const action = target.closest<HTMLElement>('[data-action]');
      if (action) {
        const [format, verb] = (action.dataset.action as string).split('-') as [Format, 'copy' | 'download'];
        const name = action.closest('#icon-menu') ? (menu.dataset.name as string) : action.closest('#stage') ? (stage!.dataset.name as string) : (detail?.dataset.detail as string);
        run(name, format, verb);
        if (verb === 'download') closeMenu(true);
        return;
      }
      if (!target.closest('#icon-menu')) closeMenu();
      const button = target.closest<HTMLElement>('[data-copy]');
      if (button) {
        copyText(button.dataset.copy as string, button.dataset.copied as string);
        track('text_copy', { what: button.dataset.copied });
      } else if (target.closest('#code-copy')) {
        const tab = codeTabs?.querySelector<HTMLInputElement>('input[name="code-tab"]:checked');
        const label = tab?.nextElementSibling?.textContent ?? 'code';
        copyText(document.getElementById('code-text')!.textContent as string, `Copied ${label}`);
        track('code_copy', { icon: detail?.dataset.detail, tab: tab?.value, size, weight: detail ? weightFor(detail.dataset.detail as string) : weight });
      }
    };

    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement;
      if (['size', 'weight', 'view'].includes(target.name)) track('option_change', { option: target.name, value: target.value });
      if (target.name === 'size') setSize(Number(target.value));
      else if (target.name === 'weight') setWeight(target.value as Weight);
      else if (target.name === 'view') setView(target.value as View);
      else if (target.name === 'code-tab') {
        try {
          localStorage.setItem(CODE_TAB_KEY, target.value);
        } catch {}
        showCodeTab();
        track('code_tab', { tab: target.value });
      }
    };

    const clear = document.getElementById('clear-search');
    const showClear = () => {
      if (clear) clear.hidden = !input?.value;
    };
    const clearSearch = () => {
      input!.value = '';
      applySearch('', true);
      showClear();
      input!.focus();
    };
    const onInput = () => {
      applySearch(input!.value.trim(), true);
      showClear();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !menu.hidden) {
        closeMenu(true);
        return;
      }
      const openList = document.querySelector<HTMLElement>('[data-mpick-list]:not([hidden])');
      if (event.key === 'Escape' && openList) {
        closePickers();
        document.querySelector<HTMLElement>(`[data-mpick-toggle="${openList.dataset.mpickList}"]`)?.focus();
        return;
      }
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
      if (view === 'large' && stage && !typing && menu.hidden && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        stepStage(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (!input) return;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        input.focus();
      } else if (event.key === 'Escape' && document.activeElement === input) {
        clearSearch();
      }
    };
    const onViewportChange = () => closeMenu();

    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.addEventListener('resize', onViewportChange);
    if (input) {
      input.addEventListener('input', onInput);
      const initial = new URLSearchParams(location.search).get('q');
      if (initial) {
        input.value = initial;
        applySearch(initial.trim(), false);
      }
      showClear();
    }

    setSize(size);
    setWeight(weight);
    setView(view);

    return () => {
      closeMenu();
      document.removeEventListener('click', onClick);
      document.removeEventListener('change', onChange);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
      input?.removeEventListener('input', onInput);
      clearTimeout(searchTimer);
      clearTimeout(announceTimer);
    };
  }, [pathname]);

  return null;
}

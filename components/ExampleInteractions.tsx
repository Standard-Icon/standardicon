'use client';

import { useEffect } from 'react';

// Makes the mock interfaces on the examples page clickable. Like the main Interactions, it's one set of
// delegated listeners driven by data attributes, so the mocks stay plain server-rendered HTML.

const FONT_KEY = 'standard-icon-example-font';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function flash(element: Element) {
  element.classList.remove('ex-flash');
  void (element as HTMLElement).offsetWidth;
  element.classList.add('ex-flash');
}

export function ExampleInteractions() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.examples');
    if (!root) return;

    // The font picker sets one variable that every mock reads.
    const fonts = document.querySelector<HTMLElement>('.ex-fonts')!;
    const setFont = (family: string) => {
      fonts.style.setProperty('--ex-font', family);
      const radio = fonts.querySelector<HTMLInputElement>(`input[name="ex-font"][value="${CSS.escape(family)}"]`);
      if (radio) radio.checked = true;
    };
    try {
      const stored = localStorage.getItem(FONT_KEY);
      if (stored && fonts.querySelector(`input[name="ex-font"][value="${CSS.escape(stored)}"]`)) setFont(stored);
    } catch {
      // Without storage the picker still works for this visit.
    }
    const onChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      if (input.name !== 'ex-font') return;
      setFont(input.value);
      try {
        localStorage.setItem(FONT_KEY, input.value);
      } catch {
        // Ignore: storage is optional.
      }
    };

    // Player state lives here, not in the DOM.
    const player = root.querySelector<HTMLElement>('[data-ex-player]');
    const tracks: [string, string, number][] = player ? JSON.parse(player.dataset.tracks as string) : [];
    let track = 0;
    let position = 84;
    let timer: ReturnType<typeof setInterval> | undefined;

    const drawPlayer = () => {
      if (!player) return;
      const [title, artist, length] = tracks[track];
      player.querySelector('[data-ex-title]')!.textContent = title;
      player.querySelector('[data-ex-artist]')!.textContent = artist;
      player.querySelector('[data-ex-length]')!.textContent = clock(length);
      player.querySelector('[data-ex-time]')!.textContent = clock(position);
      player.querySelector<HTMLElement>('[data-ex-bar]')!.style.width = `${(position / length) * 100}%`;
    };
    const playing = () => timer !== undefined;
    const setPlaying = (on: boolean) => {
      const button = player!.querySelector<HTMLElement>('[data-ex-action="play"]')!;
      button.classList.toggle('on', on);
      button.setAttribute('aria-label', on ? 'Pause' : 'Play');
      clearInterval(timer);
      timer = undefined;
      if (!on) return;
      timer = setInterval(() => {
        position += 1;
        if (position >= tracks[track][2]) {
          const repeat = player!.querySelector('[aria-label="Repeat"]')!.classList.contains('on');
          if (!repeat) track = (track + 1) % tracks.length;
          position = 0;
        }
        drawPlayer();
      }, 1000);
    };
    const skip = (by: number) => {
      const shuffle = player!.querySelector('[aria-label="Shuffle"]')!.classList.contains('on');
      track = shuffle ? (track + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length : (track + by + tracks.length) % tracks.length;
      position = 0;
      drawPlayer();
    };

    const editor = root.querySelector<HTMLElement>('[data-ex-editor]');
    const drawEditor = () => {
      if (!editor) return;
      const text = editor.querySelector<HTMLElement>('[data-ex-text]')!;
      editor.querySelectorAll<HTMLElement>('[data-ex-format]').forEach((button) => {
        text.classList.toggle(`fmt-${button.dataset.exFormat}`, button.classList.contains('on'));
      });
      const align = editor.querySelector<HTMLElement>('[data-ex-align].on')?.dataset.exAlign ?? 'left';
      text.style.textAlign = align;
    };

    const filterFiles = (query: string) => {
      const rows = [...root.querySelectorAll<HTMLElement>('.ex-files tr')];
      let shown = 0;
      for (const row of rows) {
        const match = !row.dataset.exDeleted && row.textContent!.toLowerCase().includes(query.toLowerCase());
        row.hidden = !match;
        if (match) shown++;
      }
      root.querySelector<HTMLElement>('[data-ex-none]')!.hidden = shown > 0;
    };

    const syncToasts = () => {
      const box = root.querySelector<HTMLElement>('[data-ex-toasts]')!;
      const visible = box.querySelectorAll('p:not([hidden])').length;
      box.querySelector<HTMLElement>('[data-ex-action="restore-toasts"]')!.hidden = visible > 0;
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!root.contains(target)) return;

      const item = target.closest<HTMLElement>('[data-ex-item]');
      if (item) {
        const group = item.closest<HTMLElement>('[data-ex-pick]')!;
        group.querySelectorAll('[data-ex-item]').forEach((other) => other.classList.toggle('on', other === item));
        if (group.hasAttribute('data-ex-tabs')) group.closest('.ex-phone')!.querySelector('[data-ex-screen]')!.textContent = item.dataset.exName ?? '';
        drawEditor();
        return;
      }

      const toggle = target.closest<HTMLElement>('[data-ex-toggle]');
      if (toggle) {
        const on = !toggle.classList.contains('on');
        toggle.classList.toggle('on', on);
        toggle.setAttribute('aria-pressed', String(on));
        drawEditor();
        return;
      }

      const seek = target.closest<HTMLElement>('[data-ex-seek]');
      if (seek) {
        const rect = seek.getBoundingClientRect();
        const share = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        if (seek.dataset.exSeek === 'progress') {
          position = Math.round(share * tracks[track][2]);
          drawPlayer();
        } else {
          seek.querySelector<HTMLElement>('span')!.style.width = `${share * 100}%`;
        }
        return;
      }

      const action = target.closest<HTMLElement>('[data-ex-action]');
      if (!action) return;
      switch (action.dataset.exAction) {
        case 'play':
          setPlaying(!playing());
          break;
        case 'prev':
          if (position > 3) {
            position = 0;
            drawPlayer();
          } else skip(-1);
          break;
        case 'next':
          skip(1);
          break;
        case 'mute':
        case 'loud':
          action.closest('.ex-volume')!.querySelector<HTMLElement>('.ex-progress span')!.style.width = action.dataset.exAction === 'mute' ? '0%' : '100%';
          break;
        case 'mention': {
          const input = action.closest('form')!.querySelector<HTMLInputElement>('input')!;
          input.value += input.value && !input.value.endsWith(' ') ? ' @' : '@';
          input.focus();
          break;
        }
        case 'delete': {
          const row = action.closest('tr')!;
          row.dataset.exDeleted = 'true';
          filterFiles(root.querySelector<HTMLInputElement>('[data-ex-filter]')!.value);
          break;
        }
        case 'restore-files':
          root.querySelectorAll<HTMLElement>('.ex-files tr').forEach((row) => delete row.dataset.exDeleted);
          root.querySelector<HTMLInputElement>('[data-ex-filter]')!.value = '';
          filterFiles('');
          break;
        case 'dismiss':
          action.closest('p')!.hidden = true;
          syncToasts();
          break;
        case 'retry': {
          const toast = action.closest<HTMLElement>('p')!;
          toast.classList.replace('bad', 'ok');
          toast.querySelector('.ex-state')!.classList.add('on');
          toast.querySelector('[data-ex-head]')!.textContent = 'Upload complete';
          toast.querySelector('[data-ex-body]')!.textContent = 'arrows.zip is in your files.';
          action.dataset.exAction = 'dismiss';
          action.setAttribute('aria-label', 'Dismiss');
          action.classList.remove('ex-link');
          action.replaceChildren(document.querySelector('.ex-toasts .ok [data-ex-action="dismiss"] svg')!.cloneNode(true));
          break;
        }
        case 'restore-toasts': {
          const box = action.closest('[data-ex-toasts]')!;
          box.querySelectorAll<HTMLElement>('p').forEach((toast) => (toast.hidden = false));
          syncToasts();
          break;
        }
        case 'merge': {
          const pr = action.closest<HTMLElement>('[data-ex-pr]')!;
          const merged = !pr.classList.contains('merged');
          pr.classList.toggle('merged', merged);
          pr.querySelector('[data-ex-pill]')!.textContent = merged ? 'Merged' : 'Open';
          action.querySelector('span')!.textContent = merged ? 'Merged' : 'Merge';
          break;
        }
        case 'pay': {
          const paid = !action.classList.contains('on');
          action.classList.toggle('on', paid);
          action.querySelector('.ex-state')!.classList.toggle('on', paid);
          action.querySelector('[data-ex-label]')!.textContent = paid ? 'Paid with' : 'Pay with';
          break;
        }
        default:
          flash(action);
      }
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = (event.target as Element).closest<HTMLFormElement>('[data-ex-compose]');
      if (!form) return;
      event.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input')!;
      const text = input.value.trim();
      if (!text) return;
      const thread = root.querySelector<HTMLElement>('[data-ex-thread]')!;
      const message = document.createElement('p');
      message.className = 'me';
      message.textContent = text;
      thread.append(message);
      thread.scrollTop = thread.scrollHeight;
      input.value = '';
    };

    const onInput = (event: Event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-ex-filter]')) filterFiles(input.value);
    };

    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    return () => {
      document.removeEventListener('change', onChange);
      clearInterval(timer);
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit);
      document.removeEventListener('input', onInput);
    };
  }, []);

  return null;
}

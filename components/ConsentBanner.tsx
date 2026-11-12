'use client';

import { useEffect, useState } from 'react';

// Asks once whether the visitor metrics may remember this browser between visits. Until there's an answer,
// and after a no, the metrics keep nothing in the browser (see data-consent in app/layout.tsx). Saying yes
// keeps a random visitor id in local storage. "Privacy choices" in the footer brings this back.
const KEY = '_mm_consent';

type Metrics = { consent?: (granted: boolean) => void };

// The set's own icons, passed in from the layout, since the icon data only exists on the server.
const Icon = ({ body }: { body: string }) => (
  <svg className="i" viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: body }} />
);

export function ConsentBanner({ icons }: { icons: { cookie: string; allow: string; deny: string } }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let answered = false;
    try {
      answered = localStorage.getItem(KEY) !== null;
    } catch {}
    if (!answered) setOpen(true);
    const reopen = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.('[data-consent-open]')) setOpen(true);
    };
    document.addEventListener('click', reopen);
    return () => document.removeEventListener('click', reopen);
  }, []);

  const choose = (granted: boolean) => {
    try {
      localStorage.setItem(KEY, granted ? 'granted' : 'denied');
    } catch {}
    (window as unknown as { mm?: Metrics }).mm?.consent?.(granted);
    setOpen(false);
  };

  if (!open) return null;
  return (
    <section className="consent" aria-label="Privacy choices">
      {/* The title links to the privacy page, which says what's kept and why. */}
      <a className="consent-title" href="/privacy/" title="What this means">
        <Icon body={icons.cookie} />
        Cookie crap
      </a>
      <div className="consent-actions">
        <button className="consent-btn" type="button" aria-label="Don't allow" title="Don't allow" onClick={() => choose(false)}><Icon body={icons.deny} /></button>
        <button className="consent-btn" type="button" aria-label="Allow" title="Allow" onClick={() => choose(true)}><Icon body={icons.allow} /></button>
      </div>
    </section>
  );
}

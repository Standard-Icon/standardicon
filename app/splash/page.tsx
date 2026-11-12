import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { SplashBoard } from '@/components/SplashBoard';
import { SplashSpecimen } from '@/components/SplashSpecimen';
import { COUNT, NAME, ORIGIN, findIcon } from '@/lib/site.mjs';
import './splash.css';

// Every path on the live site shows this page until launch, so links shared now preview it.
const title = `${NAME}: shipping November 2026`;
const description = `${COUNT} free line icons drawn by hand on a 16px grid, in 9 sizes and 5 weights. MIT licensed. Draw one of your own while you wait.`;

export const metadata: Metadata = {
  title: NAME,
  description,
  robots: { index: false, follow: false },
  openGraph: {
    siteName: NAME,
    type: 'website',
    url: ORIGIN,
    title,
    description,
    images: [{ url: '/og-splash.png', width: 1200, height: 630, alt: `${NAME}, shipping November 2026` }],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/og-splash.png'] },
};

// Holds the logo's ring undrawn until the page has loaded, but never more than 600ms, so a slow load doesn't
// keep it waiting. It runs as the page is parsed, before the logo first paints. See .arcs-wait in splash.css.
const ARCS_WAIT = `(function(d){d.classList.add('arcs-wait');function go(){d.classList.remove('arcs-wait')}if(document.readyState==='complete')go();else{addEventListener('load',go);setTimeout(go,600)}})(document.documentElement)`;

// The logo isn't a link: nothing on this page leads to the full site until launch.
export default function SplashPage() {
  return (
    <>
    <script dangerouslySetInnerHTML={{ __html: ARCS_WAIT }} />
    <SplashBoard
      masthead={
        <h1 className="masthead">
          <span className="wordmark"><Logo full printed split /><span className="sr">{NAME}</span></span>
        </h1>
      }
      specimen={<SplashSpecimen />}
      buttonIcons={{ reset: findIcon('undo')?.body ?? '', save: findIcon('check')?.body ?? '', new: findIcon('plus')?.body ?? '', download: findIcon('download')?.body ?? '' }}
    />
    </>
  );
}

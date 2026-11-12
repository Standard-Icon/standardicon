import { Logo } from '@/components/Logo';
import { SplashBoard } from '@/components/SplashBoard';
import { CategorySection, EmptyState, JsonLd, Page, SearchBar, Stage } from '@/components/ui';
import { pageMetadata } from '@/lib/metadata';
import { COUNT, CREATOR, NAME, ORIGIN, categories, findIcon } from '@/lib/site.mjs';
import './splash/splash.css';

const description = `${COUNT} free SVG line icons, drawn on a 16px grid, in five weights. Click any icon to copy or download it as SVG or PNG, or let your coding agent install the set. MIT licensed.`;

export const metadata = pageMetadata({
  path: '/',
  title: `${NAME}: ${COUNT} free SVG icons you can copy with a click`,
  description,
});

// Holds the logo's ring undrawn until the page has loaded, but never more than 600ms, so a slow load doesn't
// keep it waiting. It runs as the page is parsed, before the logo first paints. See .arcs-wait in splash.css.
const ARCS_WAIT = `(function(d){d.classList.add('arcs-wait');function go(){d.classList.remove('arcs-wait')}if(document.readyState==='complete')go();else{addEventListener('load',go);setTimeout(go,600)}})(document.documentElement)`;

const glyph = (name: string) => findIcon(name)?.body ?? '';

// The home page opens on the full logo beside a canvas to draw your own icon. Icons visitors have drawn are
// in a sheet that slides in from the side.
export default function Home() {
  return (
    <Page
      wordmark={false}
      posterClass="splash-poster home-poster"
      poster={
        <>
          <script dangerouslySetInnerHTML={{ __html: ARCS_WAIT }} />
          <SplashBoard
            sheet
            masthead={<h1 className="splash-logo"><Logo full printed split /><span className="sr">{NAME}: {description}</span></h1>}
            buttonIcons={{ reset: glyph('undo'), save: glyph('check'), new: glyph('plus'), download: glyph('download'), close: glyph('close'), drawn: glyph('pen-tilted') }}
          />
        </>
      }
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: NAME,
          url: ORIGIN,
          description,
          creator: { '@type': 'Person', name: CREATOR },
          license: `${ORIGIN}/LICENSE.txt`,
          potentialAction: { '@type': 'SearchAction', target: `${ORIGIN}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
        }}
      />
      <SearchBar />
      <Stage />
      {categories.map((category) => <CategorySection key={category} category={category} />)}
      <EmptyState />
    </Page>
  );
}

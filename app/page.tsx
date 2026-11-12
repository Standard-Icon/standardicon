import { Logo } from '@/components/Logo';
import { CategorySection, EmptyState, JsonLd, Page, SearchBar, Stage } from '@/components/ui';
import { pageMetadata } from '@/lib/metadata';
import { COUNT, CREATOR, NAME, ORIGIN, categories } from '@/lib/site.mjs';

const description = `${COUNT} free SVG line icons, drawn on a 16px grid, in five weights. Click any icon to copy or download it as SVG or PNG, or let your coding agent install the set. MIT licensed.`;

export const metadata = pageMetadata({
  path: '/',
  title: `${NAME}: ${COUNT} free SVG icons you can copy with a click`,
  description,
});

export default function Home() {
  return (
    <Page
      wordmark={false}
      poster={
        <div className="home-hero">
          <span className="home-logo"><Logo full printed /><span className="sr">{NAME}</span></span>
          <h1>Finely crafted interface icons in multiple sizes and weights to use in all of your projects</h1>
        </div>
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

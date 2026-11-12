import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, Grid, JsonLd, Page, SearchBar, Section, Stage } from '@/components/ui';
import { pageMetadata } from '@/lib/metadata';
import { NAME, ORIGIN, categories, categoryTitle, inCategory } from '@/lib/site.mjs';

type Props = { params: Promise<{ category: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return categories.map((category) => ({ category }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const list = inCategory(category);
  const title = categoryTitle(category);
  const sample = list.slice(0, 5).map((i) => i.name).join(', ');
  return pageMetadata({
    path: `/categories/${category}/`,
    title: `${title} icons: ${list.length} free SVGs | ${NAME}`,
    description: `${list.length} free ${category === 'ai' ? 'AI' : title.toLowerCase()} SVG icons, including ${sample}. Line icons on a 16px grid, in five weights. Copy or download as SVG or PNG, MIT licensed.`,
  });
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params;
  const list = inCategory(category);
  if (!list.length) notFound();
  const title = categoryTitle(category);
  return (
    <Page
      poster={
        <>
          <p className="big" aria-hidden="true">{list.length}</p>
          <div className="side">
            <p className="lede">{title} icons, each drawn on a 16 by 16 grid. Click any icon to copy or download it.</p>
            <ul className="facts"><li><Link href="/" prefetch={false}>All icons</Link></li></ul>
          </div>
          <h1 className="titlebar"><span>{title}</span><span>{list.length}</span></h1>
        </>
      }
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: NAME, item: `${ORIGIN}/` },
            { '@type': 'ListItem', position: 2, name: `${title} icons`, item: `${ORIGIN}/categories/${category}/` },
          ],
        }}
      />
      <SearchBar />
      <Stage />
      <section data-group><Grid list={list} /></section>
      <EmptyState />
      <Section title="Other categories">
        <ul className="other">
          {categories.filter((c) => c !== category).map((c) => (
            <li key={c}><Link href={`/categories/${c}/`} prefetch={false}>{categoryTitle(c)}</Link></li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}

import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionRows, CodeTabs, Grid, JsonLd, Page, SearchBar, Section } from '@/components/ui';
import { SIZES, WEIGHTS, bodyFor, hasWeights, heaviestFor, toSvg, strokeFor } from '@/lib/icon.mjs';
import { pageMetadata } from '@/lib/metadata';
import { CREATOR, NAME, ORIGIN, categoryTitle, findIcon, icons, relatedTo, synonymsOf } from '@/lib/site.mjs';

type Props = { params: Promise<{ name: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return icons.map((icon) => ({ name: icon.name }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const icon = findIcon(name);
  if (!icon) return {};
  const synonyms = synonymsOf(icon);
  return pageMetadata({
    path: `/icons/${name}/`,
    title: `${icon.title} icon: free SVG | ${NAME}`,
    description: `Free ${icon.title.toLowerCase()} SVG icon${synonyms.length ? `, also searched as ${synonyms.slice(0, 3).join(', ')}` : ''}. Line icon, sizes 16 to 48 in five weights, MIT licensed. Copy or download it as SVG or PNG, or install it with one command.`,
  });
}

export default async function IconPage({ params }: Props) {
  const { name } = await params;
  const icon = findIcon(name);
  if (!icon) notFound();

  const synonyms = synonymsOf(icon);
  const related = relatedTo(icon);
  const raw = `${ORIGIN}/svg/16/${name}.svg`;

  return (
    <Page
      poster={
        <>
          {/* Shown at construction scale: one stroke fills one square of the 16px grid. */}
          <div className="figure"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon.body }} /></div>
          <div className="detail-side" data-detail={name} data-body={icon.body} data-sizes={icon.sizes ? JSON.stringify(icon.sizes) : undefined} data-fixed={hasWeights(icon) ? undefined : ''}>
            <div>
              <p className="crumb"><Link href={`/categories/${icon.category}/`} prefetch={false}>{categoryTitle(icon.category)}</Link></p>
              <h1>{icon.title} icon</h1>
              {synonyms.length > 0 && <p className="also">Also searched as {synonyms.join(', ')}.</p>}
            </div>
            <div>
              <ActionRows onDark />
              {!hasWeights(icon) && <p className="fixed-note">Regular only, because this icon has filled shapes.</p>}
            </div>
          </div>
        </>
      }
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ImageObject',
          name: `${icon.title} icon`,
          contentUrl: raw,
          url: `${ORIGIN}/icons/${name}/`,
          encodingFormat: 'image/svg+xml',
          keywords: icon.keywords.join(', '),
          license: `${ORIGIN}/LICENSE.txt`,
          acquireLicensePage: `${ORIGIN}/LICENSE.txt`,
          creditText: NAME,
          creator: { '@type': 'Person', name: CREATOR },
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: NAME, item: `${ORIGIN}/` },
            { '@type': 'ListItem', position: 2, name: `${categoryTitle(icon.category)} icons`, item: `${ORIGIN}/categories/${icon.category}/` },
            { '@type': 'ListItem', position: 3, name: `${icon.title} icon`, item: `${ORIGIN}/icons/${name}/` },
          ],
        }}
      />
      <SearchBar search={false} />
      <Section title="Sizes">
        <ul className="sizes-row" aria-label="Every size">
          {SIZES.map((size) => (
            <li key={size} data-size={size} style={{ '--cap': strokeFor(heaviestFor(size) as keyof typeof WEIGHTS) } as CSSProperties}>
              <svg className={hasWeights(icon) ? 'weighted' : undefined} width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: bodyFor(icon, size) }} />
              <span>{size}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Use it">
        <CodeTabs name={name} svg={toSvg(icon, 16)} />
      </Section>
      {related.length > 0 && (
        <section className="related" data-group>
          <h2 className="group-title"><span>Related</span><span className="n">{related.length}</span></h2>
          <Grid list={related} />
        </section>
      )}
    </Page>
  );
}

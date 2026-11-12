import type { Metadata } from 'next';
import { NAME, ORIGIN } from './site.mjs';

// Next replaces nested metadata objects rather than merging them, so every page sets all of this.
export function pageMetadata({ path, title, description }: { path: string; title: string; description: string }): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: path,
      types: { 'text/plain': `${ORIGIN}/llms.txt`, 'application/json': `${ORIGIN}/icons.json` },
    },
    openGraph: {
      siteName: NAME,
      type: 'website',
      url: path,
      title,
      description,
      images: [{ url: '/og.png', width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  };
}

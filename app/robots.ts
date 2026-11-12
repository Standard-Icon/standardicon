import type { MetadataRoute } from 'next';
import { ORIGIN } from '@/lib/site.mjs';

export const dynamic = 'force-static';

// Search engines and AI agents are welcome here. Instructions for agents are at /llms.txt.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${ORIGIN}/sitemap.xml`,
  };
}

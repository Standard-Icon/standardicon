import type { Metadata } from 'next';
import Link from 'next/link';
import { Page } from '@/components/ui';
import { NAME } from '@/lib/site.mjs';

export const metadata: Metadata = {
  title: `Page not found | ${NAME}`,
  description: 'This page does not exist.',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <Page
      poster={
        <>
          <p className="big" aria-hidden="true">404</p>
          <div className="side">
            <p className="lede">If you followed a link to an icon, it may have a new name.</p>
            <div className="actions"><Link className="btn" href="/">Browse all icons</Link></div>
          </div>
          <h1 className="titlebar"><span>This page doesn&apos;t exist</span></h1>
        </>
      }
    >
      {null}
    </Page>
  );
}

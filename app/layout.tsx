import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { AnchorEditor } from '@/components/AnchorEditor';
import { Interactions } from '@/components/Interactions';
import { IconMenu } from '@/components/ui';
import { BRAND, ORIGIN, icons } from '@/lib/site.mjs';
import './globals.css';
import './anchor-editor.css';

// Polymath is licensed for this site only (OH no Type Company web license). Serve the files unmodified.
const polymathText = localFont({
  src: [
    { path: './fonts/PolymathText-Regular.woff2', weight: '400' },
    { path: './fonts/PolymathText-Bold.woff2', weight: '700' },
  ],
  variable: '--font-polymath-text',
  display: 'swap',
});

const polymathDisplay = localFont({
  src: [
    { path: './fonts/PolymathDisp-Bold.woff2', weight: '700' },
    { path: './fonts/PolymathDisp-Super.woff2', weight: '950' },
  ],
  variable: '--font-polymath-display',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
};

export const viewport: Viewport = { themeColor: BRAND };

// Visitor metrics, on the live site only. Typing a search changes ?q= but isn't a new pageview.
const METRICS = `if(location.hostname==='standardicon.com'){var s=document.createElement('script');s.src='https://m.rgan.co/s.js';s.dataset.site='standardicon.com';s.dataset.ignoreParams='q';document.head.append(s)}`;

const CURSOR_ICONS = ['pen-tilted', 'pen-anchor', 'pen-add', 'pen-delete', 'cursor-bezier', 'cursor-simple', 'cursor-hollow'];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The splash page's script adds a class here before React loads, to hold its logo animation.
    <html lang="en" className={`${polymathText.variable} ${polymathDisplay.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: METRICS }} />
        {children}
        <IconMenu />
        <div className="toast" id="toast" role="status" aria-live="polite" />
        <Interactions />
        <AnchorEditor cursorIcons={Object.fromEntries(CURSOR_ICONS.map((name) => [name, icons.find((icon) => icon.name === name)?.body ?? '']))} />
      </body>
    </html>
  );
}

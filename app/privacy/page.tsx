import type { Metadata } from 'next';
import { Page, Section } from '@/components/ui';
import { pageMetadata } from '@/lib/metadata';
import { CREATOR, NAME } from '@/lib/site.mjs';

// DRAFT FOR MORGAN TO APPROVE. Written by an agent from what the code does today: the metrics
// tracker in app/layout.tsx and lib/track.ts, the m.rgan.co server, and the splash canvas in
// components/SplashBoard.tsx and splash/server.mjs. Check every statement before launch, set the
// contact address, fill in how long metrics are kept, and remove the noindex below once it's approved.
export const metadata: Metadata = {
  ...pageMetadata({
    path: '/privacy/',
    title: `Privacy | ${NAME}`,
    description: `What ${NAME} collects when you visit, why, and who sees it.`,
  }),
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <Page
      poster={
        <>
          <p className="big word" aria-hidden="true">Privacy</p>
          <div className="side">
            <p className="lede">This site counts visits to learn which icons people use. It doesn&apos;t use tracking cookies, show ads, or sell anything about you.</p>
          </div>
          <h1 className="titlebar"><span>Privacy</span></h1>
        </>
      }
    >
      <Section title="What's collected">
        <p>When you visit, the site records the pages you view and a few actions: searches, which icons you copy or download and in what format, size, and weight, and which settings you change.</p>
        <p>Each visit also records your full IP address, an approximate location (country and city) that Cloudflare works out from it, your browser and device, your screen and window size and display settings such as dark mode, and the page that linked you here.</p>
        <p>If you allow it when the site asks, a random visitor ID is kept in your browser&apos;s local storage, so repeat visits count as one person. It isn&apos;t a cookie and it doesn&apos;t follow you to other sites.</p>
        <p>If you don&apos;t allow it, or haven&apos;t answered, nothing is kept in your browser for the metrics. Visits are counted with a code made from your IP address and browser that changes every day, so they can&apos;t be linked from one day to the next. You can change your answer any time with Privacy choices at the bottom of every page.</p>
      </Section>
      <Section title="Who handles it">
        <p>The metrics run on {CREATOR}&apos;s own server at m.rgan.co, not on Google Analytics or any other third-party analytics service. Only {CREATOR} can see them.</p>
        <p>To show which company or network a visit came from, IP addresses are sent to IPinfo, a lookup service. The site is served through Cloudflare, which handles every request on the way in.</p>
        {/* TODO(Morgan): how long are metrics kept? Add a sentence here once decided. */}
      </Section>
      <Section title="Settings you pick">
        <p>The size, weight, and view you choose are saved in your browser&apos;s local storage so they&apos;re still set next time. They never leave your device.</p>
      </Section>
      <Section title="The drawing page">
        <p>Icons you save on the drawing page are public: anyone can see them in the list. Your browser keeps your saved drawings and a private edit token in local storage, so you can keep editing your own.</p>
        <p>The server stores each drawing with a hashed copy of its token, never the token itself. It counts requests per IP address to stop spam, and those counts are kept in memory for an hour, not saved.</p>
      </Section>
      <Section title="What isn't done">
        <p>No tracking cookies, no advertising, no selling or sharing data with anyone, and no accounts.</p>
      </Section>
      <Section title="Questions or removal">
        {/* TODO(Morgan): confirm this address exists before launch. */}
        <p>To ask what&apos;s recorded about you or to have it deleted, email <a href="mailto:hello@standardicon.com">hello@standardicon.com</a>. Clearing your browser&apos;s local storage removes the visitor ID, your answer about it, and your saved settings.</p>
      </Section>
    </Page>
  );
}

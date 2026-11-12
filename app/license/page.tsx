import { Page, Section } from '@/components/ui';
import { pageMetadata } from '@/lib/metadata';
import { COUNT, CREATOR, NAME } from '@/lib/site.mjs';

export const metadata = pageMetadata({
  path: '/license/',
  title: `License: free for any project, including commercial | ${NAME}`,
  description: `Every icon in ${NAME} is MIT licensed. Use them in commercial work, change them, and ship them without asking. Credit is welcome but not required.`,
});

// A plain-words summary. LICENSE.txt is the legal text, and it wins if the two ever disagree.
export default function LicensePage() {
  return (
    <Page
      poster={
        <>
          <p className="big word" aria-hidden="true">MIT</p>
          <div className="side">
            <p className="lede">All {COUNT} icons are free to use in anything you make, including work you get paid for.</p>
            <div className="actions">
              <a className="btn" href="/LICENSE.txt">Read the license</a>
            </div>
          </div>
          <h1 className="titlebar"><span>License</span></h1>
        </>
      }
    >
      <Section title="Can I use them commercially?">
        <p>Yes. Use the icons in apps, websites, products, client work, templates, and anything you sell. There&apos;s nothing to pay and no one to ask.</p>
      </Section>
      <Section title="Do I need to credit you?">
        <p>No. A mention or a link back is appreciated, but it isn&apos;t required in your app or on your site.</p>
        <p>The MIT license asks one thing: if you redistribute the icon files or the code themselves, for example in an icon package or a library of your own, keep the copyright notice from <a href="/LICENSE.txt">LICENSE.txt</a> with them.</p>
      </Section>
      <Section title="Can I change the icons?">
        <p>Yes. Recolor them, resize them, redraw parts, combine them, or convert them to another format. You don&apos;t need to share your changes.</p>
      </Section>
      <Section title="What does the license cover?">
        <p>The icons, in every size and weight, and the code that ships them: the SVG files, <code>icons.json</code>, the command-line tool, and the agent files.</p>
      </Section>
      <Section title="What isn't covered?">
        <p>The fonts on this site are Polymath, by OH no Type Company. They&apos;re licensed for this site only, so they aren&apos;t part of the set and you can&apos;t reuse them from here.</p>
        <p>The name {NAME} and its logo identify this project. Use the icons freely, but don&apos;t present your own product as this set or as made by {CREATOR}.</p>
      </Section>
      <Section title="Is there a warranty?">
        <p>No. The icons are provided as they are, without any warranty, as the license says.</p>
      </Section>
    </Page>
  );
}

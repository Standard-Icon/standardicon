import type { ReactNode } from 'react';
import { Page, Section } from '@/components/ui';
import { pageMetadata } from '@/lib/metadata';
import { releases } from '@/lib/releases.mjs';
import { NAME } from '@/lib/site.mjs';

export const metadata = pageMetadata({
  path: '/changelog/',
  title: `Changelog: what changed in each release | ${NAME}`,
  description: `Every release of ${NAME}: new icons, redrawn icons, renames, and changes to the CLI, the React package and the MCP server.`,
});

// CHANGELOG.md uses a small part of Markdown: ### headings, "- " bullets, paragraphs, **bold** and `code`.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{inline(part.slice(2, -2))}</strong> : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part,
  );
}

function Body({ markdown }: { markdown: string }) {
  return markdown.split(/\n{2,}/).map((block, i) => {
    if (block.startsWith('### ')) return <h3 key={i}>{block.slice(4)}</h3>;
    const lines = block.split('\n');
    if (lines.every((line) => line.startsWith('- '))) return <ul key={i} style={{ listStyle: 'disc', paddingLeft: '1.2em' }}>{lines.map((line, j) => <li key={j} style={{ marginBlock: '0.3em' }}>{inline(line.slice(2))}</li>)}</ul>;
    return <p key={i}>{inline(block.replace(/\n/g, ' '))}</p>;
  });
}

export default function ChangelogPage() {
  const list = releases();
  return (
    <Page
      poster={
        <>
          <p className="big word" aria-hidden="true">{list[0]?.version.replace(/-.*/, '') ?? 'New'}</p>
          <div className="side">
            <p className="lede">What changed in each release. Until 1.0.0, every release is an alpha and may change names or defaults.</p>
            <div className="actions">
              <a className="btn" href="https://github.com/Standard-Icon/standardicon/blob/main/CHANGELOG.md">CHANGELOG.md</a>
            </div>
          </div>
          <h1 className="titlebar"><span>Changelog</span></h1>
        </>
      }
    >
      {list.map((r) => (
        <Section key={r.version} title={r.date ? `${r.version} · ${r.date}` : r.version}>
          <Body markdown={r.body} />
        </Section>
      ))}
    </Page>
  );
}

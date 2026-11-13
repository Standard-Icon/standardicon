import { Cmd, JsonLd, Page, Section } from '@/components/ui';
import { LIMITS, SIZES, PAIRING } from '@/lib/icon.mjs';
import { pageMetadata } from '@/lib/metadata';
import { AGENT_PROMPT, AGENTS_SNIPPET, CLI, COUNT, CREATOR, MCP, NAME, ORIGIN, REQUEST_ICON, VERSION } from '@/lib/site.mjs';

export const metadata = pageMetadata({
  path: '/agents/',
  title: `Install SVG icons with your coding agent | ${NAME}`,
  description: `Let Claude Code, Codex, Cursor, or any coding agent install ${COUNT} free SVG icons. One prompt, one command, no account or API key.`,
});

export default function AgentsPage() {
  return (
    <Page
      poster={
        <>
          <p className="big word" aria-hidden="true">Agents</p>
          <div className="side">
            <p className="lede">Your agent can find, install, and use any icon without an account or an API key.</p>
            <div className="actions">
              <button className="btn" type="button" data-copy={AGENT_PROMPT} data-copied="Copied agent prompt">Copy agent prompt</button>
            </div>
          </div>
          <h1 className="titlebar"><span>Agents and CLI</span><span>{COUNT}</span></h1>
        </>
      }
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'Install The Standard Icon Set with a coding agent',
          url: `${ORIGIN}/agents/`,
          author: { '@type': 'Person', name: CREATOR },
        }}
      />
      <Section title="Start with a prompt">
        <p>Paste this into Claude Code, Codex, Cursor, or any agent that can read the web.</p>
        <Cmd text={AGENT_PROMPT} copied="Copied agent prompt" wrap />
      </Section>
      <Section title="Make it permanent">
        <p>Save the skill so Claude Code finds the set in every session. Other agents can read the same file.</p>
        <Cmd text={`mkdir -p .claude/skills/standard-icon && curl -fsS ${ORIGIN}/SKILL.md -o .claude/skills/standard-icon/SKILL.md`} copied="Copied command" />
        <p>Or add this line to the project&apos;s <code>AGENTS.md</code> or <code>CLAUDE.md</code>, so every agent working there uses the set without being asked.</p>
        <Cmd text={AGENTS_SNIPPET} copied="Copied line" wrap />
      </Section>
      <Section title="Use the components in React">
        <p>In a React project, install the components. Only the icons you import end up in the bundle.</p>
        <Cmd text="npm install @standardicon/react" copied="Copied command" />
        <Cmd text={`import { ClockIcon } from '@standardicon/react';`} copied="Copied import" />
      </Section>
      <Section title="Add icons from the command line">
        <p>The CLI needs Node and nothing else. Every icon ships inside it, so it works offline once it&apos;s downloaded.</p>
        <Cmd text={`${CLI} add arrow-up check search --out src/icons`} copied="Copied command" />
        <Cmd text={`${CLI} get arrow-up --size 20`} copied="Copied command" />
        <Cmd text={`${CLI} add arrow-up check --weight thin`} copied="Copied command" />
        <Cmd text={`${CLI} add arrow-up --size 32 --weight bold`} copied="Copied command" />
        <Cmd text={`${CLI} search delete`} copied="Copied command" />
      </Section>
      <Section title="Connect the MCP server">
        <p>Optional, for AI apps that can&apos;t run commands, such as Claude Desktop. It searches the same descriptions as the CLI and returns SVG markup, offline.</p>
        <p>One click: <a href={MCP.cursor}>add to Cursor</a> or <a href={MCP.vscode}>add to VS Code</a>.</p>
        <p>Claude Code:</p>
        <Cmd text={MCP.claude} copied="Copied command" />
        <p>Codex:</p>
        <Cmd text={MCP.codex} copied="Copied command" />
        <p>Claude Desktop and most other apps take this in their MCP settings file:</p>
        <Cmd text={MCP.json} copied="Copied settings" wrap />
      </Section>
      <Section title="Pin a version">
        <p>Until 1.0.0 every release is an alpha, so names and defaults can change. For builds that must not change, pin the packages and the CLI to an exact version. The latest is {VERSION}.</p>
        <Cmd text="npm install --save-dev --save-exact standardicon" copied="Copied command" />
        <Cmd text={`npx standardicon@${VERSION} add arrow-up`} copied="Copied command" />
        <p>The raw files on this site always follow the latest release. A pinned copy of the whole set is on npm&apos;s CDNs, such as <code>https://cdn.jsdelivr.net/npm/standardicon@{VERSION}/icons.json</code>.</p>
      </Section>
      <Section title="Missing an icon?">
        <p>Agents are told not to draw a replacement or borrow one from another set. <a href={REQUEST_ICON}>Request it</a> instead, and say what it&apos;s for.</p>
      </Section>
      <Section title="Fetch icons directly">
        <p>Every icon has a stable URL at each size, with open CORS.</p>
        <Cmd text={`curl -fsS ${ORIGIN}/svg/16/arrow-up.svg -o arrow-up.svg`} copied="Copied command" />
      </Section>
      <Section title="Read the index">
        <ul className="links">
          <li><a href="/llms.txt">llms.txt</a>: instructions written for agents</li>
          <li><a href="/llms-full.txt">llms-full.txt</a>: every name and keyword, in plain text</li>
          <li><a href="/icons.json">icons.json</a>: every icon with its SVG markup</li>
          <li><a href="/SKILL.md">SKILL.md</a>: the agent skill</li>
        </ul>
      </Section>
      <Section title="Sizing, weight, and color">
        <p>Sizes are {SIZES.join(', ')}. {PAIRING} Every size is the 16px drawing scaled up, so lines grow with the icon, like text, and one SVG file works at any size. Icons draw in <code>currentColor</code>, so they pick up the text color around them.</p>
        <p>Weights are thin (a 1px line at 18px), regular (1.33px, the default), semibold (1.5px), bold (2px), and black (2.5px). {LIMITS} Icons with filled shapes come in one weight, regular, and <code>list --weight semibold</code> shows which icons have every weight. Raw files for other weights are at <code>/svg/thin/16/arrow-up.svg</code>.</p>
      </Section>
    </Page>
  );
}

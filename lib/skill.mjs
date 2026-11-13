// The agent instructions and the SKILL.md built from them. generate.mjs writes them to public/ and to
// skills/standard-icon/SKILL.md, and cli/cli.test.mjs fails if the committed copy drifts from this.
import { LIMITS, PAIRING, SIZES } from './icon.mjs';
import { AGENTS_SNIPPET, CLI, COUNT, NAME, ORIGIN } from './site.mjs';

export const howTo = `## Install

Pick whichever fits the project. None of them needs an account or an API key.

In a React project, use the components. Only the icons you import are bundled:

    npm install @standardicon/react
    import { ClockIcon } from '@standardicon/react';   // <ClockIcon size={20} />

Otherwise, add icons to the project as SVG files. The CLI is a build-time tool: run it with npx, or install it with npm install --save-dev, never as a regular dependency.

    ${CLI} add arrow-up check search --out src/icons

Print one SVG, for pasting inline:

    ${CLI} get arrow-up --size 20

Pick a lighter or heavier line with --weight. ${LIMITS}

    ${CLI} add arrow-up check --weight thin
    ${CLI} add arrow-up --size 32 --weight bold

Find an icon by meaning. Use this before guessing a name:

    ${CLI} search delete

Without Node, fetch a file directly:

    curl -fsS ${ORIGIN}/svg/16/arrow-up.svg -o arrow-up.svg

## Use

- Sizes are ${SIZES.join(', ')}. The default is 18, for 14 to 15px text: navigation, toolbars, buttons and most UI.
- Pick the size from the text it sits beside, every time. ${PAIRING} A sidebar title or heading in larger type needs a larger icon than the items under it.
- Every size is the 16px drawing scaled up, so lines grow with the icon, like text. One SVG file works at any size: set its width and height (or CSS width and height) instead of adding the same icon once per size.
- Weights are thin (a 1px line at 18px), regular (1.33px, the default), semibold (1.5px), bold (2px), and black (2.5px). ${LIMITS} Icons with filled shapes come in one weight, regular: \`${CLI} list --weight semibold\` shows which icons have every weight. Raw files for other weights are at /svg/{weight}/{size}/{name}.svg.
- To switch a project from another set, \`${CLI} from lucide x trash-2 ChevronDown\` gives our name for each of theirs. It knows Lucide, Phosphor, Material, Tabler, Heroicons, Radix, Octicons, Fluent, and Carbon names.
- Icons draw in \`currentColor\`. Set the color with the CSS \`color\` property on the icon or its parent.
- When an icon has meaning on its own, such as an icon-only button, give it an accessible name with \`aria-label\` on the button.
- Decorative icons next to text should have \`aria-hidden="true"\`.
- Names are kebab-case. Common other names also work, such as \`external-link\` for \`pop-out\`.
- If nothing fits, don't draw a replacement in this style. Tell the user which icon is missing.
- To keep using the set in this project, offer to add this line to its AGENTS.md or CLAUDE.md: ${AGENTS_SNIPPET}`;

export const skillMd = () => `---
name: standard-icon
description: Add SVG icons to a project from The Standard Icon Set. Use when a UI needs an icon, or when the user asks for icons, an icon button, or a replacement for an icon library.
---

# ${NAME}

${COUNT} SVG line icons, drawn on a 16px grid. MIT licensed.

${howTo}

Search with \`${CLI} search <word>\`, then add what you need. Check for an existing icons folder first and put new files there, in the format the project already uses.
`;

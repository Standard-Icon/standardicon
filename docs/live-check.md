# Live site check

Run `node scripts/live-check.mjs` to check https://standardicon.com, or pass another origin (`node scripts/live-check.mjs http://localhost:4173`). It needs Node 20+ and has no dependencies. It makes about 200 requests, at most 4 at a time, and exits non-zero if it finds a problem. It covers the launch checklist items links, t-live, types, cors, agent-cors and rate.

## Results, 2026-11-13 (live site, 203 requests)

### Problems

- Minor: `http://www.standardicon.com/` does not go straight to `https://standardicon.com/`. It takes two hops (http to https on www, then www to the bare domain). It ends in the right place, but a one-hop redirect is cleaner. Look at the Cloudflare redirect rule or `nginx.conf`.
- Note, not a bug: the home page contains a link to `/cdn-cgi/l/email-protection#...`. Cloudflare's Email Address Obfuscation inserted it, and it returns 404 without its hash fragment. The script skips `/cdn-cgi/` links. If you would rather not have Cloudflare rewrite addresses in the HTML, turn that setting off.
- Gap: the pages the script crawls contain only one external link (github.com). There are no npm links and no `standardicon-*.tgz` link on the site, so those were not checked.

### Passed

- Every URL in `/llms.txt` (50) returns 200.
- 100 pages crawled (home, agents, examples, license, privacy, changelog, all category pages, 50 sampled icon pages) plus 6 other internal links: all 200, no redirects. The one external link (github.com) answers.
- Content-Type is right for an SVG, a bold SVG, `/icons.json`, `/llms.txt`, `/llms-full.txt`, `/SKILL.md`, `/sitemap.xml`, `/robots.txt`, `/.well-known/security.txt` and `/.well-known/mcp-registry-auth`.
- CORS: `/svg/16/arrow-up.svg`, `/svg/bold/32/arrow-up.svg`, `/svg/24/clock.svg` and `/icons.json` all send `Access-Control-Allow-Origin: *` for `Origin: https://example.com`.
- `http://standardicon.com/` and `https://www.standardicon.com/` both 301 to `https://standardicon.com/`.
- 30 SVG fetches in quick succession: no 429, no 403, no Cloudflare challenge.
- `/llms.txt` returns 200 for the User-Agents ClaudeBot, GPTBot, PerplexityBot, curl/8 and node.

import type { MetadataRoute } from 'next';
import { execFileSync } from 'node:child_process';
import { ORIGIN, categories, icons, inCategory } from '@/lib/site.mjs';

export const dynamic = 'force-static';

// Each page's date is when its content last changed in git, not when the site was built, so search
// engines can trust it. An icon changes with its record; a category or the home page changes with
// its newest icon. Builds without git history (the Docker build skips .git) leave dates out, which
// is better than a build time that changes on every deploy.
function lastCommits(paths: string[]) {
  const dates = new Map<string, Date>();
  try {
    const log = execFileSync('git', ['log', '--format=%x00%cI', '--name-only', '--', ...paths], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    for (const entry of log.split('\0').slice(1)) {
      const [date, ...files] = entry.trim().split('\n');
      // Newest commits come first, so the first date seen for a file is its latest.
      for (const file of files) if (file && !dates.has(file)) dates.set(file, new Date(date));
    }
  } catch {
    // No git, or not a repository: no dates.
  }
  return dates;
}

const newest = (dates: (Date | undefined)[]) => dates.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];

const PAGES: Record<string, string> = {
  '/examples/': 'app/examples/page.tsx',
  '/agents/': 'app/agents/page.tsx',
  '/license/': 'app/license/page.tsx',
  '/privacy/': 'app/privacy/page.tsx',
};

export default function sitemap(): MetadataRoute.Sitemap {
  const commits = lastCommits(['icons/records', 'icons/icons.json', ...Object.values(PAGES)]);
  const iconDate = (name: string) => commits.get(`icons/records/${name}.json`);
  const anyIcon = commits.get('icons/icons.json');
  const entry = (path: string, lastModified: Date | undefined) => ({ url: `${ORIGIN}${path}`, ...(lastModified && { lastModified }) });

  return [
    entry('/', newest([anyIcon, ...icons.map((i) => iconDate(i.name))])),
    ...Object.entries(PAGES).map(([path, file]) => entry(path, commits.get(file))),
    ...categories.map((c) => entry(`/categories/${c}/`, newest(inCategory(c).map((i) => iconDate(i.name))) ?? anyIcon)),
    ...icons.map((i) => entry(`/icons/${i.name}/`, iconDate(i.name) ?? anyIcon)),
  ];
}

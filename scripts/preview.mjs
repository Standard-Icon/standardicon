#!/usr/bin/env node
// Publishes the latest local commit to the password-protected preview site. Everything the preview needs
// (its port and password) is added here, in a commit that only exists in the private preview repo, so this
// repo's site, and its launch, stay untouched. Uncommitted changes aren't included.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const REPO = 'https://github.com/morganknutson/standardicon-preview.git';
const PORT = 3028;
const USER = 'preview';
const KEYCHAIN = ['find-generic-password', '-s', 'standardicon-preview', '-a', USER, '-w'];

const temp = mkdtempSync(join(tmpdir(), 'preview-'));
const index = join(temp, 'index');
const git = (args, options = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: index }, ...options }).trim();

function replaceOnce(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`Couldn't find "${from}" in ${file}, so the preview can't be protected.`);
  return text.replace(from, to);
}

try {
  const password = process.env.PREVIEW_PASSWORD ?? execFileSync('security', KEYCHAIN, { encoding: 'utf8' }).trim();
  const head = git(['rev-parse', 'HEAD']);
  const show = (file) => git(['show', `${head}:${file}`]);
  const add = (file, text) => {
    const path = join(temp, 'blob');
    writeFileSync(path, `${text}\n`);
    git(['update-index', '--add', '--cacheinfo', `100644,${git(['hash-object', '-w', path])},${file}`]);
  };

  git(['read-tree', head]);
  // The preview shows the full site, or the old splash with PREVIEW_SPLASH=1.
  const splash = process.env.PREVIEW_SPLASH === '1';
  const compose = replaceOnce(show('docker-compose.yml'), '127.0.0.1:3027:', `127.0.0.1:${PORT}:`, 'docker-compose.yml');
  add('docker-compose.yml', compose.replace(/NGINX_CONF: \S+/, `NGINX_CONF: ${splash ? 'splash/nginx.conf' : 'nginx.conf'}`));
  const auth = 'listen 80;\n    auth_basic "The Standard Icon Set preview";\n    auth_basic_user_file /etc/nginx/preview.htpasswd;';
  add('splash/nginx.conf', replaceOnce(show('splash/nginx.conf'), 'listen 80;', auth, 'splash/nginx.conf'));
  add('nginx.conf', replaceOnce(show('nginx.conf'), 'listen 80;', 'listen 80;\n    auth_basic "The Standard Icon Set preview";\n    auth_basic_user_file /etc/nginx/preview.htpasswd;', 'nginx.conf'));
  add('Dockerfile', replaceOnce(show('Dockerfile'), 'EXPOSE 80', 'COPY preview.htpasswd /etc/nginx/preview.htpasswd\nEXPOSE 80', 'Dockerfile'));
  add('preview.htpasswd', `${USER}:${execFileSync('openssl', ['passwd', '-apr1', '-stdin'], { input: password, encoding: 'utf8' }).trim()}`);
  const tree = git(['write-tree']);

  // Building on the last published commit keeps the server's git pull a fast-forward.
  const last = git(['ls-remote', REPO, 'refs/heads/main']).split(/\s/)[0];
  if (last) git(['fetch', '-q', REPO, 'main']);
  const parents = last ? ['-p', last, '-p', head] : ['-p', head];
  const subject = git(['log', '-1', '--format=%h %s', head]);
  const commit = git(['commit-tree', tree, ...parents, '-m', `Preview of ${subject}`]);
  git(['push', '-q', REPO, `${commit}:refs/heads/main`]);
  console.log(`Published ${subject}\nIt'll be at https://preview.standardicon.com in a few minutes.`);
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}

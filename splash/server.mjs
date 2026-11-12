// The public icon list behind the /splash drawing page. No dependencies. nginx sends /splash/api/ here.
//
// Drawings are stored as validated numbers and nothing else, so no submitted
// markup is ever stored or rendered. Each icon is one JSON file in DATA_DIR/icons.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const ICONS_DIR = join(DATA_DIR, "icons");
const LAST_ID_FILE = join(DATA_DIR, "last-id");
const PID_FILE = join(DATA_DIR, "server.pid");

const GRID = 16;
const HANDLE_REACH = 16; // Curve handles can reach past the canvas, by up to its own width.
const MAX_BODY_BYTES = 32 * 1024;
const MAX_PATHS = 64;
const MAX_ANCHORS = 512;
const MAX_ICONS = Number(process.env.MAX_ICONS ?? 5000);
const PAGE_SIZE = 120;
const HOUR = 60 * 60 * 1000;
const LIMITS = {
  create: { max: 20, windowMs: HOUR },
  update: { max: 240, windowMs: HOUR },
  allCreates: { max: Number(process.env.MAX_CREATES_PER_HOUR ?? 300), windowMs: HOUR },
};

const SECURITY_HEADERS = {
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};
// --- Storage ---

let icons = new Map(); // id -> { id, tokenHash, paths, createdAt, updatedAt }
let newestFirst = [];
let lastId = 0;

function writeAtomically(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { flush: true });
  renameSync(temporary, path);
}

// Also runs on SIGHUP, which is how delete-icon.mjs tells this process about a deletion.
function loadIcons() {
  mkdirSync(ICONS_DIR, { recursive: true });
  const loaded = new Map();
  for (const name of readdirSync(ICONS_DIR)) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const icon = JSON.parse(readFileSync(join(ICONS_DIR, name), "utf8"));
      loaded.set(icon.id, icon);
    } catch (error) {
      console.error(`Skipping unreadable icon ${name}: ${error.message}`);
    }
  }
  icons = loaded;
  newestFirst = [...icons.values()].sort((a, b) => b.id - a.id);
  // Deleted numbers are never reused, so a stale edit token can't reach a newer icon.
  let savedLastId = 0;
  try {
    savedLastId = Number(readFileSync(LAST_ID_FILE, "utf8")) || 0;
  } catch {}
  lastId = Math.max(lastId, savedLastId, newestFirst[0]?.id ?? 0);
}

function saveIcon(icon) {
  writeAtomically(join(ICONS_DIR, `${icon.id}.json`), JSON.stringify(icon));
}

// --- Validation ---

// A drawing is { paths: [{ closed, anchors: [[x, y] or [x, y, inX, inY, outX, outY], ...] }, ...] }.
function parsePaths(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "paths") return null;
  const { paths } = body;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_PATHS) return null;
  const inCanvas = (n) => Number.isFinite(n) && n >= 0 && n <= GRID;
  const inReach = (n) => Number.isFinite(n) && n >= -HANDLE_REACH && n <= GRID + HANDLE_REACH;
  const rounded = (n) => +n.toFixed(3);
  let total = 0;
  const clean = [];
  for (const path of paths) {
    if (path === null || typeof path !== "object" || Array.isArray(path)) return null;
    const pathKeys = Object.keys(path).sort().join();
    if (pathKeys !== "anchors,closed" || typeof path.closed !== "boolean" || !Array.isArray(path.anchors)) return null;
    if (path.anchors.length < 1) return null;
    total += path.anchors.length;
    if (total > MAX_ANCHORS) return null;
    const anchors = [];
    for (const anchor of path.anchors) {
      if (!Array.isArray(anchor) || (anchor.length !== 2 && anchor.length !== 6)) return null;
      if (!inCanvas(anchor[0]) || !inCanvas(anchor[1])) return null;
      if (!anchor.slice(2).every(inReach)) return null;
      anchors.push(anchor.map(rounded));
    }
    clean.push({ closed: path.closed, anchors });
  }
  return clean;
}

// Drawings from before the anchor editor were whole-pixel strokes, drawn through pixel centres.
function pathsOf({ paths, strokes }) {
  if (paths) return paths;
  return strokes.map((stroke) => {
    const anchors = [];
    for (let i = 0; i < stroke.length; i += 2) anchors.push([stroke[i] + 0.5, stroke[i + 1] + 0.5]);
    return { closed: false, anchors };
  });
}

// --- Rate limiting ---

const windows = new Map();

function overLimit(key, { max, windowMs }) {
  const now = Date.now();
  let entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    windows.set(key, entry);
  }
  entry.count += 1;
  return entry.count > max ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
}, 10 * 60 * 1000).unref();

// The port is only published on the server's loopback, so requests arrive through
// Cloudflare, which always sets this header. Anything else shares one bucket.
function clientIp(req) {
  return req.headers["cf-connecting-ip"] || "no-client-ip";
}

// --- Tokens ---

const hashToken = (token) => createHash("sha256").update(token).digest();

function tokenMatches(req, icon) {
  const token = req.headers["x-edit-token"];
  if (typeof token !== "string" || token.length < 1 || token.length > 200) return false;
  return timingSafeEqual(hashToken(token), Buffer.from(icon.tokenHash, "hex"));
}

// --- Responses ---

function send(req, res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(req.method === "HEAD" ? undefined : body);
}

function sendJson(req, res, status, data, headers = {}) {
  send(req, res, status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }, JSON.stringify(data));
}

const fail = (req, res, status, error, headers) => sendJson(req, res, status, { error }, headers);
const publicIcon = (icon) => ({ id: icon.id, paths: pathsOf(icon) });

async function readJsonBody(req) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return { status: 415 };
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return { status: 413 };
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { status: 413 };
    chunks.push(chunk);
  }
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { status: 400 };
  }
}

// Reads and validates a drawing, or sends the failure and returns null.
async function readPaths(req, res) {
  const { status, body } = await readJsonBody(req);
  if (status === 413) {
    res.setHeader("Connection", "close");
    fail(req, res, 413, "That drawing is too big.");
    return null;
  }
  if (status === 415) {
    fail(req, res, 415, "Send JSON.");
    return null;
  }
  const paths = status ? null : parsePaths(body);
  if (!paths) fail(req, res, 400, "That isn't a valid drawing.");
  return paths;
}

function rateLimited(req, res, retryAfter) {
  fail(req, res, 429, "Too many saves. Try again later.", { "Retry-After": String(retryAfter) });
}

// --- API ---

function listIcons(req, res, query) {
  const before = Number(query.get("before")) || Infinity;
  const remaining = newestFirst.filter((icon) => icon.id < before);
  const page = remaining.slice(0, PAGE_SIZE);
  sendJson(req, res, 200, {
    total: newestFirst.length,
    icons: page.map(publicIcon),
    more: remaining.length > page.length,
  });
}

async function createIcon(req, res) {
  const retryAfter = overLimit(`create:${clientIp(req)}`, LIMITS.create);
  if (retryAfter) return rateLimited(req, res, retryAfter);
  const paths = await readPaths(req, res);
  if (!paths) return;
  if (icons.size >= MAX_ICONS) return fail(req, res, 507, "The list is full.");
  const globalRetryAfter = overLimit("create:everyone", LIMITS.allCreates);
  if (globalRetryAfter) return rateLimited(req, res, globalRetryAfter);

  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const icon = { id: lastId + 1, tokenHash: hashToken(token).toString("hex"), paths, createdAt: now, updatedAt: now };
  writeAtomically(LAST_ID_FILE, String(icon.id));
  saveIcon(icon);
  lastId = icon.id;
  icons.set(icon.id, icon);
  newestFirst.unshift(icon);
  sendJson(req, res, 201, { id: icon.id, token });
}

async function updateIcon(req, res, id) {
  const retryAfter = overLimit(`update:${clientIp(req)}`, LIMITS.update);
  if (retryAfter) return rateLimited(req, res, retryAfter);
  const paths = await readPaths(req, res);
  if (!paths) return;
  const icon = icons.get(id);
  if (!icon) return fail(req, res, 404, "This icon was removed.");
  if (!tokenMatches(req, icon)) return fail(req, res, 403, "Only the person who drew this icon can change it.");
  const { strokes: legacy, ...rest } = icon;
  const updated = { ...rest, paths, updatedAt: new Date().toISOString() };
  saveIcon(updated);
  icons.set(id, updated);
  newestFirst[newestFirst.indexOf(icon)] = updated;
  sendJson(req, res, 200, { id });
}

function getIcon(req, res, id) {
  const icon = icons.get(id);
  if (!icon) return fail(req, res, 404, "This icon was removed.");
  sendJson(req, res, 200, publicIcon(icon));
}

async function handleApi(req, res, path, query) {
  if (path === "/splash/api/icons") {
    if (req.method === "GET" || req.method === "HEAD") return listIcons(req, res, query);
    if (req.method === "POST") return createIcon(req, res);
    return fail(req, res, 405, "Method not allowed.", { Allow: "GET, HEAD, POST" });
  }
  const match = /^\/splash\/api\/icons\/([1-9]\d{0,8})$/.exec(path);
  if (!match) return fail(req, res, 404, "Not found.");
  const id = Number(match[1]);
  if (req.method === "GET" || req.method === "HEAD") return getIcon(req, res, id);
  if (req.method === "PUT") return updateIcon(req, res, id);
  return fail(req, res, 405, "Method not allowed.", { Allow: "GET, HEAD, PUT" });
}

// --- Routing ---

async function handle(req, res) {
  const [path, search = ""] = req.url.split("?");
  if (path.startsWith("/splash/api/")) return handleApi(req, res, path, new URLSearchParams(search));
  return fail(req, res, 404, "Not found.");
}

// --- Start ---

// A storage problem shouldn't take the page down. Saves fail until it's fixed.
function loadIconsSafely() {
  try {
    loadIcons();
  } catch (error) {
    console.error(`Couldn't load icons: ${error.message}`);
  }
}

loadIconsSafely();
try {
  writeFileSync(PID_FILE, String(process.pid));
} catch (error) {
  console.error(`Couldn't write ${PID_FILE}: ${error.message}`);
}
process.on("SIGHUP", loadIconsSafely);
process.on("SIGTERM", () => process.exit(0));

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (res.headersSent) res.destroy();
    else fail(req, res, 500, "Something went wrong. Try again.");
  });
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(PORT, "127.0.0.1", () => console.log(`Splash listening on ${PORT}, ${icons.size} icons in ${ICONS_DIR}`));

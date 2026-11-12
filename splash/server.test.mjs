// node --test splash/server.test.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const HERE = new URL(".", import.meta.url).pathname;
// This range and the three above it avoid the ports fetch refuses to connect to, such as 4045.
const PORT = 5100 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "splash-test-"));
let server;
let nextIp = 1;
const children = new Set(); // A failed test can't reach its cleanup, and a running child would hang the run.

async function startServer(env = {}, port = PORT, dir = dataDir) {
  const child = spawn(process.execPath, [join(HERE, "server.mjs")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, ...env },
    stdio: "ignore",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/splash/api/icons`);
      return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Server didn't start");
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

// Each test acts as a different visitor unless it passes an ip, so limits don't collide.
function write(method, path, body, { token, ip = `10.0.0.${nextIp++}`, base = BASE } = {}) {
  return fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      ...(token ? { "X-Edit-Token": token } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const path = (...anchors) => ({ closed: false, anchors });
const DRAWING = { paths: [path([1, 1], [14, 14])] };

async function create(drawing = DRAWING, options) {
  const response = await write("POST", "/splash/api/icons", drawing, options);
  assert.equal(response.status, 201);
  return response.json();
}

before(async () => {
  server = await startServer();
});

after(async () => {
  await Promise.all([...children].map(stopServer));
  rmSync(dataDir, { recursive: true, force: true });
});

test("only the API is served here", async () => {
  for (const url of ["/", "/splash/", "/server.mjs", "/splash/server.mjs", "/splash/../server.mjs"]) {
    const response = await fetch(BASE + url);
    assert.equal(response.status, 404, url);
    assert.doesNotMatch(await response.text(), /createServer/);
  }
  assert.equal((await fetch(`${BASE}/splash/api/icons`)).headers.get("x-robots-tag"), "noindex");
});

test("saving adds an icon to the public list without exposing its token", async () => {
  const { id, token } = await create();
  assert.ok(token.length > 30);
  const list = await (await fetch(`${BASE}/splash/api/icons`)).text();
  const icon = JSON.parse(list).icons.find((each) => each.id === id);
  assert.deepEqual(icon, { id, paths: DRAWING.paths });
  assert.ok(!list.includes(token));
  assert.ok(!list.includes("tokenHash"));
  assert.ok(!readFileSync(join(dataDir, "icons", `${id}.json`), "utf8").includes(token));
});

test("saving again updates the same icon", async () => {
  const { id, token } = await create();
  const before = (await (await fetch(`${BASE}/splash/api/icons`)).json()).total;
  const paths = [path([1, 1], [14, 14]), { closed: true, anchors: [[3, 3], [6, 3, 5, 2, 7, 4], [6, 6]] }];
  const response = await write("PUT", `/splash/api/icons/${id}`, { paths }, { token });
  assert.equal(response.status, 200);
  const list = await (await fetch(`${BASE}/splash/api/icons`)).json();
  assert.equal(list.total, before);
  assert.deepEqual(list.icons.find((each) => each.id === id).paths, paths);
});

test("nobody else can overwrite an icon", async () => {
  const { id, token } = await create();
  const other = await create();
  const attempts = [{}, { token: "wrong" }, { token: other.token }, { token: token.slice(0, -1) }];
  for (const options of attempts) {
    assert.equal((await write("PUT", `/splash/api/icons/${id}`, { paths: [path([0, 0])] }, options)).status, 403);
  }
  const icon = await (await fetch(`${BASE}/splash/api/icons/${id}`)).json();
  assert.deepEqual(icon.paths, DRAWING.paths);
});

test("anything but a valid drawing is refused", async () => {
  const anchors = (n) => Array.from({ length: n }, () => [1, 1]);
  const bad = [
    "not json",
    "null",
    "[]",
    {},
    { paths: [] },
    { paths: [path()] },
    { paths: "M0 0L1 1" },
    { paths: ["<svg onload=alert(1)>"] },
    { paths: [{ closed: "yes", anchors: [[1, 1]] }] },
    { paths: [{ anchors: [[1, 1]] }] },
    { paths: [{ closed: false, anchors: [[1, 1]], d: "M0 0" }] },
    { paths: [path([1])] },
    { paths: [path([1, 1, 1])] },
    { paths: [path(["1", "1"])] },
    { paths: [path([-1, 1])] },
    { paths: [path([16.5, 1])] },
    { paths: [path([1, null])] },
    { paths: [path([1, 1, 2, 2, 3, 99])] },
    { paths: [path([1, 1, 2, 2, 3, "3"])] },
    { paths: [path([1, 1])], svg: "<svg/>" },
    { paths: Array.from({ length: 65 }, () => path([1, 1])) },
    { paths: [path(...anchors(513))] },
  ];
  const { id, token } = await create();
  for (const body of bad) {
    assert.equal((await write("POST", "/splash/api/icons", body)).status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal((await write("PUT", `/splash/api/icons/${id}`, body, { token })).status, 400);
  }
});

test("oversized bodies and other content types are refused", async () => {
  const big = JSON.stringify({ paths: [path([1, 1])], pad: "x".repeat(40_000) });
  assert.equal((await write("POST", "/splash/api/icons", big)).status, 413);
  const form = await fetch(`${BASE}/splash/api/icons`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(DRAWING) });
  assert.equal(form.status, 415);
});

test("creating is rate limited per client IP, and others are unaffected", async () => {
  const ip = "192.0.2.1";
  for (let i = 0; i < 20; i++) await create(DRAWING, { ip });
  const limited = await write("POST", "/splash/api/icons", DRAWING, { ip });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  await create(DRAWING, { ip: "192.0.2.2" });
});

test("the list comes in pages", async () => {
  for (let batch = 0; batch < 7; batch++) {
    const ip = `198.51.100.${batch}`;
    for (let i = 0; i < 20; i++) await create(DRAWING, { ip });
  }
  const first = await (await fetch(`${BASE}/splash/api/icons`)).json();
  assert.equal(first.icons.length, 120);
  assert.equal(first.more, true);
  const last = first.icons.at(-1).id;
  const second = await (await fetch(`${BASE}/splash/api/icons?before=${last}`)).json();
  assert.ok(second.icons.every((icon) => icon.id < last));
});

test("icons survive a restart, and old tokens keep working", async () => {
  const { id, token } = await create();
  await stopServer(server);
  server = await startServer();
  assert.equal((await fetch(`${BASE}/splash/api/icons/${id}`)).status, 200);
  assert.equal((await write("PUT", `/splash/api/icons/${id}`, { paths: [path([2, 2])] }, { token })).status, 200);
});

test("deleting removes an icon at once, and its number is never reused", async () => {
  const { id, token } = await create();
  const run = spawnSync(process.execPath, [join(HERE, "delete-icon.mjs"), String(id)], {
    env: { ...process.env, DATA_DIR: dataDir },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await fetch(`${BASE}/splash/api/icons/${id}`)).status, 404);
  assert.equal((await write("PUT", `/splash/api/icons/${id}`, DRAWING, { token })).status, 404);
  assert.ok(!existsSync(join(dataDir, "icons", `${id}.json`)));

  await stopServer(server);
  server = await startServer();
  const next = await create();
  assert.equal(next.id, id + 1);
});

test("the delete command refuses bad input and reports unknown icons", () => {
  const run = (...args) =>
    spawnSync(process.execPath, [join(HERE, "delete-icon.mjs"), ...args], {
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: "utf8",
    });
  assert.equal(run().status, 1);
  assert.equal(run("../../etc/passwd").status, 1);
  assert.equal(run("999999").status, 1);
});

test("the list stops growing at its cap, and existing icons can still change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "splash-cap-"));
  const port = PORT + 100;
  const base = `http://127.0.0.1:${port}`;
  const child = await startServer({ MAX_ICONS: "1" }, port, dir);
  const { id, token } = await create(DRAWING, { base });
  assert.equal((await write("POST", "/splash/api/icons", DRAWING, { base })).status, 507);
  assert.equal((await write("PUT", `/splash/api/icons/${id}`, DRAWING, { token, base })).status, 200);
  assert.equal(readdirSync(join(dir, "icons")).length, 1);
  await stopServer(child);
  rmSync(dir, { recursive: true, force: true });
});

test("all visitors together have a create limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "splash-global-"));
  const port = PORT + 101;
  const base = `http://127.0.0.1:${port}`;
  const child = await startServer({ MAX_CREATES_PER_HOUR: "2" }, port, dir);
  await create(DRAWING, { base });
  await create(DRAWING, { base });
  assert.equal((await write("POST", "/splash/api/icons", DRAWING, { base })).status, 429);
  await stopServer(child);
  rmSync(dir, { recursive: true, force: true });
});

test("the list still answers when storage can't be used", async () => {
  const port = PORT + 102;
  const base = `http://127.0.0.1:${port}`;
  const child = await startServer({}, port, "/dev/null/nope");
  assert.equal((await fetch(`${base}/splash/api/icons`)).status, 200);
  assert.equal((await write("POST", "/splash/api/icons", DRAWING, { base })).status, 500);
  await stopServer(child);
});

test("handles round to three places, and may reach past the canvas", async () => {
  const { id } = await create({ paths: [path([1.23456, 2, 1, 1, -5.55555, 30])] });
  const icon = await (await fetch(`${BASE}/splash/api/icons/${id}`)).json();
  assert.deepEqual(icon.paths[0].anchors[0], [1.235, 2, 1, 1, -5.556, 30]);
});

test("drawings from before the anchor editor still load and can be edited", async () => {
  const { id, token } = await create();
  await stopServer(server);
  const file = join(dataDir, "icons", `${id}.json`);
  const { paths, ...icon } = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...icon, strokes: [[1, 2, 3, 4], [5, 6]] }));
  server = await startServer();
  const loaded = await (await fetch(`${BASE}/splash/api/icons/${id}`)).json();
  assert.deepEqual(loaded.paths, [path([1.5, 2.5], [3.5, 4.5]), path([5.5, 6.5])]);
  assert.equal((await write("PUT", `/splash/api/icons/${id}`, DRAWING, { token })).status, 200);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(saved.paths, DRAWING.paths);
  assert.equal(saved.strokes, undefined);
});

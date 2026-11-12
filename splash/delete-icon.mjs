// Deletes icons from the /splash page's public list by the number shown under each one.
//   makserve exec standardicon.com node delete-icon.mjs 12 13
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dataDir = process.env.DATA_DIR ?? "/data";
const ids = process.argv.slice(2);

if (ids.length === 0 || !ids.every((id) => /^[1-9]\d{0,8}$/.test(id))) {
  console.error("Usage: node delete-icon.mjs <number> [<number> ...]");
  process.exit(1);
}

let failed = false;
for (const id of ids) {
  const file = join(dataDir, "icons", `${id}.json`);
  if (existsSync(file)) {
    rmSync(file);
    console.log(`Deleted icon ${id}`);
  } else {
    console.error(`There is no icon ${id}`);
    failed = true;
  }
}

// The server keeps the list in memory, so tell it to read the files again.
process.kill(Number(readFileSync(join(dataDir, "server.pid"), "utf8")), "SIGHUP");
process.exit(failed ? 1 : 0);

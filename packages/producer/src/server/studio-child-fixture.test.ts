import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { reapStudioChildren } from "./__fixtures__/studio-child-reaper.js";

const fixture = fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A middle process (standing in for a vitest worker or Producer) that starts the fixture and reports its pid. */
async function orphanable(pids: string) {
  const script = `const { spawn } = require("node:child_process");
const child = spawn(process.execPath, [${JSON.stringify(fixture)}], { stdio: "ignore", env: { ...process.env, PORT: "0", HOSTNAME: "127.0.0.1" } });
console.log(child.pid); setInterval(() => {}, 1000);`;
  const parent = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, CLOSSYS_STUDIO_CHILD_PIDS: pids } });
  const [line] = await once(parent.stdout!, "data");
  return { parent, child: Number(String(line).trim()) };
}

async function until(check: () => boolean, ms: number) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise(next => setTimeout(next, 50));
  return check();
}

it("the Studio child fixture exits on its own once the process that spawned it is killed", async () => {
  const pids = mkdtempSync(join(tmpdir(), "studio-child-test-")); dirs.push(pids);
  const { parent, child } = await orphanable(pids);
  expect(await until(() => existsSync(join(pids, String(child))), 5_000)).toBe(true);
  expect(alive(child)).toBe(true);
  parent.kill("SIGKILL"); await once(parent, "exit");
  expect(await until(() => !alive(child), 3_000)).toBe(true);
  expect(readdirSync(pids)).toEqual([]);
}, 15_000);

it("the reaper kills and names a recorded Studio child that is still running", async () => {
  const pids = mkdtempSync(join(tmpdir(), "studio-child-test-")); dirs.push(pids);
  const { parent, child } = await orphanable(pids);
  try {
    expect(await until(() => existsSync(join(pids, String(child))), 5_000)).toBe(true);
    expect(await reapStudioChildren(pids, 200)).toEqual([child]);
    expect(await until(() => !alive(child), 2_000)).toBe(true);
  } finally { parent.kill("SIGKILL"); }
}, 15_000);

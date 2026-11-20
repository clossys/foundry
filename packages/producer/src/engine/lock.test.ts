import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_DIR, LOCK_FILE, verifyChain } from "./chain.js";
import { EngineBusyError, FOREIGN_LOCK_MS, OWNERLESS_LOCK_MS, staleOwner, withEngineLock } from "./lock.js";
import { appendEvent } from "./log.js";

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "engine-lock-")));
  mkdirSync(join(root, ENGINE_DIR), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Node runs the engine's .ts files directly in the child: `.js` specifiers resolve to the `.ts` beside them. */
const HOOK = `
import { register } from "node:module";
const hook = 'import { existsSync } from "node:fs"; import { fileURLToPath } from "node:url";' +
  'export async function resolve(s, c, n) { if ((s.startsWith(".") || s.startsWith("/")) && s.endsWith(".js") && c.parentURL) {' +
  ' const ts = new URL(s.slice(0, -3) + ".ts", c.parentURL); if (existsSync(fileURLToPath(ts))) return n(ts.href, c); } return n(s, c); }';
register("data:text/javascript," + encodeURIComponent(hook), import.meta.url);
`;
/** Appends `count` events through appendEvent, retrying on EngineBusyError. */
const WRITER = `${HOOK}
const [log, root, tag, count, go] = process.argv.slice(2);
const { appendEvent } = await import(log);
const { existsSync } = await import("node:fs");
while (!existsSync(go)) await new Promise(done => setTimeout(done, 1));
let busy = 0;
for (let i = 0; i < Number(count); i++) {
  for (;;) {
    try { appendEvent(root, { actor: "agent:" + tag, kind: "slot.submit", subject: tag + "/" + i, inputs: [] }, { waitMs: 50 }); break; }
    catch (error) { if (error?.code !== "ENGINE_BUSY") throw error; busy++; }
  }
}
console.log(JSON.stringify({ tag, busy }));
`;
/** Holds the engine lock until `release` exists, after writing `held`. */
const HOLDER = `${HOOK}
const [lockModule, lock, held, release] = process.argv.slice(2);
const { withEngineLock } = await import(lockModule);
const { existsSync, writeFileSync } = await import("node:fs");
withEngineLock(lock, () => {
  writeFileSync(held, "1");
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(release)) Atomics.wait(sleeper, 0, 0, 5);
});
`;
const engineModule = (name: string) => fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
const run = (script: string, args: string[]) => {
  const child = spawn(process.execPath, ["--no-warnings", script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", chunk => { out += String(chunk); });
  child.stderr.on("data", chunk => { err += String(chunk); });
  const done = new Promise<{ code: number | null; out: string; err: string }>(resolve => child.on("close", code => resolve({ code, out, err })));
  return { child, done };
};
const waitFor = async (path: string, ms = 10_000) => {
  const deadline = Date.now() + ms;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise(done => setTimeout(done, 5));
  }
};
const lock = () => join(root, LOCK_FILE);
const owner = (fields: Record<string, unknown>) => JSON.stringify({ token: "t", ...fields });
const deadPid = () => spawnSync(process.execPath, ["-e", "0"]).pid!;

describe("engine lock: two writer processes (engine/lock.ts)", () => {
  it("serializes two real child processes appending at once: one chain, every seq once", async () => {
    const script = join(root, "writer.mjs");
    writeFileSync(script, WRITER);
    const go = join(root, "go");
    const COUNT = 40;
    const writers = ["a", "b"].map(tag => run(script, [engineModule("log"), root, tag, String(COUNT), go]));
    writeFileSync(go, "");
    const results = await Promise.all(writers.map(writer => writer.done));
    for (const result of results) expect(result, result.err).toMatchObject({ code: 0 });
    const report = verifyChain(root);
    expect(report.issues).toEqual([]);
    expect(report.count).toBe(2 * COUNT);
    expect(report.events.map(event => event.seq)).toEqual([...Array(2 * COUNT).keys()]);
    for (const tag of ["a", "b"]) expect(report.events.filter(event => event.actor === `agent:${tag}`)).toHaveLength(COUNT);
    expect(existsSync(lock())).toBe(false);
  }, 60_000);

  it("refuses with EngineBusyError while another process holds the lock, and writes nothing", async () => {
    const script = join(root, "holder.mjs");
    writeFileSync(script, HOLDER);
    const held = join(root, "held"), release = join(root, "release");
    const holder = run(script, [engineModule("lock"), lock(), held, release]);
    try {
      await waitFor(held);
      let error: unknown;
      try { appendEvent(root, { actor: "code:test", kind: "slot.submit", subject: "x", inputs: [] }, { waitMs: 100 }); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(EngineBusyError);
      expect((error as EngineBusyError).code).toBe("ENGINE_BUSY");
      expect((error as EngineBusyError).holder?.pid).toBe(holder.child.pid);
      expect(String((error as Error).message)).toMatch(/engine busy: .*engine\.lock is held by pid \d+ on .* nothing was written/);
      expect(verifyChain(root).count).toBe(0);
    } finally {
      writeFileSync(release, "");
      expect((await holder.done).code).toBe(0);
    }
    expect(existsSync(lock())).toBe(false);
    appendEvent(root, { actor: "code:test", kind: "slot.submit", subject: "x", inputs: [] });
    expect(verifyChain(root).count).toBe(1);
  }, 30_000);
});

describe("engine lock: stale-lock recovery", () => {
  const append = () => appendEvent(root, { actor: "code:test", kind: "slot.submit", subject: "x", inputs: [] }, { waitMs: 50 });

  it("takes over a lock whose owner pid on this host is dead", () => {
    writeFileSync(lock(), owner({ pid: deadPid(), host: hostname(), at: Date.now() }));
    expect(append().seq).toBe(0);
    expect(existsSync(lock())).toBe(false);
    expect(readdirSync(join(root, ENGINE_DIR)).filter(name => name.includes(".stale-"))).toEqual([]);
  });

  it("takes over a lock held from another host past FOREIGN_LOCK_MS, and waits on a fresher one", () => {
    writeFileSync(lock(), owner({ pid: 1, host: "elsewhere.invalid", at: Date.now() - 1000 }));
    expect(append).toThrow(EngineBusyError);
    writeFileSync(lock(), owner({ pid: 1, host: "elsewhere.invalid", at: Date.now() - FOREIGN_LOCK_MS - 1000 }));
    expect(append().seq).toBe(0);
  });

  it("takes over a lock with no readable owner only once it is older than OWNERLESS_LOCK_MS", () => {
    writeFileSync(lock(), "");
    expect(append).toThrow(EngineBusyError);
    const old = (Date.now() - OWNERLESS_LOCK_MS - 5000) / 1000;
    utimesSync(lock(), old, old);
    expect(append().seq).toBe(0);
  });

  it("never takes over a live holder on this host", () => {
    writeFileSync(lock(), owner({ pid: process.pid, host: hostname(), at: Date.now() - FOREIGN_LOCK_MS * 10 }));
    expect(append).toThrow(EngineBusyError);
    expect(staleOwner(owner({ pid: process.pid, host: hostname(), at: 0 }), 0)).toBe(false);
  });

  it("releases only its own lock: a lock replaced under a holder is left to its new owner", () => {
    withEngineLock(lock(), () => { writeFileSync(lock(), owner({ pid: process.pid, host: hostname(), at: Date.now(), token: "other" })); });
    expect(existsSync(lock())).toBe(true);
  });
});

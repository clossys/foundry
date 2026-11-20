import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_DIR, LOCK_FILE, verifyChain } from "./chain.js";
import { EngineBusyError, FOREIGN_LOCK_MS, OWNERLESS_LOCK_MS, currentRecoveryMarker, staleOwner, withEngineLock } from "./lock.js";
import { RecordCommittedError, appendEvent, commitEvent, deferEvents, recordEvent } from "./log.js";

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
/**
 * A writer that recovers the lock and holds it: pauses at the recovery steps named in `pauses` (first time each, with
 * `paused-<name>-<step>` recording whether the lock file was there at that moment) until `go-<name>-<step>` exists,
 * marks `at-<name>-<step>` at every step it reaches, and inside the lock records who else was inside (`entered-`),
 * then waits for `release-<name>` and records whether the lock still carried its own token (`left-`).
 */
const RECOVERER = `${HOOK}
const [lockModule, lock, dir, name, waitMs, pauses] = process.argv.slice(2);
const { withEngineLock, recoveryProbe } = await import(lockModule);
const fs = await import("node:fs");
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const nap = ms => Atomics.wait(sleeper, 0, 0, ms);
const pauseAt = new Set(pauses ? pauses.split(",") : []);
const reached = new Set();
recoveryProbe.at = (step, at) => {
  if (at !== lock) return;
  const first = !reached.has(step);
  reached.add(step);
  fs.writeFileSync(dir + "/at-" + name + "-" + step, "");
  if (!first || !pauseAt.has(step)) return;
  fs.writeFileSync(dir + "/paused-" + name + "-" + step, fs.existsSync(lock) ? "present" : "absent");
  while (!fs.existsSync(dir + "/go-" + name + "-" + step)) nap(2);
};
const tokenNow = () => { try { return JSON.parse(fs.readFileSync(lock, "utf8")).token; } catch { return undefined; } };
let result;
try {
  withEngineLock(lock, () => {
    const token = tokenNow();
    const others = fs.readdirSync(dir).filter(file => file.startsWith("in-"));
    fs.writeFileSync(dir + "/in-" + name, "");
    fs.writeFileSync(dir + "/entered-" + name, JSON.stringify(others));
    while (!fs.existsSync(dir + "/release-" + name)) nap(2);
    const kept = token !== undefined && tokenNow() === token;
    fs.rmSync(dir + "/in-" + name);
    fs.writeFileSync(dir + "/left-" + name, JSON.stringify({ others, kept }));
  }, Number(waitMs));
  result = "held";
} catch (error) { result = error?.code ?? String(error); }
console.log(JSON.stringify({ name, result }));
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
const waitForAny = async (paths: readonly string[], ms = 10_000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const hit = paths.find(path => existsSync(path));
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`timed out waiting for one of ${paths.join(", ")}`);
    await new Promise(done => setTimeout(done, 5));
  }
};
/** Engine-dir files a recovery may leave behind (markers, staged locks, moved-aside locks): none may remain. */
const leftovers = () => readdirSync(join(root, ENGINE_DIR)).filter(name => /\.(?:recover|new|stale)-/.test(name));
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

describe("a record write committed while the engine is busy (engine/log.ts RecordCommittedError)", () => {
  it("never reports a write already on disk as a retryable busy error, in every post-write append path", async () => {
    const script = join(root, "holder.mjs");
    writeFileSync(script, HOLDER);
    const held = join(root, "held"), release = join(root, "release");
    const holder = run(script, [engineModule("lock"), lock(), held, release]);
    const record = join(root, "clossys", "agents", "writer", "copy.slot-1", "pin.json");
    mkdirSync(join(record, ".."), { recursive: true });
    const refused = (write: () => unknown) => {
      let error: unknown;
      try { write(); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(RecordCommittedError);
      expect(error).not.toBeInstanceOf(EngineBusyError);
      expect((error as RecordCommittedError).code).toBe("RECORD_COMMITTED");
      expect((error as Error & { code: string }).code).not.toBe("ENGINE_BUSY");
      expect(((error as Error).cause as EngineBusyError).code).toBe("ENGINE_BUSY");
      expect(String((error as Error).message)).toMatch(/record committed: .* is on disk, .*Do not retry/);
      return error as RecordCommittedError;
    };
    try {
      await waitFor(held);
      // A writer's own append after its files are written (recordEvent outside a transaction).
      writeFileSync(record, "a");
      expect(refused(() => recordEvent([record], { actor: "code:test", kind: "pin.write", subject: "writer/copy.slot-1" }, { waitMs: 50 })).subjects).toEqual(["writer/copy.slot-1"]);
      expect(readFileSync(record, "utf8")).toBe("a");
      // A transaction's commit: the write returned, its held events cannot be appended.
      expect(refused(() => deferEvents(() => {
        writeFileSync(record, "b");
        recordEvent([record], { actor: "code:test", kind: "pin.write", subject: "writer/copy.slot-1" }, { waitMs: 50 });
        recordEvent([record], { actor: "code:test", kind: "pin.write", subject: "writer/copy.slot-2" }, { waitMs: 50 });
      })).subjects).toEqual(["writer/copy.slot-1", "writer/copy.slot-2"]);
      expect(readFileSync(record, "utf8")).toBe("b");
      // The loop runner's state event (commitEvent after its state file is renamed in).
      refused(() => commitEvent(root, { actor: "code:clossys run", kind: "run.state", subject: "loop:x/r1", inputs: [] }, { waitMs: 50 }));
      // appendEvent alone wrote nothing, so it stays the retryable EngineBusyError.
      expect(() => appendEvent(root, { actor: "code:test", kind: "slot.submit", subject: "x", inputs: [] }, { waitMs: 50 })).toThrow(EngineBusyError);
      expect(verifyChain(root).count).toBe(0);
    } finally {
      writeFileSync(release, "");
      expect((await holder.done).code).toBe(0);
    }
  }, 30_000);
});

describe("engine lock: stale-lock recovery", () => {
  const append = () => appendEvent(root, { actor: "code:test", kind: "slot.submit", subject: "x", inputs: [] }, { waitMs: 50 });

  it("takes over a lock whose owner pid on this host is dead", () => {
    writeFileSync(lock(), owner({ pid: deadPid(), host: hostname(), at: Date.now() }));
    expect(append().seq).toBe(0);
    expect(existsSync(lock())).toBe(false);
    expect(leftovers()).toEqual([]);
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

describe("engine lock: racing recoveries of one stale lock, real child processes (engine/lock.ts recoverLock)", () => {
  let dir: string;
  let script: string;
  beforeEach(() => {
    dir = join(root, "race");
    mkdirSync(dir);
    script = join(root, "recoverer.mjs");
    writeFileSync(script, RECOVERER);
  });
  const recoverer = (name: string, waitMs: number, pauses: readonly string[] = []) => run(script, [engineModule("lock"), lock(), dir, name, String(waitMs), pauses.join(",")]);
  const at = (file: string) => join(dir, file);
  const touch = (file: string) => writeFileSync(at(file), "");
  const read = (file: string) => readFileSync(at(file), "utf8");
  const result = async (writer: ReturnType<typeof run>) => {
    const done = await writer.done;
    expect(done.code, done.err).toBe(0);
    return (JSON.parse(done.out.trim().split("\n").pop()!) as { result: string }).result;
  };
  /** Swap a new lock file in by rename (a new inode), as a recovery that won and then died would leave it. */
  const swapLock = (text: string) => { writeFileSync(`${lock()}.swap`, text); renameSync(`${lock()}.swap`, lock()); };

  it("a late recoverer never vacates or steals a lock another recovery already won; a third writer is refused meanwhile", async () => {
    writeFileSync(lock(), owner({ pid: deadPid(), host: hostname(), at: Date.now() }));
    touch("release-A");
    touch("release-C");
    const a = recoverer("A", 15_000, ["judged", "replace"]);
    await waitFor(at("paused-A-judged"));
    const b = recoverer("B", 15_000);
    await waitFor(at("entered-B"));
    const tokenOfB = JSON.parse(readFileSync(lock(), "utf8")).token as string;
    touch("go-A-judged");
    // A judged the instance B already replaced: it must leave B's lock in place (declined), never reach a replace.
    const reached = await waitForAny([at("at-A-declined"), at("paused-A-replace")]);
    if (reached === at("paused-A-replace")) expect(read("paused-A-replace"), "the lock path while A recovers").toBe("present");
    expect(JSON.parse(readFileSync(lock(), "utf8")).token).toBe(tokenOfB);
    const c = recoverer("C", 300);
    expect(await result(c)).toBe("ENGINE_BUSY");
    touch("go-A-replace");
    touch("release-B");
    expect(await result(b)).toBe("held");
    expect(await result(a)).toBe("held");
    for (const name of ["A", "B"]) expect(JSON.parse(read(`left-${name}`)), name).toEqual({ others: [], kept: true });
    expect(existsSync(lock())).toBe(false);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it("a recoverer of an instance that was since replaced by another stale lock leaves it to that lock's own recoverer", async () => {
    writeFileSync(lock(), owner({ pid: deadPid(), host: hostname(), at: Date.now() }));
    const r2 = recoverer("R2", 15_000, ["judged"]);
    await waitFor(at("paused-R2-judged"));
    // The instance R2 judged is gone: a recovery won and its writer died, leaving its own (stale) lock.
    swapLock(owner({ pid: deadPid(), host: hostname(), at: Date.now(), token: "won-then-died" }));
    const r3 = recoverer("R3", 15_000, ["replace"]);
    await waitFor(at("paused-R3-replace"));
    expect(read("paused-R3-replace"), "the lock path while R3 recovers").toBe("present");
    touch("go-R2-judged");
    // R2 holds the marker of an instance that is gone: it must decline, not replace the lock R3 is recovering.
    await waitForAny([at("at-R2-declined"), at("entered-R2")]);
    touch("go-R3-replace");
    await waitFor(at("entered-R3"));
    touch("release-R3");
    await waitFor(at("entered-R2"));
    touch("release-R2");
    expect(await result(r3)).toBe("held");
    expect(await result(r2)).toBe("held");
    for (const name of ["R2", "R3"]) expect(JSON.parse(read(`left-${name}`)), name).toEqual({ others: [], kept: true });
    expect(existsSync(lock())).toBe(false);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it("recovers a stale lock whose recovery marker was left by a recoverer that died, and waits on a live one", () => {
    const append = () => appendEvent(root, { actor: "code:test", kind: "slot.submit", subject: "x", inputs: [] }, { waitMs: 50 });
    writeFileSync(lock(), owner({ pid: deadPid(), host: hostname(), at: Date.now() }));
    const marker = currentRecoveryMarker(lock())!;
    writeFileSync(marker, owner({ pid: process.pid, host: hostname(), at: Date.now(), token: "live-recoverer" }));
    expect(append).toThrow(EngineBusyError);
    expect(readFileSync(marker, "utf8")).toContain("live-recoverer");
    writeFileSync(marker, owner({ pid: deadPid(), host: hostname(), at: Date.now(), token: "dead-recoverer" }));
    expect(append().seq).toBe(0);
    expect(existsSync(lock())).toBe(false);
    expect(leftovers()).toEqual([]);
  });
});

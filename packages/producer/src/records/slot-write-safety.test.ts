import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import { jsonBytes, serializeFrontmatter, slotPositions, type IaDoc } from "./slot-model/index.js";
import { isModelDir, modelExists, readModelBytes, readModelText } from "./slots.js";
import { directorStoreWriter, writeNotNeeded, writePin } from "./slot-write.js";

const ID = "identity.brand.essence";
const source = { kind: "original", ref: [] };
const body = "## Direction\n- Essence: x\n\n## Because\n- y\n\n## Watch\n- z\n";
const brief = (essence: string) => serializeFrontmatter({ slot: ID, source, feeds: [], functions: [] }, body.replace("Essence: x", `Essence: ${essence}`));
const at = "2026-11-04T00:00:00Z";
let root: string, consumer: string, dir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "slot-write-safety-")));
  consumer = join(root, "clossys");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [
    { id: "identity", label: "Identity", children: [{ id: "identity.brand", label: "Brand", slots: [ID] }] },
  ] };
  mkdirSync(join(consumer, "agents", "director"), { recursive: true });
  writeFileSync(join(consumer, "agents", "director", "ia.json"), jsonBytes(ia));
  dir = join(consumer, "agents", "director", ID);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "director", ia: slotPositions("director", ia).get(ID), kind: "brief", contract: {}, inputs: [], uses: [] }));
  writeFileSync(join(dir, "candidates", "essence-v1.md"), brief("one"));
  writeFileSync(join(dir, "candidates", "essence-v2.md"), brief("two"));
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const pin = (candidate: string) => writePin(consumer, "director", ID, candidate, { decidedBy: "owner", basis: "picked", at });
/** A process id that has exited: a lock it left can never be released by its owner. */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;
const ownedLock = (lock: string, owner: { pid: number; host: string; at: number }) => {
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify(owner));
};

describe("G24: a slot decision is one locked write of whole files", () => {
  it("refuses a pin while another decision write holds the slot", () => {
    ownedLock(join(dir, ".slot-write.lock"), { pid: process.pid, host: hostname(), at: Date.now() });
    expect(() => pin("essence-v1.md")).toThrow(/another decision write is in progress/);
    expect(existsSync(join(dir, "pin.json"))).toBe(false);
    expect(() => writeNotNeeded(consumer, "director", ID, { reason: "x", since: at, decidedBy: "owner" })).toThrow(/another decision write is in progress/);
  });

  it("replaces pin.json and slot.json by rename, leaving no staged file or lock behind", () => {
    pin("essence-v1.md");
    const pinBefore = statSync(join(dir, "pin.json")).ino;
    pin("essence-v2.md");
    expect(statSync(join(dir, "pin.json")).ino, "pin.json is renamed over, not rewritten in place").not.toBe(pinBefore);
    const slotBefore = statSync(join(dir, "slot.json")).ino;
    writeNotNeeded(consumer, "director", ID, { reason: "covered elsewhere", since: at, decidedBy: "owner" });
    expect(statSync(join(dir, "slot.json")).ino, "slot.json is renamed over, not rewritten in place").not.toBe(slotBefore);
    pin("essence-v2.md");
    expect(JSON.parse(readFileSync(join(dir, "pin.json"), "utf8"))).toMatchObject({ candidate: "essence-v2.md", sha256: sha256Hex(brief("two")) });
    expect(JSON.parse(readFileSync(join(dir, "slot.json"), "utf8")).notNeeded).toBeUndefined();
    expect(readdirSync(dir).filter(name => name.startsWith("."))).toEqual([]);
  });
});

describe("G25: an abandoned lock is recovered, a live one is not", () => {
  const storeLock = () => join(root, ".director-write.lock");
  const locked = () => directorStoreWriter.locked(root, () => "ran");

  it("takes over a lock whose owner process on this host has exited", () => {
    ownedLock(storeLock(), { pid: deadPid(), host: hostname(), at: Date.now() });
    expect(locked()).toBe("ran");
    expect(existsSync(storeLock())).toBe(false);
    ownedLock(join(dir, ".slot-write.lock"), { pid: deadPid(), host: hostname(), at: Date.now() });
    expect(pin("essence-v1.md").candidate).toBe("essence-v1.md");
  });

  it("takes over an ownerless lock only once it is old, and another host's lock only once it is very old", () => {
    mkdirSync(storeLock());
    expect(locked).toThrow(/another write is in progress/);
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(storeLock(), old, old);
    expect(locked()).toBe("ran");
    ownedLock(storeLock(), { pid: 1, host: `${hostname()}-elsewhere`, at: Date.now() - 60_000 });
    expect(locked).toThrow(/another write is in progress/);
    rmSync(storeLock(), { recursive: true });
    ownedLock(storeLock(), { pid: 1, host: `${hostname()}-elsewhere`, at: Date.now() - 60 * 60_000 });
    expect(locked()).toBe("ran");
  });

  it("refuses a lock held by a live writer on this host", () => {
    ownedLock(storeLock(), { pid: process.pid, host: hostname(), at: Date.now() - 60 * 60_000 });
    expect(locked).toThrow(/another write is in progress/);
    expect(existsSync(join(storeLock(), "owner.json"))).toBe(true);
  });
});

describe("G26: raw model reads stay inside a model agent and follow no alias", () => {
  it("refuses a symbolic link to a file outside the model", () => {
    writeFileSync(join(root, "outside.json"), "{\"secret\":true}");
    symlinkSync(join(root, "outside.json"), join(dir, "alias.json"));
    expect(() => readModelText(join(dir, "alias.json"))).toThrow(/Symbolic links|regular slot-model file/);
    expect(() => readModelBytes(join(dir, "alias.json"))).toThrow(/Symbolic links|regular slot-model file/);
    expect(readModelText(join(dir, "slot.json"))).toContain(ID);
  });

  it("refuses a read through a linked folder", () => {
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "slot.json"), "{}");
    symlinkSync(join(root, "elsewhere"), join(consumer, "agents", "director", "linked.slot"));
    expect(() => readModelText(join(consumer, "agents", "director", "linked.slot", "slot.json"))).toThrow(/Symbolic links/);
  });

  it("refuses a path whose only claim is an `agents` segment", () => {
    mkdirSync(join(root, "agents", "notes"), { recursive: true });
    writeFileSync(join(root, "agents", "notes", "plan.json"), "{}");
    expect(() => readModelText(join(root, "agents", "notes", "plan.json"))).toThrow(/Not a slot-model path/);
    expect(() => modelExists(join(root, "agents", "notes", "plan.json"))).toThrow(/Not a slot-model path/);
    expect(isModelDir(join(root, "agents", "notes"))).toBe(false);
    expect(isModelDir(join(consumer, "agents", "director"))).toBe(true);
    expect(modelExists(join(consumer, "agents"))).toBe(true);
  });
});

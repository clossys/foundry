// The slot reader's caches never outlive a change: a cached ia.json is re-validated when its
// bytes change, and a symlink that appears after a read is rejected on the next read.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./hash.js";
import { jsonBytes, slotPositions, type IaDoc } from "./slot-model/index.js";
import { SCOPE_TTL_MS, listSlots, readCandidate, readIa, readPin, readSlot, withSlotReadScope } from "./slots.js";

let root: string;
const agent = "designer" as const;
const id = "components.synthetic";
const renamed = "components.syntheti2"; // same length: an in-place rewrite keeps the file size
const iaFor = (slot: string): IaDoc => ({ schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components.examples", label: "Examples", children: [{ id: "group", label: "Group", slots: [slot] }] }] });
const agentDir = () => join(root, "agents", agent);
const slotDirOf = (slot: string) => join(agentDir(), slot);

function writeSlot(slot: string): void {
  const ia = iaFor(slot);
  const dir = slotDirOf(slot);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: slot, agent, ia: slotPositions(agent, ia).get(slot), kind: "element", contract: {}, inputs: [], uses: [] }));
  const bytes = jsonBytes({ name: "example", type: "registry:item", files: [], meta: { source: { kind: "original", ref: [] } } });
  writeFileSync(join(dir, "candidates", "sample-v1.json"), bytes);
  writeFileSync(join(dir, "pin.json"), jsonBytes({ candidate: "sample-v1.json", sha256: sha256Hex(bytes), decidedBy: "migrated", at: "2026-10-31T00:00:00Z" }));
}

/** Replaces `path` (a directory) with a symlink to a copy of it outside the model. */
function aliasDir(path: string): void {
  const outside = join(root, `outside-${Math.random().toString(36).slice(2)}`);
  renameSync(path, outside);
  symlinkSync(outside, path);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "slot-cache-")));
  writeSlot(id);
  writeFileSync(join(agentDir(), "ia.json"), jsonBytes(iaFor(id)));
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe("ia.json cache", () => {
  it("serves an unchanged ia.json from the cache, frozen", () => {
    const first = readIa(root, agent);
    expect(readIa(root, agent)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(listSlots(root, agent)[0]!.position)).toBe(true);
  });

  it("re-validates when ia.json is rewritten in place with the same size", () => {
    expect(listSlots(root, agent).map(entry => entry.id)).toEqual([id]);
    writeSlot(renamed);
    const before = readFileSync(join(agentDir(), "ia.json"));
    writeFileSync(join(agentDir(), "ia.json"), jsonBytes(iaFor(renamed)));
    expect(readFileSync(join(agentDir(), "ia.json")).length).toBe(before.length);
    expect(readIa(root, agent)!.nodes[0]!.children[0]!.slots).toEqual([renamed]);
    expect(listSlots(root, agent).map(entry => entry.id)).toEqual([renamed]);
    expect(() => readSlot(root, agent, id)).toThrow(/is not in ia.json/);
    expect(readSlot(root, agent, renamed).id).toBe(renamed);
  });

  it("never caches an invalid ia.json and recovers when it is fixed", () => {
    readIa(root, agent);
    writeFileSync(join(agentDir(), "ia.json"), jsonBytes({ ...iaFor(id), schema: "clossys.ia/2" }));
    expect(() => readIa(root, agent)).toThrow(/Invalid designer IA/);
    expect(() => listSlots(root, agent)).toThrow(/Invalid designer IA/);
    writeFileSync(join(agentDir(), "ia.json"), jsonBytes(iaFor(id)));
    expect(listSlots(root, agent).map(entry => entry.id)).toEqual([id]);
  });

  it("returns null once ia.json is removed", () => {
    readIa(root, agent);
    rmSync(join(agentDir(), "ia.json"));
    expect(readIa(root, agent)).toBeNull();
    expect(listSlots(root, agent)).toEqual([]);
  });

  it("rejects an ia.json that becomes a symlink after it was cached", () => {
    readIa(root, agent);
    const outside = join(root, "outside-ia.json");
    renameSync(join(agentDir(), "ia.json"), outside);
    symlinkSync(outside, join(agentDir(), "ia.json"));
    expect(() => readIa(root, agent)).toThrow(/Symbolic links/);
  });

  it("rejects an agent folder that becomes a symlink after ia.json was cached", () => {
    expect(listSlots(root, agent)).toHaveLength(1);
    aliasDir(agentDir());
    expect(() => readIa(root, agent)).toThrow(/Symbolic links/);
    expect(() => listSlots(root, agent)).toThrow(/Symbolic links/);
    expect(() => readSlot(root, agent, id)).toThrow(/Symbolic links/);
  });
});

describe("symlink walk memo", () => {
  it("rejects a slot folder symlinked after a first read", () => {
    expect(readSlot(root, agent, id).id).toBe(id);
    expect(readCandidate(root, agent, id, "sample-v1.json").name).toBe("sample-v1.json");
    aliasDir(slotDirOf(id));
    expect(() => readSlot(root, agent, id)).toThrow(/Symbolic links/);
    expect(() => readCandidate(root, agent, id, "sample-v1.json")).toThrow(/Symbolic links/);
    expect(() => readPin(root, agent, id)).toThrow(/Symbolic links/);
  });

  it("rejects a candidates folder symlinked between two request scopes", () => {
    withSlotReadScope(() => { listSlots(root, agent); readCandidate(root, agent, id, "sample-v1.json"); });
    aliasDir(join(slotDirOf(id), "candidates"));
    expect(() => withSlotReadScope(() => readCandidate(root, agent, id, "sample-v1.json"))).toThrow(/Symbolic links/);
    expect(() => withSlotReadScope(() => listSlots(root, agent))).toThrow(/Symbolic links/);
  });

  it("never memoises a leaf file: one that becomes a symlink inside a scope is still rejected", () => {
    withSlotReadScope(() => {
      expect(readSlot(root, agent, id).id).toBe(id);
      const path = join(slotDirOf(id), "slot.json"), outside = join(root, "outside-slot.json");
      renameSync(path, outside); symlinkSync(outside, path);
      expect(() => readSlot(root, agent, id)).toThrow(/Symbolic links/);
    });
  });

  it("re-walks inside a long scope once the memo is older than its TTL", () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    withSlotReadScope(() => {
      expect(readSlot(root, agent, id).id).toBe(id);
      aliasDir(slotDirOf(id));
      clock.mockReturnValue(now + SCOPE_TTL_MS + 1);
      expect(() => readSlot(root, agent, id)).toThrow(/Symbolic links/);
    });
  });
});

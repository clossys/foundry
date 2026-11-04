import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import { jsonBytes, serializeFrontmatter, slotPositions, type IaDoc, type SlotAgent, type SlotDoc } from "./slot-model/index.js";
import { listSlots, readCandidate, readIa, readSlot, readSlotState, readiness, rejectedSlots, slotIndex, usedBy } from "./slots.js";
import { validateSlotDoc } from "./slot-model/index.js";

let root: string;
let dirs: Record<string, string>;
const save = (path: string, value: unknown) => writeFileSync(path, jsonBytes(value));
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const ids = { director: "brief.synthetic", designer: "components.synthetic", writer: "strings.synthetic", publisher: "page.synthetic" };
const source = { kind: "original", ref: [] };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "slot-reader-")));
  dirs = {};
  for (const agent of Object.keys(ids) as SlotAgent[]) {
    const id = ids[agent];
    const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "examples", label: "Examples", children: [{ id: "group", label: "Group", slots: [id] }] }] };
    const dir = join(root, "agents", agent, id);
    dirs[agent] = dir;
    mkdirSync(join(dir, "candidates"), { recursive: true });
    save(join(root, "agents", agent, "ia.json"), ia);
    const kind = agent === "director" ? "brief" : agent === "designer" ? "element" : agent === "writer" ? "strings" : "page";
    save(join(dir, "slot.json"), {
      schema: "clossys.slot/1", id, agent, ia: slotPositions(agent, ia).get(id), kind, contract: {},
      inputs: agent === "director" ? [] : [ids.director], uses: agent === "publisher" ? [ids.designer] : [],
    });
    const bytes = agent === "director"
      ? serializeFrontmatter({ slot: id, source, feeds: [], functions: [] }, "## Direction\n- example: Direction\n\n## Because\n- example: Evidence\n\n## Watch\n- example: Constraint\n")
      : agent === "writer"
        ? serializeFrontmatter({ slot: id, source, locales: ["en"] }, '## en\n### example.title\n<!-- {"id":"example-title","bindings":[]} -->\nExample title\n')
        : jsonBytes(agent === "designer"
          ? { name: "example", type: "registry:item", files: [], meta: { source } }
          : { schema: "clossys.page/1", path: "/", title: "example.title", frame: null, sections: [], copy: {}, meta: { source } });
    const name = `sample-v1.${agent === "director" || agent === "writer" ? "md" : "json"}`;
    writeFileSync(join(dir, "candidates", name), bytes);
    save(join(dir, "pin.json"), { candidate: name, sha256: sha256Hex(bytes), decidedBy: "migrated", at: "2026-10-31T00:00:00Z" });
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const agents = Object.keys(ids) as SlotAgent[];
const malformedSlots: [string, (doc: SlotDoc) => unknown][] = [
  ["null document", () => null],
  ["wrong schema", doc => ({ ...doc, schema: "clossys.slot/2" })],
  ["missing inputs", doc => ({ ...doc, inputs: undefined })],
  ["non-array uses", doc => ({ ...doc, uses: ids.designer })],
  ["invalid use id", doc => ({ ...doc, uses: ["../foreign"] })],
  ["stored usedBy", doc => ({ ...doc, usedBy: [] })],
  ["missing IA", doc => ({ ...doc, ia: undefined })],
  ["invalid contract", doc => ({ ...doc, contract: [] })],
];
const foreignSlots: [string, (doc: SlotDoc) => SlotDoc][] = [
  ["id", doc => ({ ...doc, id: "slot.foreign" })],
  // Keep the foreign agent/kind pair schema-valid to exercise identity checks.
  ["agent", doc => ({ ...doc, agent: doc.agent === "director" ? "writer" : "director", kind: doc.agent === "director" ? "strings" : "brief" })],
  ["l0", doc => ({ ...doc, ia: { ...doc.ia, l0: "foreign" } })],
  ["l1", doc => ({ ...doc, ia: { ...doc.ia, l1: "foreign" } })],
  ["l2", doc => ({ ...doc, ia: { ...doc.ia, l2: "foreign" } })],
  ["order", doc => ({ ...doc, ia: { ...doc.ia, order: doc.ia.order + 1 } })],
];

describe.each(agents)("canonical %s slot readback", agent => {
  it("returns the complete document at its actual IA position", () => {
    const expected = load(join(dirs[agent]!, "slot.json"));
    expect(readSlot(root, agent, ids[agent])).toEqual(expected);
    expect(expected.ia).toEqual({
      ...(agent === "designer" || agent === "writer" ? { l0: "examples" } : {}),
      l1: "examples", l2: "group", order: 0,
    });
  });

  it.each(malformedSlots)("rejects %s before returning or checking readiness", (_name, mutate) => {
    const path = join(dirs[agent]!, "slot.json");
    save(path, mutate(load(path)));
    const error = `Invalid ${agent} slot ${ids[agent]}`;
    expect(() => readSlot(root, agent, ids[agent])).toThrow(error);
    expect(() => readiness(root, agent, ids[agent])).toThrow(error);
  });

  it.each(foreignSlots)("rejects a schema-valid foreign %s", (_name, mutate) => {
    const path = join(dirs[agent]!, "slot.json");
    save(path, mutate(load(path)));
    expect(() => readSlot(root, agent, ids[agent])).toThrow(`Slot ${agent}/${ids[agent]} does not match its IA position`);
  });

  it.each([...malformedSlots, ...foreignSlots])("rejects present %s documents while computing used-by", (_name, mutate) => {
    const path = join(dirs[agent]!, "slot.json");
    save(path, mutate(load(path)));
    // The target need not appear in uses: every present document is validated.
    expect(() => usedBy(root, "slot.unused")).toThrow();
  });

  it("refuses malformed JSON", () => {
    writeFileSync(join(dirs[agent]!, "slot.json"), "{");
    expect(() => readSlot(root, agent, ids[agent])).toThrow(SyntaxError);
    expect(() => usedBy(root, ids.designer)).toThrow(SyntaxError);
  });

  it("refuses missing direct reads but skips absent documents in used-by", () => {
    rmSync(join(dirs[agent]!, "slot.json"));
    expect(() => readSlot(root, agent, ids[agent])).toThrow(/ENOENT/);
    expect(usedBy(root, ids.designer)).toEqual(agent === "publisher" ? [] : [{ agent: "publisher", id: ids.publisher }]);
  });

  it("refuses slot file aliases", () => {
    const path = join(dirs[agent]!, "slot.json");
    const outside = join(root, "outside.json");
    writeFileSync(outside, readFileSync(path));
    rmSync(path); symlinkSync(outside, path);
    expect(() => readSlot(root, agent, ids[agent])).toThrow(/Symbolic links/);
    expect(() => usedBy(root, ids.designer)).toThrow(/Symbolic links/);
  });

  it("refuses slot folder aliases", () => {
    const dir = dirs[agent]!;
    const doc = readFileSync(join(dir, "slot.json"));
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "slot.json"), doc);
    rmSync(dir, { recursive: true }); symlinkSync(outside, dir);
    expect(() => readSlot(root, agent, ids[agent])).toThrow(/Symbolic links/);
    expect(() => usedBy(root, ids.designer)).toThrow(/Symbolic links/);
  });

  it("requires a regular slot file", () => {
    const path = join(dirs[agent]!, "slot.json");
    rmSync(path); mkdirSync(path);
    expect(() => readSlot(root, agent, ids[agent])).toThrow(/Expected a regular slot-model file/);
    expect(() => usedBy(root, ids.designer)).toThrow(/Expected a regular slot-model file/);
  });
});

it.each(["designer", "writer"] as const)("rejects missing l0 for layered %s slots", agent => {
  const path = join(dirs[agent]!, "slot.json");
  const doc = load(path);
  delete doc.ia.l0;
  save(path, doc);
  expect(() => readSlot(root, agent, ids[agent])).toThrow(`Slot ${agent}/${ids[agent]} does not match its IA position`);
  expect(() => usedBy(root, ids.designer)).toThrow();
});

describe("shared slot reader input integrity", () => {
  it("lists IA slots and clears intact upstream pins", () => {
    expect(listSlots(root, "designer").map(entry => entry.id)).toEqual([ids.designer]);
    expect(readiness(root, "designer", ids.designer)).toEqual({ ready: true, blockedBy: [] });
    expect(readiness(root, "director", ids.director)).toEqual({ ready: true, blockedBy: [] });
    expect(usedBy(root, ids.designer)).toEqual([{ agent: "publisher", id: ids.publisher }]);
  });

  const mutations: [string, () => void, string][] = [
    ["missing pin", () => rmSync(join(dirs.director!, "pin.json")), "unpinned"],
    ["missing sha", () => { const path = join(dirs.director!, "pin.json"); const pin = load(path); delete pin.sha256; save(path, pin); }, "invalid-pin"],
    ["malformed pin", () => writeFileSync(join(dirs.director!, "pin.json"), "{"), "invalid-pin"],
    ["missing candidate", () => rmSync(join(dirs.director!, "candidates", "sample-v1.md")), "missing-candidate"],
    ["changed candidate", () => { const path = join(dirs.director!, "candidates", "sample-v1.md"); writeFileSync(path, readFileSync(path, "utf8") + "Changed\n"); }, "hash-drift"],
    ["status with matching hash", () => {
      const path = join(dirs.director!, "candidates", "sample-v1.md");
      const bytes = readFileSync(path, "utf8").replace("---\n", "---\nstatus: active\n");
      writeFileSync(path, bytes);
      const pinPath = join(dirs.director!, "pin.json"); save(pinPath, { ...load(pinPath), sha256: sha256Hex(bytes) });
    }, "invalid-candidate"],
  ];
  it.each(mutations)("blocks %s even with a previously computed index", (_name, mutate, reason) => {
    const index = slotIndex(root);
    mutate();
    const expected = { ready: false, blockedBy: [{ slot: ids.director, reason }] };
    expect(readiness(root, "designer", ids.designer, index)).toEqual(expected);
    expect(readiness(root, "designer", ids.designer)).toEqual(expected);
  });

  it("does not read a candidate alias", () => {
    const path = join(dirs.director!, "candidates", "sample-v1.md");
    const outside = join(root, "outside.md");
    writeFileSync(outside, readFileSync(path));
    rmSync(path); symlinkSync(outside, path);
    expect(() => readCandidate(root, "director", ids.director, "sample-v1.md")).toThrow(/Symbolic links/);
    expect(readiness(root, "designer", ids.designer).ready).toBe(false);
  });

  it("rejects an invalid IA before building a path", () => {
    const path = join(root, "agents", "designer", "ia.json");
    const ia = load(path); ia.nodes[0].id = "../../outside"; save(path, ia);
    expect(() => readIa(root, "designer")).toThrow(/Invalid designer IA/);
    expect(() => listSlots(root, "designer")).toThrow(/Invalid designer IA/);
  });

  it("derives used-by again when uses change and reports missing inputs", () => {
    const path = join(dirs.publisher!, "slot.json");
    save(path, { ...load(path), uses: [], inputs: ["brief.missing"] });
    expect(usedBy(root, ids.designer)).toEqual([]);
    expect(readiness(root, "publisher", ids.publisher)).toEqual({ ready: false, blockedBy: [{ slot: "brief.missing", reason: "missing" }] });
  });
});

describe("slot state (closed union: pinned or not-needed)", () => {
  const marker = { reason: "Owner: no toolbar on this site.", since: "2026-11-03", decidedBy: "owner" };
  const mark = (agent: SlotAgent, value: unknown) => save(join(dirs[agent]!, "slot.json"), { ...load(join(dirs[agent]!, "slot.json")), notNeeded: value });

  it("decides pinned, not-needed and every rejected state in the one loader", () => {
    for (const agent of agents) expect(readSlotState(root, agent, ids[agent]).state).toBe("pinned");
    expect(rejectedSlots(root)).toEqual([]);

    rmSync(join(dirs.designer!, "pin.json"));
    expect(readSlotState(root, "designer", ids.designer)).toMatchObject({ state: "rejected", reason: "no-pin" });
    expect(rejectedSlots(root)).toEqual([expect.objectContaining({ agent: "designer", id: ids.designer, reason: "no-pin", candidates: 1 })]);
    expect(listSlots(root, "designer")[0]!.state).toMatchObject({ state: "rejected", reason: "no-pin" });

    mark("designer", marker);
    expect(validateSlotDoc(load(join(dirs.designer!, "slot.json")))).toEqual([]);
    expect(readSlotState(root, "designer", ids.designer)).toEqual({ state: "not-needed", notNeeded: marker });
    expect(rejectedSlots(root)).toEqual([]);

    mark("writer", marker);
    expect(readSlotState(root, "writer", ids.writer)).toMatchObject({ state: "rejected", reason: "pinned-and-not-needed" });
    writeFileSync(join(dirs.director!, "pin.json"), "{}");
    expect(readSlotState(root, "director", ids.director)).toMatchObject({ state: "rejected", reason: "invalid-pin" });
    for (const bad of [{ reason: "", since: "2026-11-03", decidedBy: "owner" }, { reason: "x", decidedBy: "owner" }, { reason: "x", since: "soon", decidedBy: "owner" },
      { reason: "x", since: "2026-11-03" }, { reason: "x", since: "2026-11-03", decidedBy: "agent" }, { reason: "x", since: "2026-11-03", decidedBy: "owner", by: "agent" }, "yes"]) {
      mark("designer", bad);
      expect(validateSlotDoc(load(join(dirs.designer!, "slot.json"))).map(issue => issue.message)).toContain("notNeeded must be {reason, since, decidedBy} with a non-empty reason, an ISO date and who decided");
      expect(readSlotState(root, "designer", ids.designer)).toMatchObject({ state: "rejected", reason: "invalid-slot" });
    }
  });
});

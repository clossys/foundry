import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import { jsonBytes, serializeFrontmatter, slotPositions, type IaDoc, type SlotAgent, type SlotDoc } from "./slot-model/index.js";
import { isModelDir, listModelDir, listSeats, listSlots, modelExists, readCandidate, readIa, readModelText, readSeatText, readSlot, readSlotState, readiness, rejectedSlots, seatStates, slotIndex, usedBy, withModelOverlay } from "./slots.js";
import { validateIa, validateSlotDoc } from "./slot-model/index.js";

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
    save(join(dir, "pin.json"), { candidate: name, sha256: sha256Hex(bytes), decidedBy: "migrated", basis: "bulk", at: "2026-10-31T00:00:00Z" });
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

describe("the seat kind (Producer tree)", () => {
  it("lists placed seats in IA order and reads each seat's pinned candidate by step id", () => {
    const producer = join(root, "agents", "producer");
    mkdirSync(producer, { recursive: true });
    save(join(producer, "ia.json"), { schema: "clossys.ia/1", source: "@clossys/producer#steps", extensions: [], nodes: [{ id: "design", label: "Design", children: [{ id: "design.pin", label: "Pin", slots: ["seat.pin.designer", "seat.pick.designer"] }] }] });
    const folder = (step: string) => join(producer, `seat.${step}`);
    const slotJson = (step: string, order: number) => save(join(folder(step), "slot.json"), {
      schema: "clossys.slot/1", id: `seat.${step}`, agent: "producer", ia: { l1: "design", l2: "design.pin", order }, kind: "seat",
      contract: { step, fixture: { step } }, inputs: [], uses: [],
    });
    const seat = (step: string, value: unknown) => {
      const bytes = jsonBytes(value), name = `${step}-v1.json`;
      mkdirSync(join(folder(step), "candidates"), { recursive: true });
      writeFileSync(join(folder(step), "candidates", name), bytes);
      save(join(folder(step), "pin.json"), { candidate: name, sha256: createHash("sha256").update(bytes).digest("hex"), decidedBy: "migrated", basis: "planner", at: "2026-11-04T00:00:00.000Z" });
    };
    seat("pin.designer", { by: "owner", llm: null, human: null });
    // A pinned seat with no slot.json is not a seat slot.
    expect(() => readSeatText(root, "pin.designer")).toThrow(/slot\.json is missing/);
    slotJson("pin.designer", 0);
    const seats = listSeats(root);
    expect(seats.map(entry => [entry.id, entry.step, entry.position.l2, entry.position.order, entry.text === undefined])).toEqual([["seat.pin.designer", "pin.designer", "design.pin", 0, false], ["seat.pick.designer", "pick.designer", "design.pin", 1, true]]);
    expect(seats[0]!.dir).toBe(folder("pin.designer"));
    expect(JSON.parse(readSeatText(root, "pin.designer")!).by).toBe("owner");
    expect(readSeatText(root, "pick.designer")).toBeUndefined();
    expect(seatStates(root)).toEqual([{ id: "seat.pin.designer", step: "pin.designer", state: "pinned" }, { id: "seat.pick.designer", step: "pick.designer", state: "open" }]);
    expect(() => readSeatText(root, "../designer")).toThrow(/Invalid seat id/);
    // A slot.json of another kind, or for another step, is refused.
    save(join(folder("pin.designer"), "slot.json"), { ...load(join(folder("pin.designer"), "slot.json")) as object, kind: "page" });
    expect(() => readSeatText(root, "pin.designer")).toThrow(/slot\.json is invalid/);
    slotJson("pin.designer", 0);
    save(join(folder("pin.designer"), "slot.json"), { ...load(join(folder("pin.designer"), "slot.json")) as object, contract: { step: "pick.designer", fixture: { step: "pick.designer" } } });
    expect(() => readSeatText(root, "pin.designer")).toThrow(/contract\.step must be pin\.designer/);
    slotJson("pin.designer", 0);
    // A drifted candidate, a pin naming a missing candidate and a retired seat.json are refused.
    writeFileSync(join(folder("pin.designer"), "candidates", "pin.designer-v1.json"), jsonBytes({ by: "planner", llm: null, human: null }));
    expect(() => readSeatText(root, "pin.designer")).toThrow(/sha256 differs/);
    seat("pin.designer", { by: "owner", llm: null, human: null });
    rmSync(join(folder("pin.designer"), "candidates", "pin.designer-v1.json"));
    expect(() => readSeatText(root, "pin.designer")).toThrow(/does not exist/);
    seat("pin.designer", { by: "owner", llm: null, human: null });
    save(join(folder("pin.designer"), "seat.json"), { by: "owner", llm: null, human: null });
    expect(() => readSeatText(root, "pin.designer")).toThrow(/seat\.json is retired/);
    expect(seatStates(root)[0]).toMatchObject({ id: "seat.pin.designer", state: "rejected" });
    rmSync(join(folder("pin.designer"), "seat.json"));
    symlinkSync(join(root, "elsewhere.json"), join(folder("pin.designer"), "alias.json"));
    rmSync(join(folder("pin.designer"), "pin.json"));
    symlinkSync(join(folder("pin.designer"), "alias.json"), join(folder("pin.designer"), "pin.json"));
    expect(() => readSeatText(root, "pin.designer")).toThrow();
  });
  it("refuses a Producer IA whose ids are not seat.<step>, and a seat id in another agent's IA", () => {
    const producer = join(root, "agents", "producer");
    mkdirSync(producer, { recursive: true });
    const ia = (slots: string[]) => ({ schema: "clossys.ia/1", source: "@clossys/producer#steps", extensions: [], nodes: [{ id: "design", label: "Design", children: [{ id: "design.pin", label: "Pin", slots }] }] });
    save(join(producer, "ia.json"), ia(["pin.designer"]));
    expect(() => listSeats(root)).toThrow(/Invalid producer IA/);
    expect(validateIa(ia(["pin.designer"]), "ia.json", "producer").map(issue => issue.message)).toEqual(["producer slot id pin.designer must be seat.<step-id>"]);
    expect(validateIa(ia(["seat.pin.designer"]), "ia.json", "producer")).toEqual([]);
    expect(validateIa(ia(["seat.pin.designer"]), "ia.json", "designer").map(issue => issue.message)).toEqual(["slot id seat.pin.designer is in the producer seat namespace"]);
  });
  it("lists no seats without a Producer ia.json, and seats never count as slots", () => {
    expect(listSeats(root)).toEqual([]);
    expect([...slotIndex(root).keys()].some(id => id.startsWith("pin."))).toBe(false);
  });
});

describe("planned-write overlay (withModelOverlay, clossys ia --dry)", () => {
  it("reads planned files and their new folders inside the call only, and writes nothing", () => {
    const ia = join(root, "agents", "designer", "ia.json"), fresh = join(root, "agents", "designer", "components.planned", "slot.json");
    const planned = jsonBytes({ planned: true });
    const before = readFileSync(ia, "utf8");
    const seen = withModelOverlay([[ia, planned], [fresh, planned]], () => ({
      ia: readModelText(ia), fresh: readModelText(fresh), exists: modelExists(fresh),
      folder: isModelDir(join(root, "agents", "designer", "components.planned")), listed: listModelDir(join(root, "agents", "designer")).sort(),
    }));
    expect(seen).toEqual({ ia: planned, fresh: planned, exists: true, folder: true, listed: ["components.planned", "components.synthetic", "ia.json"] });
    expect(readModelText(ia)).toBe(before);
    expect(modelExists(fresh)).toBe(false);
    expect(listModelDir(join(root, "agents", "designer")).sort()).toEqual(["components.synthetic", "ia.json"]);
    expect(() => withModelOverlay([], () => withModelOverlay([], () => 0))).toThrow(/do not nest/);
  });
});

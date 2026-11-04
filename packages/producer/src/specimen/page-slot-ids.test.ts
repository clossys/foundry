import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { jsonBytes, slotPositions, validateCandidate, type IaDoc } from "../records/slot-model/index.js";
import { readCandidate, readPin } from "../records/slots.js";
import { specimenPageSlotIds } from "./page-slot-ids.js";

let root: string;
let base: string;
const save = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, jsonBytes(value)); };
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const dir = (id: string) => join(base, id);
const page = { schema: "clossys.page/1", path: "/", title: "example.title", frame: "frames.plain", sections: [], copy: { title: "strings.example#title" }, meta: { source: { kind: "original", ref: [] } } };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-page-slots-")));
  base = join(root, "clossys", "agents", "publisher");
  save(join(base, "tree.json"), { active: { "page.legacy": 1, "page.home": 3 } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function native(ids = ["page.zebra", "page.empty", "publication.site", "page.home", "page.alpha", "page.draft"]): void {
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "pages", label: "Pages", children: [{ id: "examples", label: "Examples", slots: ids }] }] };
  save(join(base, "ia.json"), ia);
  for (const id of ids) {
    save(join(dir(id), "slot.json"), { schema: "clossys.slot/1", id, agent: "publisher", kind: id.startsWith("publication.") ? "publication" : "page", ia: slotPositions("publisher", ia).get(id), contract: {}, inputs: [], uses: [] });
    if (id === "page.empty") continue;
    const pinned = id.startsWith("publication.")
      ? { schema: "clossys.publication/1", format: "site", entryOrder: ["page.home"], meta: page.meta }
      : page;
    save(join(dir(id), "candidates", "sample-v1.json"), pinned);
    save(join(dir(id), "candidates", "sample-v2.json"), { ...page, frame: "frames.draft" });
    if (id !== "page.draft") save(join(dir(id), "pin.json"), { candidate: "sample-v1.json", sha256: sha256Hex(jsonBytes(pinned)), decidedBy: "migrated", at: "2026-10-31T00:00:00Z" });
  }
}

describe("installed specimen page discovery", () => {
  it("uses pinned page-kind IA slots in home-first alphabetical order", async () => {
    native();
    // An on-disk page outside the IA cannot join discovery.
    save(join(dir("page.outside"), "slot.json"), { ...load(join(dir("page.home"), "slot.json")), id: "page.outside" });
    save(join(dir("page.outside"), "candidates", "sample-v1.json"), page);
    save(join(dir("page.outside"), "pin.json"), load(join(dir("page.home"), "pin.json")));
    expect(await specimenPageSlotIds(root)).toEqual(["page.home", "page.alpha", "page.zebra"]);
    const consumer = join(root, "clossys");
    const pin = readPin(consumer, "publisher", "page.home")!;
    const candidate = readCandidate(consumer, "publisher", "page.home", pin.candidate);
    expect(candidate.sha256).toBe(pin.sha256);
    expect(validateCandidate("page", "page.home", candidate.name, candidate.bytes)).toEqual([]);
    const publication = readCandidate(consumer, "publisher", "publication.site", "sample-v1.json");
    expect(validateCandidate("publication", "publication.site", publication.name, publication.bytes)).toEqual([]);
    expect(JSON.parse(candidate.bytes).frame).toBe("frames.plain");
    save(join(base, "tree.json"), { active: { "page.contradiction": 9 } });
    expect(await specimenPageSlotIds(root)).toEqual(["page.home", "page.alpha", "page.zebra"]);
    rmSync(join(base, "tree.json"));
    expect(await specimenPageSlotIds(root)).toEqual(["page.home", "page.alpha", "page.zebra"]);
  });

  it.each([
    ["missing pin", () => rmSync(join(dir("page.home"), "pin.json"))],
    ["malformed pin", () => writeFileSync(join(dir("page.home"), "pin.json"), "{")],
    ["invalid pin", () => save(join(dir("page.home"), "pin.json"), { candidate: "sample-v1.json", sha256: "invalid" })],
    ["missing pinned candidate", () => rmSync(join(dir("page.home"), "candidates", "sample-v1.json"))],
    ["invalid slot", () => save(join(dir("page.home"), "slot.json"), {})],
    ["wrong identity", () => { const path = join(dir("page.home"), "slot.json"); save(path, { ...load(path), id: "page.other" }); }],
    ["wrong agent", () => { const path = join(dir("page.home"), "slot.json"); save(path, { ...load(path), agent: "writer" }); }],
    ["wrong kind", () => { const path = join(dir("page.home"), "slot.json"); save(path, { ...load(path), kind: "publication" }); }],
    ["wrong position", () => { const path = join(dir("page.home"), "slot.json"); const doc = load(path); save(path, { ...doc, ia: { ...doc.ia, order: 9 } }); }],
  ] as const)("excludes %s without leaking the legacy home page", async (_name, mutate) => {
    native(["page.home"]);
    mutate();
    expect(await specimenPageSlotIds(root)).toEqual([]);
  });

  it("never falls back for an empty native IA or another agent's IA", async () => {
    native([]);
    expect(await specimenPageSlotIds(root)).toEqual([]);
    rmSync(join(base, "ia.json"));
    save(join(root, "clossys", "agents", "writer", "ia.json"), {});
    expect(await specimenPageSlotIds(root)).toEqual([]);
  });

  it("rejects invalid native IA without reading the legacy tree", async () => {
    save(join(base, "ia.json"), {});
    await expect(specimenPageSlotIds(root)).rejects.toThrow(/Invalid publisher IA/);
  });

  it("keeps legacy active page filtering and ordering only without any IA", async () => {
    save(join(base, "tree.json"), { active: { "page.zebra": 2, "page.alpha": 3, "page.home": 1, "publication.site": 1, "page.bad.dot": 1 } });
    expect(await specimenPageSlotIds(root)).toEqual(["page.home", "page.alpha", "page.zebra"]);
    rmSync(join(base, "tree.json"));
    expect(await specimenPageSlotIds(root)).toEqual([]);
  });
});

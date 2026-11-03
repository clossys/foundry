import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { bindPage, resolvePage } from "@clossys/publisher/install";
import { directoryRecordSource } from "@clossys/publisher/specimen";
import { jsonBytes, slotPositions, validateCandidate, type IaDoc } from "../records/slot-model/index.js";
import { installCopy, pageRecordFromCell } from "./install.js";

let root: string;
let dir: string;
const save = (path: string, value: unknown) => writeFileSync(path, jsonBytes(value));
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const page = {
  schema: "clossys.page/1", path: "/", title: "example.title",
  frame: "frames.plain", sections: ["sections.hero", "sections.footer"],
  copy: { "hero.title": "strings.example#title" },
  bindings: { "sections.hero#2": { copy: { "hero.title": "strings.example#second-title" } } }, meta: { source: { kind: "original", ref: [] } },
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "producer-page-record-")));
  dir = join(root, "clossys", "agents", "publisher", "page.home");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function nativePage(): void {
  const ia: IaDoc = {
    schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [],
    nodes: [{ id: "pages", label: "Pages", children: [{ id: "examples", label: "Examples", slots: ["page.home"] }] }],
  };
  mkdirSync(join(dir, "candidates"), { recursive: true });
  save(join(root, "clossys", "agents", "publisher", "ia.json"), ia);
  save(join(dir, "slot.json"), {
    schema: "clossys.slot/1", id: "page.home", agent: "publisher", kind: "page",
    ia: slotPositions("publisher", ia).get("page.home"), contract: {}, inputs: [], uses: [],
  });
  save(join(dir, "candidates", "home-v1.json"), page);
  save(join(dir, "candidates", "home-v2.json"), { ...page, frame: "frames.draft", sections: [], copy: {} });
  save(join(dir, "pin.json"), {
    candidate: "home-v1.json", sha256: sha256Hex(jsonBytes(page)), pinnedBy: "migration:SLOT-MODEL", at: "2026-10-31T00:00:00Z",
  });
}

describe("Publisher page record selection", () => {
  it("reads the exact pinned page despite a newer draft candidate", async () => {
    nativePage();
    const pins = { "themes.zinc": { element: "zinc", version: 1 }, "sections.hero": { element: "hero", version: 1 }, "themes.font": { element: "font", version: 1 } };
    const expected = { id: "home", frame: page.frame, sections: page.sections, copy: { "hero.title": "title" }, bindings: { "sections.hero#2": { copy: { "hero.title": "second-title" } } }, include: ["themes.font", "themes.zinc"] };
    expect(await pageRecordFromCell(root, "home", pins)).toEqual(expected);
    expect(await pageRecordFromCell(root, "page.home", pins)).toEqual(expected);
  });

  it.each([
    ["missing pin", () => rmSync(join(dir, "pin.json"))],
    ["malformed pin", () => writeFileSync(join(dir, "pin.json"), "{")],
    ["invalid pin", () => save(join(dir, "pin.json"), { ...load(join(dir, "pin.json")), sha256: "invalid" })],
    ["missing pinned candidate", () => rmSync(join(dir, "candidates", "home-v1.json"))],
    ["hash drift", () => writeFileSync(join(dir, "candidates", "home-v1.json"), jsonBytes(page) + "\n")],
    ["invalid pinned candidate", () => replacePinned({ ...page, sections: "invalid" })],
    ["null frame", () => replacePinned({ ...page, frame: null })],
    ["reversed copy direction", () => replacePinned({ ...page, copy: { "strings.example.title": "hero.title" } })],
    ["invalid instance key", () => replacePinned({ ...page, bindings: { "sections.hero#0": { copy: {} } } })],
    ["invalid slot", () => save(join(dir, "slot.json"), { ...load(join(dir, "slot.json")), kind: "publication" })],
    ["wrong slot position", () => { const slot = load(join(dir, "slot.json")); save(join(dir, "slot.json"), { ...slot, ia: { ...slot.ia, order: 9 } }); }],
  ] as const)("rejects native %s without newest-candidate fallback", async (_name, mutate) => {
    nativePage();
    mutate();
    await expect(pageRecordFromCell(root, "home", {})).rejects.toThrow();
  });

  it("refuses a consumer without a Publisher slot model", async () => {
    await expect(pageRecordFromCell(root, "home", {})).rejects.toThrow(/no Publisher slot model/);
    const base = join(root, "clossys", "agents", "writer");
    mkdirSync(base, { recursive: true });
    save(join(base, "ia.json"), {});
    await expect(pageRecordFromCell(root, "home", {})).rejects.toThrow(/no Publisher slot model/);
  });
});

describe("page copy direction", () => {
  it("round-trips one direction: copy slot -> <writer slot>#<key>, to install copy slot -> Writer key, to bound Writer text", async () => {
    const copy = { title: "landing.hero#title", "frame.title": "landing.hero#site-name" };
    expect(validateCandidate("page", "page.home", "home-v1.json", jsonBytes({ ...page, copy }))).toEqual([]);
    const install = installCopy({ copy });
    expect(install).toEqual({ copy: { title: "title", "frame.title": "site-name" } });
    const fixtures = join(dirname(import.meta.dirname), "..", "..", "publisher", "src", "install", "__fixtures__");
    const record = { id: "home", frame: "frames.plain", sections: [], ...install };
    const resolved = await resolvePage(record, { "frames.plain": { element: "plain-frame", version: 1 } }, directoryRecordSource({ roots: [join(fixtures, "library")] }));
    expect(resolved.findings).toEqual([]);
    const bound = bindPage({ page: record, slots: resolved.slots, copy: { "site-name": "Landing Studio" } });
    expect(bound.findings).toEqual([]);
    expect(bound.page!.frame.copy).toEqual({ "frame.title": "site-name" });
    expect(bound.page!.frame.props.title).toBe("Landing Studio");
  });
});

function replacePinned(value: unknown): void {
  const bytes = jsonBytes(value);
  writeFileSync(join(dir, "candidates", "home-v1.json"), bytes);
  save(join(dir, "pin.json"), { ...load(join(dir, "pin.json")), sha256: sha256Hex(bytes) });
}

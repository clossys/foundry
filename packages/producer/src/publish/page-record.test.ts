import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { pageRecordFromCell } from "./install.js";

let root: string;
let dir: string;
const save = (path: string, value: unknown) => writeFileSync(path, jsonBytes(value));
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const page = {
  schema: "clossys.page/1", path: "/", title: "example.title",
  frame: "frames.plain", sections: ["sections.hero", "sections.footer"],
  copy: { "hero.title": "strings.example.title" }, meta: { source: { kind: "original", ref: [] } },
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "producer-page-record-")));
  const base = join(root, "clossys", "agents", "publisher");
  mkdirSync(join(base, "cells", "page.home"), { recursive: true });
  save(join(base, "tree.json"), { active: { "page.home": 1 } });
  writeFileSync(join(base, "cells", "page.home", "v1.md"), [
    "---", "frame: frames.legacy", "sections: [sections.legacy]", "---", "## Copy",
    "- title: writer:landing.hero", "- hero.subtitle = subtitle: writer:landing.hero", "## Notes",
    "- ignored: writer:landing.hero", "",
  ].join("\n"));
  dir = join(base, "pages", "examples", "page.home");
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
  it("reads the exact native pinned page despite contradictory legacy and newer draft pages", async () => {
    nativePage();
    const pins = { "themes.zinc": { element: "zinc", version: 1 }, "sections.hero": { element: "hero", version: 1 }, "themes.font": { element: "font", version: 1 } };
    const expected = { id: "home", frame: page.frame, sections: page.sections, copy: page.copy, include: ["themes.font", "themes.zinc"] };
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
    ["invalid slot", () => save(join(dir, "slot.json"), { ...load(join(dir, "slot.json")), kind: "publication" })],
    ["wrong slot position", () => { const slot = load(join(dir, "slot.json")); save(join(dir, "slot.json"), { ...slot, ia: { ...slot.ia, order: 9 } }); }],
  ] as const)("rejects native %s without legacy or newest fallback", async (_name, mutate) => {
    nativePage();
    mutate();
    await expect(pageRecordFromCell(root, "home", {})).rejects.toThrow();
  });

  it("rejects legacy pages once another agent has an IA", async () => {
    const base = join(root, "clossys", "agents", "writer");
    mkdirSync(base, { recursive: true });
    save(join(base, "ia.json"), {});
    await expect(pageRecordFromCell(root, "home", {})).rejects.toThrow(/no page slot/);
  });

  it("keeps active legacy page and copy bullet behavior without any IA", async () => {
    expect(await pageRecordFromCell(root, "home", {})).toEqual({
      id: "home", frame: "frames.legacy", sections: ["sections.legacy"],
      copy: { title: "landing.hero.title", "landing.hero.title": "landing.hero.title", "hero.subtitle": "landing.hero.subtitle" },
    });
  });
});

function replacePinned(value: unknown): void {
  const bytes = jsonBytes(value);
  writeFileSync(join(dir, "candidates", "home-v1.json"), bytes);
  save(join(dir, "pin.json"), { ...load(join(dir, "pin.json")), sha256: sha256Hex(bytes) });
}

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parseCellsResponse } from "../../studio/lib/cells-client.js";
import { selectedPublicationId, selectedPublishedPage } from "../../studio/lib/publisher-preview.js";
import { slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { slotInventory } from "./slot-inventory.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const consumer = realpathSync(mkdtempSync(join(tmpdir(), "slot-inventory-")));
  roots.push(consumer);
  const base = join(consumer, "agents/publisher");
  const ids = ["publication.site", "publication.other", "page.home", "page.draft", "page.empty"];
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic-test-only#inventory", extensions: [],
    nodes: [{ id: "pages", label: "Pages", children: [{ id: "web", label: "Web", slots: ids }] }] };
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "ia.json"), JSON.stringify(ia));
  const dirs = new Map(ids.map(id => {
    const dir = join(base, id);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "slot.json"), JSON.stringify({ schema: "clossys.slot/1", id, agent: "publisher",
      kind: id.startsWith("publication.") ? "publication" : "page", ia: slotPositions("publisher", ia).get(id), contract: {}, inputs: [], uses: [] }));
    return [id, dir];
  }));
  function candidate(id: string, version: number, doc: object, pinned = false) {
    const dir = dirs.get(id)!;
    const name = `example-v${version}.json`, bytes = JSON.stringify(doc);
    writeFileSync(join(dir, "candidates", name), bytes);
    if (pinned) writeFileSync(join(dir, "pin.json"), JSON.stringify({ candidate: name,
      sha256: createHash("sha256").update(bytes).digest("hex"), pinnedBy: "owner:synthetic-test-only:inventory", at: "2026-01-01T00:00:00Z" }));
  }
  return { consumer, dirs, candidate, read: () => slotInventory(consumer, "publisher", "@clossys/publisher") };
}
const source = { kind: "original", ref: [] };
const page = (version: number) => ({ schema: "clossys.page/1", title: `Home ${version}`, path: version === 1 ? "/" : "/draft",
  frame: null, sections: [], copy: {}, meta: { source, entry: { publication: version === 1 ? "site" : "other", entryId: `home-${version}`,
    fields: { description: `Description ${version}` }, entryMeta: { label: `Label ${version}` } } } });
const publication = (version: number) => ({ schema: "clossys.publication/1", format: "web.page.responsive", entryOrder: [`home-${version}`],
  meta: { source, header: { title: `Site ${version}` } }, routePack: { appDir: version === 1 ? "apps/site" : "apps/draft" } });

it("keeps pinned page and publication metadata together when newer drafts exist", () => {
  const f = fixture();
  f.candidate("publication.site", 1, publication(1), true);
  f.candidate("publication.site", 2, publication(2));
  f.candidate("publication.other", 1, publication(1), true);
  f.candidate("page.home", 1, page(1), true);
  f.candidate("page.home", 2, page(2));
  const result = f.read();
  expect(result.tree).toMatchObject({ active: { "publication.site": 1, "page.home": 1 }, meta: { publications: [
    { id: "site", title: "Site 1", entryOrder: ["home-1"], routePack: { appDir: "apps/site" }, entryIds: { "page.home": "home-1" }, entryMeta: { "page.home": { label: "Label 1" } } },
    { id: "other", entryIds: {}, entryMeta: {} },
  ] } });
  expect(result.cells.find(cell => cell.id === "page.home")).toMatchObject({ version: 1, status: "active",
    path: expect.stringMatching(/example-v1\.json$/), fields: { candidate: "example-v1.json", title: "Home 1", path: "/", description: "Description 1" } });
  const index = parseCellsResponse({ agents: [result] })[0]!;
  expect(selectedPublicationId(index, "page.home")).toBe("site");
  const pages = ["/draft", "/"].map((route, i) => ({ id: `emitted-${i}`, route, emitted: true, previewUrl: "", frameUrl: "" }));
  expect(selectedPublishedPage(index, "page.home", pages)?.route).toBe("/");
});

it("keeps the newest unpinned candidate as a draft and empty slots in the IA", () => {
  const f = fixture();
  f.candidate("page.draft", 1, page(1));
  f.candidate("page.draft", 2, page(2));
  f.candidate("publication.site", 1, publication(1));
  expect(f.read()).toMatchObject({ tree: { active: {}, meta: { publications: [] }, tree: [{ children: [{ cells: expect.arrayContaining(["page.empty"]) }] }] },
    cells: expect.arrayContaining([{ id: "page.draft", version: 2, status: "draft", path: expect.stringMatching(/example-v2\.json$/), fields: expect.objectContaining({ title: "Home 2", pinned: null }) }]) });
});

it.each(["missing", "changed", "invalid", "malformed-pin"])("refuses a %s pinned candidate instead of projecting newer draft metadata", mutation => {
  const f = fixture();
  f.candidate("page.home", 1, page(1), true);
  f.candidate("page.home", 2, page(2));
  const dir = f.dirs.get("page.home")!, path = join(dir, "candidates/example-v1.json");
  if (mutation === "missing") unlinkSync(path);
  if (mutation === "changed") writeFileSync(path, readFileSync(path, "utf8") + "\n");
  if (mutation === "invalid") f.candidate("page.home", 1, { ...page(1), schema: "invalid" }, true);
  if (mutation === "malformed-pin") writeFileSync(join(dir, "pin.json"), "{}");
  expect(() => f.read()).toThrow();
});

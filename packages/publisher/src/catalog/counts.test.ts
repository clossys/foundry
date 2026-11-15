/**
 * Publisher slot tree recut (foundry-build-0020): three L0s, Composition, Directory and Release, with three starter
 * publications (site, docs, app). Target counts from ia-target/publisher.md section 2: 6 / 5 L1, 11 / 3 L2, 43 / 3 L3
 * (live / parked); every live L3 is a starter leaf with a package default, except releases (their manifest is computed).
 */
import { describe, expect, it } from "vitest";
import {
  PUBLISHER_RETIRED, PUBLISHER_TREES, STARTER_IDS, checkTree, countTree, loadDefaults, loadDesignerCatalog, loadStarter, placedLeaves,
  slotContract, starterLeaves,
  type ChromeSlot, type L0Tree, type LayoutOption, type LayoutSlot, type PageOption, type PageSlot, type RetiredEntry,
} from "./ia/tree.js";
import { checkLayoutUnits } from "../check/page-sections-instance.js";

const clone = <T>(value: T): T => structuredClone(value);
const tree = (trees: L0Tree[], l0: string) => trees.find(candidate => candidate.l0 === l0)!;
const designer = loadDesignerCatalog();
const defaults = loadDefaults();
const unit = (ref: string) => ref.replace(/^designer\//, "");

describe("Publisher tree counts (publisher.md section 2)", () => {
  const counts = countTree();

  it("has 3 L0 and 6/5 L1, 11/3 L2, 43/3 L3 (live / parked)", () => {
    expect(counts.l0).toBe(3);
    expect(counts.total).toEqual({ l1: { live: 6, parked: 5 }, l2: { live: 11, parked: 3 }, l3: { live: 43, parked: 3 } });
  });

  it("counts per L0 in owner order: Composition, Directory, Release", () => {
    expect(PUBLISHER_TREES.map(t => t.l0)).toEqual(["composition", "directory", "release"]);
    expect(counts.byL0).toEqual({
      composition: { l1: { live: 2, parked: 0 }, l2: { live: 5, parked: 1 }, l3: { live: 20, parked: 1 } },
      directory: { l1: { live: 3, parked: 2 }, l2: { live: 3, parked: 1 }, l3: { live: 20, parked: 1 } },
      release: { l1: { live: 1, parked: 3 }, l2: { live: 3, parked: 1 }, l3: { live: 3, parked: 1 } },
    });
  });

  it("has 15 layouts plus 5 chrome, 20 pages and 3 releases live", () => {
    const live = starterLeaves();
    expect(live).toHaveLength(43);
    expect(live.filter(id => id.startsWith("layout.")).length).toBe(15);
    expect(live.filter(id => id.startsWith("chrome.")).length).toBe(5);
    expect(live.filter(id => id.startsWith("page.")).length).toBe(20);
    expect(live.filter(id => id.startsWith("release.")).length).toBe(3);
  });

  it("parks the one-pager across all three L0s", () => {
    expect(placedLeaves().filter(leaf => leaf.parked).map(leaf => leaf.id)).toEqual(["layout.one-pager", "page.company-one-pager", "release.company-one-pager"]);
  });

  it("labels the L1s by the target tree", () => {
    expect(PUBLISHER_TREES.map(t => t.nodes.map(node => node.label))).toEqual([
      ["Layouts", "Chrome"], ["Sites", "Docs", "Apps", "Decks", "Documents"], ["Web", "Slides", "Documents", "Video"],
    ]);
  });
});

describe("Publisher tree soundness", () => {
  it("passes on the committed tree", () => {
    expect(checkTree()).toEqual([]);
  });

  it("retires the 5 draft layout slots and the 18 frozen sl_* leaves, none of them placed", () => {
    expect(PUBLISHER_RETIRED.filter(entry => entry.id.startsWith("layouts."))).toHaveLength(5);
    expect(PUBLISHER_RETIRED.filter(entry => entry.id.startsWith("sl_"))).toHaveLength(18);
    const placed = new Set(placedLeaves().map(leaf => leaf.id));
    expect(PUBLISHER_RETIRED.filter(entry => placed.has(entry.id))).toEqual([]);
  });

  it("mutation: a retired id placed in the tree fails (ids are never reused)", () => {
    const trees = clone(PUBLISHER_TREES) as L0Tree[];
    const retired = [...PUBLISHER_RETIRED, { id: "layout.about", retiredAt: "2026-11-15" }] as RetiredEntry[];
    expect(checkTree(trees, retired)).toContain("layout.about: retired id placed in the tree; retired ids are never reused");
  });

  it("mutation: a leaf placed under another L0 fails", () => {
    const trees = clone(PUBLISHER_TREES) as L0Tree[];
    const release = tree(trees, "release");
    (release.nodes[0]!.children![0] as { leaves: string[] }).leaves.push("page.home");
    expect(checkTree(trees)).toEqual(expect.arrayContaining(["page.home: placed in release, outside its id prefix", "page.home: placed more than once"]));
  });

  it("mutation: a leaf with no slot contract fails", () => {
    const trees = clone(PUBLISHER_TREES) as L0Tree[];
    const composition = tree(trees, "composition") as { slots: Record<string, unknown> };
    delete composition.slots["layout.pricing"];
    expect(checkTree(trees)).toContain("layout.pricing: placed with no slot contract");
  });

  it("mutation: a parked leaf whose contract is live fails", () => {
    const trees = clone(PUBLISHER_TREES) as L0Tree[];
    const directory = tree(trees, "directory") as { slots: Record<string, { parked?: boolean }> };
    delete directory.slots["page.company-one-pager"]!.parked;
    expect(checkTree(trees)).toContain("page.company-one-pager: contract parked=false but its node parked=true");
  });
});

describe("starters resolve against the live Designer catalog", () => {
  it("every layout frame and role kind is a live Designer slot", () => {
    for (const id of starterLeaves().filter(leaf => leaf.startsWith("layout."))) {
      expect(checkLayoutUnits(id, slotContract(id) as LayoutSlot, designer), id).toEqual([]);
    }
  });

  it("every chrome unit, part and frame is a live Designer slot", () => {
    for (const id of starterLeaves().filter(leaf => leaf.startsWith("chrome."))) {
      const chrome = slotContract(id) as ChromeSlot;
      for (const ref of [chrome.frame, chrome.unit, ...(chrome.parts ?? []), ...(chrome.within ? [chrome.within] : [])]) {
        expect(designer.live.has(unit(ref)), `${id} ${ref}`).toBe(true);
      }
    }
  });

  it("every starter page resolves every section and its frame to a live Designer slot", () => {
    for (const starter of STARTER_IDS) for (const pageId of loadStarter(starter).pages) {
      const page = defaults.get(`${pageId}/starter-v1.json`)!.content as unknown as PageOption;
      const layout = slotContract(page.layout) as LayoutSlot;
      expect(designer.live.has(unit(layout.frame!)), `${pageId} frame`).toBe(true);
      for (const section of page.sections) expect(designer.live.has(unit(section.use)), `${pageId} ${section.role}`).toBe(true);
    }
  });

  it("mutation: a layout naming a retired Designer section fails", () => {
    const layout = clone(slotContract("layout.legal") as LayoutSlot) as { roles: Record<string, { kinds: string[] }> };
    layout.roles.body!.kinds = ["designer/sections.legal-prose"];
    expect(checkLayoutUnits("layout.legal", layout as LayoutSlot, designer)).toEqual(["layout.legal: role body kind designer/sections.legal-prose is retired"]);
  });

  it("mutation: a layout on a frame Designer does not have fails", () => {
    const layout = { ...(slotContract("layout.about") as LayoutSlot), frame: "designer/frames.deck" };
    expect(checkLayoutUnits("layout.about", layout, designer)).toEqual(["layout.about: frame designer/frames.deck is not in the Designer catalog"]);
  });
});

describe("starter publications and package defaults", () => {
  it("each starter lists exactly the pages of its Directory L2, in order, and its release", () => {
    const directory = PUBLISHER_TREES.find(t => t.l0 === "directory")!;
    for (const id of STARTER_IDS) {
      const starter = loadStarter(id);
      const node = directory.nodes.flatMap(l1 => l1.children ?? []).find(l2 => l2.publication === id)!;
      expect(starter.node, id).toBe(node.id);
      expect(starter.pages, id).toEqual(node.leaves);
      expect(starter.release, id).toBe(`release.${id}`);
      for (const pageId of starter.pages) expect((slotContract(pageId) as PageSlot).publication, pageId).toBe(id);
    }
  });

  it("each starter's layouts and chrome are what its pages and layouts use", () => {
    for (const id of STARTER_IDS) {
      const starter = loadStarter(id);
      const pages = starter.pages.map(pageId => defaults.get(`${pageId}/starter-v1.json`)!.content as unknown as PageOption);
      expect([...new Set(pages.map(page => page.layout.replace(/^publisher\//, "")))].sort(), id).toEqual([...starter.layouts].sort());
      const chrome = new Set(starter.layouts.flatMap(layout => ((slotContract(layout) as LayoutSlot).chrome ?? []).map(ref => ref.replace(/^publisher\//, ""))));
      expect([...chrome].sort(), id).toEqual([...starter.chrome].sort());
      for (const ref of starter.defaults) expect(defaults.has(ref), `${id} ${ref}`).toBe(true);
    }
  });

  it("every live layout, chrome and page slot ships one package default (starter.pins-present)", () => {
    const slotsWithDefault = new Set([...defaults.keys()].map(key => key.slice(0, key.indexOf("/"))));
    const missing = starterLeaves().filter(id => !id.startsWith("release.") && !slotsWithDefault.has(id));
    expect(missing).toEqual([]);
    expect(defaults.size).toBe(40);
    for (const [key, file] of defaults) {
      expect(file.clossys.source.kind, key).toBe("package-default");
      expect(file.clossys.id, key).toBe(`publisher/${key.slice(0, key.indexOf("/"))}/package:${key.slice(key.indexOf("/") + 1)}`);
    }
  });

  it("every starter slot is consumed by a starter (starter.consumed-only)", () => {
    const consumed = new Set(STARTER_IDS.flatMap(id => { const s = loadStarter(id); return [...s.pages, ...s.layouts, ...s.chrome, s.release]; }));
    expect(starterLeaves().filter(id => !consumed.has(id))).toEqual([]);
  });

  it("a layout default orders exactly the layout's roles and requires at least the required ones", () => {
    for (const id of starterLeaves().filter(leaf => leaf.startsWith("layout."))) {
      const layout = slotContract(id) as LayoutSlot;
      const option = defaults.get(`${id}/standard-v1.json`)!.content as unknown as LayoutOption;
      expect(option.frame, id).toBe(layout.frame);
      expect([...option.order].sort(), id).toEqual(Object.keys(layout.roles!).sort());
      for (const [role, contract] of Object.entries(layout.roles!)) if (contract.required) expect(option.required, `${id} ${role}`).toContain(role);
    }
  });

  it("chrome links and page links name page ids in the same publication", () => {
    for (const id of starterLeaves().filter(leaf => leaf.startsWith("chrome."))) {
      const chrome = slotContract(id) as ChromeSlot;
      const option = [...defaults.entries()].find(([key]) => key.startsWith(`${id}/`))![1].content as { links: Record<string, string> };
      for (const target of Object.values(option.links)) {
        const page = slotContract(target.replace(/^publisher\//, "").replace(/#.*$/, "")) as PageSlot | undefined;
        expect(page?.kind, `${id} ${target}`).toBe("page");
        expect(chrome.publications, `${id} ${target}`).toContain(page!.publication);
      }
    }
  });
});

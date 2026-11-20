import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { R01 } from "../checks/R01-catalog.js";
import { registeredRules } from "../registry.js";
import { formatReport, runConstitution } from "../run.js";
import type { Check, ConstitutionContext, Row } from "../types.js";
import { cleanSpec, expectCatches, NO_FOUNDRY_LEAVES, NO_HISTORY, slotDoc, writeWorkspace, type Agent, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import {
  iaAxis, iaDepth, iaEmptyGroup, iaExtensionFacet, iaFanout, iaLabelUnique, iaNoConsumer, iaNoMirror, iaSharedAxis, iaView, keyOf, navIaParity, R01_IA_CHECKS, slug,
} from "./r01-ia.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const editJson = (path: string, change: (value: Json) => void) => {
  const value = JSON.parse(readFileSync(path, "utf8")) as Json;
  change(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const editIa = (consumer: string, agent: Agent, change: (ia: Json) => void) => editJson(join(consumer, "agents", agent, "ia.json"), change);
const editSlot = (consumer: string, agent: Agent, id: string, change: (doc: Json) => void) => editJson(join(consumer, "agents", agent, id, "slot.json"), change);
/** A written workspace, edited after writing, read back as a context. */
function tree(spec: WorkspaceSpec = cleanSpec(), edit?: (consumer: string) => void): ConstitutionContext {
  const { root, consumer } = writeWorkspace(spec);
  edit?.(consumer);
  return buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES });
}
const clean = () => tree();
const broken = (edit: (consumer: string) => void) => tree(cleanSpec(), edit);
const reasons = (rows: readonly Row[]) => rows.map(item => `${item.agent}:${item.slot}: ${item.reason}`);

/** Renames an agent's one fixture L1 node (ids, layer ref and axis value together). */
const renameL1 = (ia: Json, id: string, label: string) => {
  const old = ia.nodes[0].id as string;
  ia.nodes[0].id = id; ia.nodes[0].label = label;
  ia.layers[0].nodes = ia.layers[0].nodes.map((ref: string) => (ref === old ? id : ref));
  ia.axes.L1[ia.layers[0].id].values = [label];
};
/** Adds an L0 layer with its L1 nodes (one L2 group `all` each) and its L1 axis. */
const addL0 = (ia: Json, l0: { id: string; label: string }, tabs: { id: string; label: string; slots?: string[] }[], axis: Json = {}) => {
  ia.nodes.push(...tabs.map(tab => ({ id: tab.id, label: tab.label, children: [{ id: "all", label: "All", slots: tab.slots ?? [] }] })));
  ia.layers.push({ id: l0.id, label: l0.label, nodes: tabs.map(tab => tab.id) });
  ia.axes.L0.values.push(l0.label);
  ia.axes.L1[l0.id] = { name: "kind", values: tabs.map(tab => tab.label), ...axis };
};
const SECTIONS = [{ id: "sections.explain", label: "Explain" }, { id: "sections.organize", label: "Organize" }];
const PASSAGES = [{ id: "passages.explain", label: "Explain" }, { id: "passages.organize", label: "Organize" }];
/** Designer Sections and its Writer Passages mirror, declared: the R01.11 pass fixture. */
const mirrored = (consumer: string) => {
  editIa(consumer, "designer", ia => addL0(ia, { id: "sections", label: "Sections" }, SECTIONS));
  editIa(consumer, "writer", ia => addL0(ia, { id: "passages", label: "Passages" }, PASSAGES, { mirrors: "designer/sections" }));
};

/** Adds one L1 node whose L2 groups are `groups` to an L0 layer, adding the layer when the IA has none (R01.11 L1 mirrors). */
const addGroups = (ia: Json, l0: { id: string; label: string }, tab: { id: string; label: string }, groups: { id: string; label: string }[]) => {
  ia.nodes.push({ id: tab.id, label: tab.label, children: groups.map(group => ({ id: group.id, label: group.label, slots: [] })) });
  const layer = (ia.layers as Json[]).find(each => each.id === l0.id);
  if (layer) { layer.nodes.push(tab.id); ia.axes.L1[l0.id].values.push(tab.label); return; }
  ia.layers.push({ id: l0.id, label: l0.label, nodes: [tab.id] });
  ia.axes.L0.values.push(l0.label);
  ia.axes.L1[l0.id] = { name: "kind", values: [tab.label] };
};
const SECTION_GROUPS = [{ id: "sections-parts", label: "Parts" }, { id: "sections-story", label: "Story" }];
const COPY_GROUPS = [{ id: "parts", label: "Parts" }, { id: "story", label: "Story" }];
const designerSections = (groups = SECTION_GROUPS) => (consumer: string) => editIa(consumer, "designer", ia => addGroups(ia, { id: "sections", label: "Sections" }, { id: "sections.sections", label: "Sections" }, groups));
const writerSectionCopy = (groups = COPY_GROUPS) => (consumer: string) => editIa(consumer, "writer", ia => addGroups(ia, { id: "copy", label: "Copy" }, { id: "copy.section-copy", label: "Section copy" }, groups));
/** Designer Sections and Writer Section copy, the same L2 groups: the IA_MIRRORS pass fixture. */
const sectionCopy = (consumer: string) => { designerSections()(consumer); writerSectionCopy()(consumer); };

/**
 * The R01.13 pass fixture: the clean workspace plus a pinned Studio publication whose nav groups are
 * Workspace then the five agents in chain order, one page per agent L0, and a hidden runs page.
 */
const NAV_PAGES: { id: string; path: string; group: string; hidden?: true }[] = [
  { id: "page.home", path: "/", group: "workspace" },
  { id: "page.runs", path: "/runs", group: "workspace", hidden: true },
  { id: "page.producer-pipeline", path: "/producer/pipeline", group: "producer" },
  { id: "page.director-plan", path: "/director/plan", group: "director" },
  { id: "page.designer-kit", path: "/designer/kit", group: "designer" },
  { id: "page.writer-copy", path: "/writer/copy", group: "writer" },
  { id: "page.publisher-web", path: "/publisher/web", group: "publisher" },
];
function navSpec(pages = NAV_PAGES, groups = ["workspace", "producer", "director", "designer", "writer", "publisher"]): WorkspaceSpec {
  const spec = cleanSpec();
  for (const page of pages) {
    spec.publisher![page.id] = { candidates: { "page-v1.json": { schema: "clossys.page/1", path: page.path, nav: page.hidden ? { hidden: true } : { nav: true, group: page.group } } } };
  }
  const children = groups.map(group => ({ id: group, entry: { kind: "group", path: `/${group}` }, cells: pages.filter(page => page.group === group).map(page => page.id) }));
  spec.publisher!["publication.studio"] = { candidates: { "publication-v1.json": { schema: "clossys.publication/1", format: "web.page.responsive", meta: { tree: { id: "studio", children } } } } };
  return spec;
}

describe("R01 IA checks registry", () => {
  it("registers R01.7-R01.14 building and R01.15 warn, owned by IA-C, R01.16 building (U33), and R01.1-R01.6 stay enforced", () => {
    const r01 = registeredRules().find(rule => rule.id === "R01")!;
    expect(r01.status).toBe("enforced");
    expect(r01.run.map(check => [check.id, check.status])).toEqual([
      ...[1, 2, 3, 4, 5, 6].map(n => [`R01.${n}`, "enforced"]),
      ...[7, 8, 9, 10, 11, 12, 13, 14].map(n => [`R01.${n}`, "building"]),
      ["R01.15", "warn"],
      ["R01.16", "building"],
    ]);
    expect(r01.checks.filter(check => check.status !== "enforced" && check.id !== "R01.16").every(check => check.owner === "IA-C")).toBe(true);
    expect(r01.checks.find(check => check.id === "R01.16")).toEqual({ id: "R01.16", status: "building", owner: "U33" });
    for (const [id, check] of Object.entries(R01_IA_CHECKS)) expect(R01.checks[id]).toBe(check);
  });

  it("reads levels: layers as L0, a dotted prefix as an implied L0, an undotted node as L0 with leaves at L2", () => {
    const view = iaView(clean().agents[0]!)!;
    expect(view.layers).toBe(true);
    expect(view.l0s.map(node => [node.id, node.label, node.l1s.map(tab => tab.id)])).toEqual([["plan", "Plan", ["goals"]]]);
    expect(view.places.get("brand.voice")).toEqual({ l0: "plan", node: "goals", child: "all" });
    const flat = broken(consumer => editIa(consumer, "designer", ia => {
      delete ia.layers;
      ia.nodes = [{ id: "themes.colors", label: "Colors", children: [{ id: "base", label: "Base", slots: ["ui.button"] }] }, { id: "studio", label: "Studio", children: [{ id: "pages", label: "Pages", slots: ["ui.card"] }] }];
    }));
    const implied = iaView(flat.agents[1]!)!;
    expect(implied.layers).toBe(false);
    expect(implied.l0s.map(node => [node.id, node.implied, node.l1s.map(tab => [tab.id, tab.leaves])])).toEqual([
      ["themes", "prefix", [["themes.colors", ["ui.button"]]]],
      ["studio", "node", [["pages", ["ui.card"]]]],
    ]);
    expect(implied.places.get("ui.button")).toEqual({ l0: "themes", node: "themes.colors", child: "base" });
    expect(implied.places.get("ui.card")).toEqual({ node: "studio", child: "pages" });
    expect([slug("Consumer extensions"), slug("Data and lists"), keyOf("themes.colors"), keyOf("studio")]).toEqual(["consumer-extensions", "data-and-lists", "colors", "studio"]);
  });
});

describe("R01.7 IA-AXIS closed L0 and L1 vocabularies", () => {
  it("passes the clean workspace and flags an ia.json with no axes", () => {
    const rows = expectCatches(iaAxis, clean(), broken(consumer => editIa(consumer, "writer", ia => { delete ia.axes; })));
    expect(reasons(rows)).toEqual(["writer:*: ia.json declares no axes {L0, L1}: its L0 and L1 labels have no closed vocabulary"]);
  });

  it("flags an L0 or L1 label outside its list, a missing L1 axis and an instance L0 axis", () => {
    const rows = iaAxis(broken(consumer => {
      editIa(consumer, "designer", ia => { ia.axes.L1.kit.values = ["Buttons"]; });
      editIa(consumer, "director", ia => { ia.axes.L0.values = ["Strategy"]; });
      editIa(consumer, "writer", ia => { delete ia.axes.L1.copy; });
      editIa(consumer, "producer", ia => { ia.axes.L0 = { name: "stage", instance: true }; });
    }));
    expect(reasons(rows)).toEqual([
      "director:*: L0 plan (Plan) label is not in axes.L0 area [Strategy]",
      "designer:*: L1 controls (Controls) label is not in axes.L1.kit topic [Buttons]",
      "writer:*: axes.L1.copy must be {name, values} or {name, instance: true}",
      "producer:*: axes.L0 is instance: only L1 tabs may be data-driven",
    ]);
  });

  it("accepts an instance L1 axis whatever its labels", () => {
    expect(iaAxis(broken(consumer => editIa(consumer, "publisher", ia => { ia.axes.L1.web = { name: "publication", instance: true }; })))).toEqual([]);
  });

  it("mutation proof: a disabled R01.7 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], clean(), broken(consumer => editIa(consumer, "writer", ia => { delete ia.axes; })))).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.8 IA-DEPTH every leaf at L3", () => {
  it("passes the clean workspace and flags a slot.json ia with no l0", () => {
    const rows = expectCatches(iaDepth, clean(), broken(consumer => editSlot(consumer, "director", "brand.voice", doc => { delete doc.ia.l0; })));
    expect(reasons(rows)).toEqual(["director:brand.voice: slot.json ia has no l0 (the leaf's L0 is plan)"]);
  });

  it("flags an ia.json with no layers (undotted nodes put leaves at L2), a partial layer ref and a misplaced slot", () => {
    const rows = iaDepth(broken(consumer => {
      editIa(consumer, "producer", ia => { delete ia.layers; });
      editIa(consumer, "writer", ia => { ia.layers[0].nodes = ["headlines/all"]; });
      editSlot(consumer, "designer", "ui.card", doc => { doc.ia.l2 = "other"; });
    }));
    expect(reasons(rows)).toEqual([
      "designer:ui.card: slot.json ia is controls/other, but ia.json places the leaf at controls/all",
      "writer:*: layer copy shows L2 group headlines/all as an L1: its leaves sit at L2, not L3",
      "producer:*: ia.json declares no layers (L0): nodes steps stand in for L0, so their leaves sit at L2, not L3",
      "producer:seat.director: slot.json ia.l0 is pipeline, but ia.json places the leaf under L0 (none)",
    ]);
  });

  it("names prefix-implied L0s when dotted nodes have no layers", () => {
    const rows = iaDepth(broken(consumer => editIa(consumer, "designer", ia => { delete ia.layers; ia.nodes[0].id = "kit.controls"; })));
    expect(reasons(rows)).toEqual([
      "designer:*: ia.json declares no layers (L0): L0 is only implied by node id prefixes (kit)",
      "designer:ui.button: slot.json ia is controls/all, but ia.json places the leaf at kit.controls/all",
      "designer:ui.card: slot.json ia is controls/all, but ia.json places the leaf at kit.controls/all",
    ]);
  });

  it("mutation proof: a disabled R01.8 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], clean(), broken(consumer => editSlot(consumer, "director", "brand.voice", doc => { delete doc.ia.l0; })))).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.9 IA-NO-CONSUMER", () => {
  it("passes the clean workspace and flags an L1 named for a consumer", () => {
    const rows = expectCatches(iaNoConsumer, clean(), broken(consumer => editIa(consumer, "designer", ia => renameL1(ia, "studio", "Studio"))));
    expect(reasons(rows)).toEqual(["designer:*: L1 studio (Studio) names a consumer, not a kind: studio (a provenance word)"]);
  });

  it("flags agent, package, provenance and publication words at L0 and L1", () => {
    const spec = cleanSpec();
    spec.publisher!["publication.atlas"] = {};
    const rows = iaNoConsumer(tree(spec, consumer => {
      editIa(consumer, "writer", ia => renameL1(ia, "consumer-extensions", "Consumer extensions"));
      editIa(consumer, "publisher", ia => { ia.layers[0].id = "director"; ia.layers[0].label = "Director"; });
      editIa(consumer, "producer", ia => renameL1(ia, "launcher", "Launcher"));
      editIa(consumer, "director", ia => renameL1(ia, "atlas", "Atlas"));
    }));
    expect(reasons(rows)).toEqual([
      "director:*: L1 atlas (Atlas) names a consumer, not a kind: atlas (a publication (publication.atlas))",
      "writer:*: L1 consumer-extensions (Consumer extensions) names a consumer, not a kind: consumer (a provenance word), extensions (a provenance word)",
      "publisher:*: L0 director (Director) names a consumer, not a kind: director (an agent)",
      "producer:*: L1 launcher (Launcher) names a consumer, not a kind: launcher (a Foundry package)",
    ]);
  });

  it("allows instance tabs at L1 (one tab per publication)", () => {
    expect(iaNoConsumer(broken(consumer => editIa(consumer, "publisher", ia => { renameL1(ia, "studio", "Studio"); ia.axes.L1.web = { name: "publication", instance: true }; })))).toEqual([]);
  });

  it("mutation proof: a disabled R01.9 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], clean(), broken(consumer => editIa(consumer, "designer", ia => renameL1(ia, "studio", "Studio"))))).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.10 IA-NO-MIRROR", () => {
  const twoGroups = (spec: WorkspaceSpec) => tree(spec, consumer => editIa(consumer, "publisher", ia => {
    const pages = ia.nodes[0].children[0].slots as string[];
    ia.nodes[0].children = [{ id: "all", label: "All", slots: pages.filter(id => !id.startsWith("page.director")) }, { id: "more", label: "More", slots: pages.filter(id => id.startsWith("page.director")) }];
  }));

  it("passes the clean workspace and the nav fixture, and flags a node that groups pages over two L2 groups", () => {
    expect(iaNoMirror(tree(navSpec()))).toEqual([]);
    const rows = expectCatches(iaNoMirror, clean(), twoGroups(navSpec()));
    expect(reasons(rows)).toEqual(["publisher:*: node home groups its pages into all, more: page groups derive from the publication map, not ia.json"]);
  });

  it("flags a node or child that copies a nav group of the Studio publication", () => {
    const rows = iaNoMirror(tree(navSpec(), consumer => editIa(consumer, "publisher", ia => { renameL1(ia, "director", "Director"); ia.nodes[0].children[0].id = "designer"; })));
    expect(reasons(rows)).toEqual([
      "publisher:*: node director copies the publication.studio nav group director: page groups derive from the publication map",
      "publisher:*: node director child designer copies the publication.studio nav group designer: page groups derive from the publication map",
    ]);
  });

  it("mutation proof: a disabled R01.10 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], clean(), twoGroups(navSpec()))).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.11 IA-SHARED-AXIS", () => {
  it("passes the clean workspace, Section copy mirroring Sections, and a declared L0 mirror", () => {
    expect(iaSharedAxis(clean())).toEqual([]);
    expect(iaSharedAxis(broken(sectionCopy))).toEqual([]);
    expect(iaSharedAxis(broken(mirrored))).toEqual([]);
  });

  it("flags Section copy L2 groups that differ from Designer Sections", () => {
    const rows = expectCatches(iaSharedAxis, broken(sectionCopy), broken(consumer => {
      designerSections([...SECTION_GROUPS, { id: "sections-forms", label: "Forms" }])(consumer);
      writerSectionCopy([COPY_GROUPS[1]!, { ...COPY_GROUPS[0]!, label: "Pieces" }, { id: "states", label: "States" }])(consumer);
    }));
    expect(reasons(rows)).toEqual([
      "writer:*: designer/sections.sections L2 forms (Forms) has no mirror in writer/copy.section-copy",
      "writer:*: writer/copy.section-copy L2 parts is labelled Pieces, designer/sections.sections labels it Parts",
      "writer:*: writer/copy.section-copy L2 states (States) is not in designer/sections.sections",
      "writer:*: writer/copy.section-copy orders its L2 groups story, parts; designer/sections.sections orders them parts, story",
    ]);
  });

  it("names a missing Section copy only when Designer places Sections, and no L0 passages", () => {
    expect(reasons(iaSharedAxis(broken(designerSections())))).toEqual(["writer:*: L1 copy.section-copy is missing: it must mirror the L2 groups of designer/sections.sections"]);
    expect(reasons(iaSharedAxis(broken(writerSectionCopy())))).toEqual(["designer:*: L1 sections.sections is missing: writer/copy.section-copy mirrors its L2 groups"]);
  });

  it("flags a declared L0 mirror whose L1 list differs from its source", () => {
    const rows = expectCatches(iaSharedAxis, broken(mirrored), broken(consumer => {
      editIa(consumer, "designer", ia => addL0(ia, { id: "sections", label: "Sections" }, [...SECTIONS, { id: "sections.collect", label: "Collect" }]));
      editIa(consumer, "writer", ia => addL0(ia, { id: "passages", label: "Passages" }, [PASSAGES[1]!, { ...PASSAGES[0]!, label: "Explainers" }, { id: "passages.parts", label: "Parts" }], { mirrors: "designer/sections" }));
    }));
    expect(reasons(rows)).toEqual([
      "writer:*: designer/sections L1 collect (Collect) has no mirror in writer/passages",
      "writer:*: writer/passages L1 explain is labelled Explainers, designer/sections labels it Explain",
      "writer:*: writer/passages L1 parts (Parts) is not in designer/sections",
      "writer:*: writer/passages orders its L1 tabs organize, explain; designer/sections orders them explain, organize",
    ]);
  });

  it("flags a mirror whose source L0 is missing", () => {
    const rows = iaSharedAxis(broken(consumer => editIa(consumer, "writer", ia => addL0(ia, { id: "narratives", label: "Narratives" }, [{ id: "narratives.web", label: "Web" }], { mirrors: "publisher/publications" }))));
    expect(reasons(rows)).toEqual(["publisher:*: L0 publications is missing: writer/narratives mirrors its L1 list"]);
  });

  it("mutation proof: a disabled R01.11 fails the failing-first contract", () => {
    const bad = broken(designerSections());
    expect(iaSharedAxis(bad).length).toBeGreaterThan(0);
    expect(() => expectCatches(() => [], clean(), bad)).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.12 IA-LABEL-UNIQUE", () => {
  it("passes the clean workspace and flags one label naming two concepts across agents", () => {
    const rows = expectCatches(iaLabelUnique, clean(), broken(consumer => editIa(consumer, "writer", ia => renameL1(ia, "controls", "Controls"))));
    expect(reasons(rows)).toEqual([
      "designer:*: L1 controls label Controls also names writer L1 controls (Controls) (declare it in axes.shared or rename)",
      "writer:*: L1 controls label Controls also names designer L1 controls (Controls) (declare it in axes.shared or rename)",
    ]);
  });

  it("accepts a label both agents declare shared, and a mirror's labels", () => {
    expect(iaLabelUnique(broken(consumer => {
      editIa(consumer, "writer", ia => { renameL1(ia, "controls", "Controls"); ia.axes.shared = ["Controls"]; });
      editIa(consumer, "designer", ia => { ia.axes.shared = ["controls"]; });
    }))).toEqual([]);
    expect(iaLabelUnique(broken(mirrored))).toEqual([]);
  });

  it("flags a label whose slug is not the id, and a repeat under one parent", () => {
    const rows = iaLabelUnique(broken(consumer => {
      editIa(consumer, "designer", ia => { ia.nodes[0].label = "Media"; });
      editIa(consumer, "writer", ia => { addL0(ia, { id: "patterns", label: "Patterns" }, [{ id: "patterns.feedback", label: "Feedback" }, { id: "patterns.messages", label: "Feedback" }]); });
    }));
    expect(reasons(rows)).toEqual([
      "designer:*: L1 controls is labelled Media: the label's slug media must be the id controls",
      "writer:*: L1 patterns.feedback repeats the label Feedback under one parent (patterns.messages)",
      "writer:*: L1 patterns.messages is labelled Feedback: the label's slug feedback must be the id messages",
      "writer:*: L1 patterns.messages repeats the label Feedback under one parent (patterns.feedback)",
    ]);
  });

  it("mutation proof: a disabled R01.12 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], clean(), broken(consumer => editIa(consumer, "writer", ia => renameL1(ia, "controls", "Controls"))))).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.13 NAV-IA-PARITY", () => {
  it("passes the clean workspace (no Studio publication) and the nav fixture", () => {
    expect(navIaParity(clean())).toEqual([]);
    expect(navIaParity(tree(navSpec()))).toEqual([]);
  });

  it("flags a missing agent group and an unreachable page", () => {
    const pages = NAV_PAGES.map(page => (page.id === "page.producer-pipeline" ? { ...page, group: "none" } : page));
    const rows = expectCatches(navIaParity, tree(navSpec()), tree(navSpec(pages, ["workspace", "director", "designer", "writer", "publisher"]), consumer => {
      editJson(join(consumer, "agents", "publisher", "page.producer-pipeline", "candidates", "page-v1.json"), page => { delete page.nav; });
      editJson(join(consumer, "agents", "publisher", "publication.studio", "candidates", "publication-v1.json"), doc => { doc.meta.tree.children.push({ id: "studio.pages", cells: ["page.producer-pipeline"] }); });
    }));
    expect(reasons(rows)).toEqual([
      "publisher:*: the Studio nav has no group producer",
      "publisher:page.producer-pipeline: route /producer/pipeline is not reachable from the nav and not declared hidden (nav: {hidden: true})",
    ]);
  });

  it("flags an extra group, groups out of chain order, and nav pages that are not the agent's L0s", () => {
    const pages = NAV_PAGES.map(page => (page.id === "page.director-plan" ? { ...page, path: "/director/goals" } : page));
    const rows = navIaParity(tree(navSpec(pages, ["workspace", "producer", "designer", "director", "writer", "publisher"]), consumer => {
      editJson(join(consumer, "agents", "publisher", "page.home", "candidates", "page-v1.json"), page => { page.nav = { nav: true }; });
      editJson(join(consumer, "agents", "publisher", "publication.studio", "candidates", "publication-v1.json"), doc => {
        doc.meta.tree.children[0].cells = doc.meta.tree.children[0].cells.filter((id: string) => id !== "page.home");
        doc.meta.tree.children.push({ id: "studio.pages", cells: ["page.home"] });
      });
    }));
    expect(reasons(rows)).toEqual([
      "publisher:*: nav group studio is neither workspace nor an agent with an ia.json",
      "publisher:*: nav groups run workspace, producer, designer, director, writer, publisher; chain order is workspace, producer, director, designer, writer, publisher",
      "publisher:*: nav group director has no page for director L0 plan",
      "publisher:*: nav group director shows goals, which is not a director L0 (plan)",
    ]);
  });

  it("flags a Studio publication with no readable pinned tree", () => {
    const spec = cleanSpec();
    spec.publisher!["publication.studio"] = { candidates: { "publication-v1.json": { schema: "clossys.publication/1" } } };
    expect(reasons(navIaParity(tree(spec)))).toEqual(["publisher:*: publication.studio has no meta.tree: its nav cannot be read"]);
  });

  it("mutation proof: a disabled R01.13 fails the failing-first contract", () => {
    const bad = tree(navSpec(NAV_PAGES.filter(page => page.group !== "producer"), ["workspace", "director", "designer", "writer", "publisher"]));
    expect(navIaParity(bad).length).toBeGreaterThan(0);
    expect(() => expectCatches(() => [], tree(navSpec()), bad)).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.14 IA-EXTENSION-FACET", () => {
  it("passes the clean workspace and flags a listed extension without extension: true", () => {
    const rows = expectCatches(iaExtensionFacet, clean(), broken(consumer => editSlot(consumer, "director", "brand.voice", doc => { delete doc.extension; })));
    expect(reasons(rows)).toEqual(["director:brand.voice: listed in ia.json extensions, but slot.json has no extension: true"]);
  });

  it("flags an unlisted extension: true, a listed extension in a provenance tab and an unlisted leaf in one", () => {
    const spec = cleanSpec();
    spec.publisher!["site.home"]!.slot = { ...slotDoc("publisher", "site.home", { inputs: ["ui.card", "home.hero"] }), extension: true };
    const rows = iaExtensionFacet(tree(spec, consumer => {
      editIa(consumer, "designer", ia => { renameL1(ia, "extensions", "Consumer extensions"); ia.extensions = ["ui.button"]; });
      editSlot(consumer, "designer", "ui.card", doc => { delete doc.extension; });
    }));
    expect(reasons(rows)).toEqual([
      "designer:ui.button: extension sits in the provenance tab extensions (Consumer extensions): place it under its Foundry L1",
      "designer:ui.card: leaf in the provenance tab extensions (Consumer extensions) is not in ia.json extensions",
      "publisher:site.home: slot.json says extension: true, but ia.json extensions does not list it",
    ]);
  });

  it("mutation proof: a disabled R01.14 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], clean(), broken(consumer => editSlot(consumer, "director", "brand.voice", doc => { delete doc.extension; })))).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.15 IA-FANOUT (warn)", () => {
  it("warns on an L0 with one L1 and an L1 with one leaf, and is silent on a wide IA", () => {
    const wide = (consumer: string) => editIa(consumer, "designer", ia => {
      ia.nodes.push({ id: "panels", label: "Panels", children: [{ id: "all", label: "All", slots: ["ui.panel", "ui.sheet"] }] });
      ia.layers[0].nodes.push("panels");
    });
    expect(iaFanout(broken(wide)).filter(item => item.agent === "designer")).toEqual([]);
    const rows = expectCatches(c => iaFanout(c).filter(item => item.agent === "designer"), broken(wide), clean());
    expect(reasons(rows)).toEqual(["designer:*: L0 kit (Kit) has one L1 (controls)"]);
    expect(reasons(iaFanout(clean()).filter(item => item.agent === "director"))).toEqual([
      "director:*: L0 plan (Plan) has one L1 (goals)",
      "director:*: L1 goals (Goals) has one leaf (brand.voice)",
    ]);
  });

  it("mutation proof: a disabled R01.15 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], tree(cleanSpec(), consumer => editIa(consumer, "designer", ia => {
      ia.nodes.push({ id: "panels", label: "Panels", children: [{ id: "all", label: "All", slots: ["ui.panel", "ui.sheet"] }] });
      ia.layers[0].nodes.push("panels");
    })), clean())).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.16 IA-EMPTY-GROUP", () => {
  /** Adds an L2 group that places no leaf under the agent's first L1 node. */
  const emptyGroup = (agent: Agent) => (consumer: string) => editIa(consumer, agent, ia => { ia.nodes[0].children.push({ id: "empty", label: "Empty", slots: [] }); });

  it("passes the clean workspace and flags an L2 group with no leaf, for every agent", () => {
    expect(iaEmptyGroup(clean())).toEqual([]);
    for (const agent of ["director", "designer", "writer", "publisher", "producer"] as const) {
      const rows = expectCatches(iaEmptyGroup, clean(), broken(emptyGroup(agent)));
      expect(rows.every(item => item.agent === agent && item.check === "R01.16"), agent).toBe(true);
      expect(reasons(rows), agent).toEqual([expect.stringMatching(new RegExp(`^${agent}:\\*: L2 group [^ ]+/empty \\(Empty\\) places no leaf: fill it or drop it \\(clossys ia ${agent} --drop [^ ]+/empty\\)$`))]);
    }
  });

  it("catches the child of an undotted node read as L0 and a dotted node with no layers alike", () => {
    const flat = broken(consumer => editIa(consumer, "designer", ia => {
      delete ia.layers;
      ia.nodes = [
        { id: "themes.colors", label: "Colors", children: [{ id: "base", label: "Base", slots: ["ui.button"] }, { id: "spare", label: "Spare", slots: [] }] },
        { id: "studio", label: "Studio", children: [{ id: "pages", label: "Pages", slots: [] }] },
      ];
    }));
    expect(reasons(iaEmptyGroup(flat))).toEqual([
      "designer:*: L2 group themes.colors/spare (Spare) places no leaf: fill it or drop it (clossys ia designer --drop themes.colors/spare)",
      "designer:*: L2 group studio/pages (Pages) places no leaf: fill it or drop it (clossys ia designer --drop studio/pages)",
    ]);
  });

  it("fails the strict run on an empty L2 group and reports it, as a building row, without strict", () => {
    const { root, consumer } = writeWorkspace(cleanSpec());
    emptyGroup("writer")(consumer);
    const strict = runConstitution({ root, consumer, rule: "R01", strict: true, history: () => NO_HISTORY, now: () => 0 });
    expect(strict.ok).toBe(false);
    expect(strict.rows).toEqual([expect.objectContaining({ check: "R01.16", agent: "writer", level: "building" })]);
    expect(strict.rules.find(rule => rule.id === "R01")).toMatchObject({ failing: 1, building: 1 });
    const relaxed = runConstitution({ root, consumer, rule: "R01", strict: false, history: () => NO_HISTORY, now: () => 0 });
    expect(relaxed).toMatchObject({ ok: true, total: 1, building: 1 });
  });

  it("mutation proof: a disabled R01.16 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], clean(), broken(emptyGroup("director")))).toThrow(/silent on the broken workspace/);
  });
});

describe("building and warn statuses in the runner", () => {
  const run = (consumerEdit: ((consumer: string) => void) | undefined, strict: boolean) => {
    const { root, consumer } = writeWorkspace(cleanSpec());
    consumerEdit?.(consumer);
    return runConstitution({ root, consumer, rule: "R01", strict, history: () => NO_HISTORY, now: () => 0 });
  };

  it("passes the clean workspace with fanout warnings only, strict or not", () => {
    for (const strict of [false, true]) {
      const report = run(undefined, strict);
      expect(report).toMatchObject({ ok: true, strict, total: 0, building: 0 });
      expect(report.warnings.length).toBeGreaterThan(0);
      expect(report.warnings.every(item => item.check === "R01.15" && item.level === "warn")).toBe(true);
      const text = formatReport(report);
      expect(text).toMatch(/^R01 ok {2}rows 0$/m);
      expect(text).toMatch(/^ {2}warnings \d+ \(never fail the run\)$/m);
    }
  });

  it("reports building rows without failing, and fails them under strict", () => {
    const noAxes = (consumer: string) => editIa(consumer, "writer", ia => { delete ia.axes; });
    const relaxed = run(noAxes, false);
    expect(relaxed).toMatchObject({ ok: true, total: 1, building: 1 });
    expect(relaxed.rows).toEqual([expect.objectContaining({ check: "R01.7", agent: "writer", level: "building" })]);
    expect(formatReport(relaxed)).toMatch(/^R01 BUILDING {2}rows 1 {2}\(writer 1; R01\.7 1\)/m);
    expect(formatReport(relaxed)).toMatch(/constitution: PASS {2}rows 1 \(pending 0, findings 0\) {2}building 1 \(report only; --strict fails them\)/);
    const strict = run(noAxes, true);
    expect(strict).toMatchObject({ ok: false, total: 1, building: 1 });
    expect(formatReport(strict)).toMatch(/^R01 FAIL {2}rows 1/m);
  });

  it("still fails an enforced R01 row without strict", () => {
    const report = run(consumer => editIa(consumer, "publisher", ia => { delete ia.schema; }), false);
    expect(report.ok).toBe(false);
    expect(report.rows.filter(item => item.check === "R01.1")).toEqual([expect.not.objectContaining({ level: expect.anything() })]);
  });

  it("mutation proof: a runner that ignored strict would pass the strict run", () => {
    const failing = (rows: readonly Row[], strict: boolean) => rows.some(item => item.level !== "building" || strict);
    const rows = run(consumer => editIa(consumer, "writer", ia => { delete ia.axes; }), true).rows;
    expect(failing(rows, true)).toBe(true);
    expect(failing(rows, false)).toBe(false);
  });
});

/** Every IA check is held to the failing-first contract on one shared clean/broken pair it must catch. */
const CATCHES: Record<string, [() => ConstitutionContext, () => ConstitutionContext]> = {
  "R01.7": [clean, () => broken(consumer => editIa(consumer, "writer", ia => { delete ia.axes; }))],
  "R01.8": [clean, () => broken(consumer => editIa(consumer, "producer", ia => { delete ia.layers; }))],
  "R01.9": [clean, () => broken(consumer => editIa(consumer, "designer", ia => renameL1(ia, "producer", "Producer")))],
  "R01.10": [() => tree(navSpec()), () => tree(navSpec(), consumer => editIa(consumer, "publisher", ia => renameL1(ia, "writer", "Writer")))],
  "R01.11": [() => broken(sectionCopy), () => broken(designerSections())],
  "R01.12": [clean, () => broken(consumer => editIa(consumer, "director", ia => renameL1(ia, "controls", "Controls")))],
  "R01.13": [() => tree(navSpec()), () => tree(navSpec(NAV_PAGES.filter(page => page.id !== "page.runs")), consumer => editJson(join(consumer, "agents", "publisher", "publication.studio", "candidates", "publication-v1.json"), doc => { doc.meta.tree.children[0].cells.push("page.ghost"); }))],
  "R01.14": [clean, () => broken(consumer => editIa(consumer, "writer", ia => { ia.extensions = []; }))],
};
describe("failing-first over every building IA check", () => {
  for (const [id, [good, bad]] of Object.entries(CATCHES)) {
    it(`${id} is silent on its pass fixture and catches its fail fixture`, () => {
      const check: Check = R01.checks[id]!;
      expect(expectCatches(check, good(), bad()).length).toBeGreaterThan(0);
    });
  }
});

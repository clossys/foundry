import { describe, expect, it } from "vitest";
import { checkDirectorTree, loadDirectorTree, renderTemplate, type DirectorTree, type DirectorTreeRule } from "./ia/tree.js";

const count = (tree: DirectorTree) => ({
  l0: tree.l0.length,
  l1: tree.l0.flatMap(l0 => l0.l1).length,
  l2: tree.l0.flatMap(l0 => l0.l1.flatMap(l1 => l1.l2)).length,
  l3: tree.slots.length,
  templates: tree.templates.length,
});

describe("Director tree counts (ia-target director.md 2)", () => {
  it("holds 3 L0, 9 L1, 27 L2, 55 L3 and 24 starter templates", () => {
    const tree = loadDirectorTree();
    expect(count(tree)).toEqual({ l0: 3, l1: 9, l2: 27, l3: 55, templates: 24 });
    expect(tree.l0.map(l0 => l0.id)).toEqual(["strategy", "roadmap", "execution"]);
    expect(tree.l0.map(l0 => [l0.l1.length, l0.l1.flatMap(l1 => l1.l2).length, l0.l1.flatMap(l1 => l1.l2.flatMap(l2 => l2.slots)).length])).toEqual([[5, 18, 36], [2, 4, 8], [2, 5, 11]]);
    const starters = (l0: string) => tree.slots.filter(slot => slot.l0 === l0 && slot.mark === "starter").length;
    expect([starters("strategy"), starters("roadmap"), starters("execution")]).toEqual([20, 1, 3]);
    expect(tree.slots.filter(slot => slot.mark === "other-live")).toHaveLength(31);
  });

  it("is sound: every slot has a brief, every use resolves, no retired id returns, every template passes its slot", () => {
    expect(checkDirectorTree(loadDirectorTree())).toEqual([]);
  });

  it("retires the two merged ids into Own", () => {
    const tree = loadDirectorTree();
    expect(tree.retired.map(entry => [entry.id, entry.fate, entry.target])).toEqual([
      ["capability.operation.technology", "merged", "capability.sourcing.build"],
      ["capability.sourcing.acquire", "merged", "capability.sourcing.build"],
    ]);
  });

  it("ships each starter template exactly as its slot renders it (keys, no answers)", () => {
    const tree = loadDirectorTree();
    for (const template of tree.templates) {
      const slot = tree.slots.find(candidate => candidate.id === template.slot)!;
      const createdAt = /createdAt: "([^"]+)"/.exec(template.text)?.[1] ?? "";
      expect(template.text, template.slot).toBe(renderTemplate(slot, tree.packageVersion, createdAt));
    }
  });

  const mutations: [string, DirectorTreeRule, (tree: DirectorTree) => void][] = [
    ["a slot with no brief", "brief.missing", tree => { delete tree.slots[0]!.brief; }],
    ["a slot whose brief has an empty question", "brief.missing", tree => { tree.slots[0]!.brief!.question = " "; }],
    ["a slot whose uses names a missing slot", "uses.dangling", tree => { tree.slots[0]!.uses.push("context.market.missing"); }],
    ["a retired id reused as a live slot", "retired.reused", tree => {
      const slot = structuredClone(tree.slots[0]!);
      slot.id = tree.retired[0]!.id;
      tree.slots.push(slot);
      tree.l0[0]!.l1[0]!.l2[0]!.slots.push(slot.id);
    }],
    ["a retired id reused in uses", "retired.reused", tree => { tree.slots[0]!.uses.push(tree.retired[1]!.id); }],
    ["a template that fails its own slot checks (answered)", "template.check", tree => { tree.templates[0]!.text += "An answer.\n"; }],
    ["a template that fails its own slot checks (key dropped)", "template.check", tree => { tree.templates[0]!.text = tree.templates[0]!.text.replace(/## [^\n]+\n\n?$/, ""); }],
    ["a template that fails its own slot checks (wrong slot header)", "template.check", tree => { tree.templates[0]!.text = tree.templates[0]!.text.replace(/slot: "director\/[^"]+"/, 'slot: "director/context.market.size"'); }],
    ["a starter without a template", "template.missing", tree => { tree.templates.shift(); }],
    ["a template on a non-starter slot", "template.extra", tree => { tree.templates.push({ ...tree.templates[0]!, slot: tree.slots.find(slot => slot.mark === "other-live")!.id }); }],
    ["a slot placed twice", "tree.placement", tree => { tree.l0[1]!.l1[0]!.l2[0]!.slots.push(tree.slots[0]!.id); }],
  ];
  it.each(mutations)("rejects %s", (_name, rule, mutate) => {
    const tree = loadDirectorTree();
    mutate(tree);
    const issues = checkDirectorTree(tree);
    expect(issues.map(issue => issue.rule)).toContain(rule);
  });

  it("loads fresh data without sharing mutable state", () => {
    loadDirectorTree().slots.pop();
    expect(loadDirectorTree().slots).toHaveLength(55);
  });
});

/**
 * Leaf freeze over Voice, Prose and Copy (foundry-audit-0019): removing, renaming or adding a leaf id without a
 * recorded amendment fails; an amendment that names the change passes.
 */
import { describe, expect, it } from "vitest";
import { loadWriterTrees, type GroupTree } from "../catalog/ia/target.js";
import { checkGroupLeafFreeze, loadGroupLeafFreezes, type GroupLeafFreeze } from "./leaf-freeze.js";

const trees = loadWriterTrees();
const freezes = loadGroupLeafFreezes();
const clone = <T>(value: T): T => structuredClone(value);
const group = (id: string, from: readonly GroupTree[]) => from.find(tree => tree.group === id)!;
const text = (findings: readonly { message: string }[]) => findings.map(finding => finding.message).join("\n");

describe("Writer group leaf freeze", () => {
  it("has one freeze per group and the committed trees match them", () => {
    expect(freezes.map(freeze => freeze.group)).toEqual(["voice", "prose", "copy"]);
    expect(freezes.map(freeze => freeze.leafIds.length)).toEqual([12, 5, 58]);
    expect(checkGroupLeafFreeze(trees, freezes)).toEqual([]);
  });

  it("mutation: a leaf id renamed without an amendment fails", () => {
    const next = clone(trees);
    group("voice", next).nodes[0]!.children[0]!.leaves[0] = "lexicon.register";
    const message = text(checkGroupLeafFreeze(next, freezes));
    expect(message).toContain("lexicon.formality");
    expect(message).toContain("lexicon.register");
  });

  it("mutation: a leaf id removed without an amendment fails", () => {
    const next = clone(trees);
    const l2 = group("prose", next).nodes[1]!.children[1]!;
    l2.leaves = l2.leaves.filter(id => id !== "narratives.legal-document");
    expect(text(checkGroupLeafFreeze(next, freezes))).toContain("narratives.legal-document");
  });

  it("mutation: a Copy leaf id changed fails", () => {
    const next = clone(trees);
    const l2 = group("copy", next).nodes[1]!.children[1]!;
    l2.leaves[0] = "sections.hero-banner.copy";
    expect(text(checkGroupLeafFreeze(next, freezes))).toContain("sections.hero.copy");
  });

  it("an amendment that names the rename passes", () => {
    const next = clone(trees);
    group("voice", next).nodes[0]!.children[0]!.leaves[0] = "lexicon.register";
    const amended: GroupLeafFreeze[] = clone(freezes);
    amended[0]!.amendments.push({ id: "test-rename", remove: ["lexicon.formality"], add: ["lexicon.register"], why: "fixture" });
    expect(checkGroupLeafFreeze(next, amended)).toEqual([]);
  });

  it("mutation: an amendment with no reason fails", () => {
    const amended: GroupLeafFreeze[] = clone(freezes);
    amended[1]!.amendments.push({ id: "bare", remove: [], add: [], why: "" });
    expect(checkGroupLeafFreeze(trees, amended).length).toBeGreaterThan(0);
  });
});

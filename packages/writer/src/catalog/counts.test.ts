/**
 * Writer slot tree recut (foundry-build-0019): three groups in owner order, Voice, Prose, Copy (ia-target writer.md 2).
 * Target counts are 3 L0 / 8 L1 / 23 L2 / 75 L3, marks 51 starter / 18 other-live / 6 parked. The tree reaches them
 * exactly. Two gaps against the target are recorded as SELF-AMENDs in the build-0019 receipt:
 * - 15 of the 58 Copy leaves wait on Designer `copy.fields` (6 components, 4 frames, 4 assets and
 *   sections.sectioned-document declare none yet). They are placed and frozen, but they are not slots until the
 *   Designer line declares fields (request up the chain). The other 43 are derived slots.
 * - A Copy mark is inherited from the Designer unit. Designer parks no section yet, so the five writer.md marks
 *   account-summary, explorer, filter-builder, wizard and column-mapper (~) read as other-live: Copy is 36 / 22 / 0,
 *   not 36 / 17 / 5.
 * - foundry-build-0033 adds the Copy L1 Page metadata (writer.md 2 Copy, last row; IA audit 2026-11-16 proposal 1):
 *   one L2 per live Publisher publication (site, docs, app, slides) and 25 starter slots (4 publication.<id>.meta and
 *   21 page.<id>.meta), so the totals are 3 L0 / 9 L1 / 27 L2 / 100 L3 and Copy is 61 / 22 / 0.
 */
import { describe, expect, it } from "vitest";
import {
  WRITER_GROUPS, checkWriterRetired, checkWriterTrees, countWriterTrees, loadWriterRetired, loadWriterTrees,
  oldWriterLeafIds, type GroupTree,
} from "./ia/target.js";

const trees = loadWriterTrees();
const group = (id: string, from: readonly GroupTree[] = trees) => from.find(tree => tree.group === id)!;
const clone = <T>(value: T): T => structuredClone(value);

describe("Writer tree counts (writer.md 2, Counts)", () => {
  const counts = countWriterTrees(trees);

  it("has three groups in owner order: Voice, Prose, Copy", () => {
    expect(trees.map(tree => tree.group)).toEqual([...WRITER_GROUPS]);
    expect(trees.map(tree => tree.label)).toEqual(["Voice", "Prose", "Copy"]);
  });

  it("totals 3 L0, 9 L1, 27 L2 and 100 L3 (75 + 25 Page metadata)", () => {
    expect({ l0: counts.l0, l1: counts.l1, l2: counts.l2, l3: counts.l3 }).toEqual({ l0: 3, l1: 9, l2: 27, l3: 100 });
  });

  it("counts per group", () => {
    expect(counts.byGroup.voice).toMatchObject({ l1: 2, l2: 5, l3: 12, marks: { starter: 12, "other-live": 0, parked: 0 } });
    expect(counts.byGroup.prose).toMatchObject({ l1: 2, l2: 4, l3: 5, marks: { starter: 3, "other-live": 1, parked: 1 } });
    expect(counts.byGroup.copy).toMatchObject({ l1: 5, l2: 18, l3: 83 });
  });

  it("Copy marks follow the Designer unit (36 starter; parked sections pending in Designer) plus 25 starter Page metadata", () => {
    expect(counts.byGroup.copy.marks).toEqual({ starter: 61, "other-live": 22, parked: 0 });
  });

  it("Copy has 68 derived slots (43 Designer units, 25 Page metadata) and 15 leaves waiting on Designer copy fields", () => {
    expect(counts.byGroup.copy.slots).toBe(68);
    expect(counts.byGroup.copy.awaiting).toBe(15);
  });

  it("labels the L1s and L2s by the target tree", () => {
    const labels = (id: string) => group(id).nodes.map(l1 => [l1.label, l1.children.map(l2 => l2.label)]);
    expect(labels("voice")).toEqual([["Tone", ["Attitude", "Address", "Readability"]], ["Wording", ["Mechanics", "Terms"]]]);
    expect(labels("prose")).toEqual([["Editorial", ["Narratives", "Changelog"]], ["Reference", ["Help", "Policies"]]]);
    expect(labels("copy")).toEqual([
      ["Component text", ["Actions", "Navigation", "Text and media", "Overlays"]],
      ["Section copy", ["Parts", "Story", "Reading", "Records", "Forms", "States"]],
      ["Frame copy", ["Site", "App"]],
      ["Asset text", ["Marks", "Media"]],
      ["Page metadata", ["site", "docs", "app", "slides"]],
    ]);
  });

  it("keeps the 12 lexicon ids in Voice and the 4 narratives ids in Prose; case-study is the one NEW id", () => {
    const leaves = (id: string) => group(id).nodes.flatMap(l1 => l1.children.flatMap(l2 => l2.leaves));
    expect(leaves("voice")).toEqual([
      "lexicon.formality", "lexicon.warmth", "lexicon.energy", "lexicon.person", "lexicon.mood", "lexicon.sentence-length",
      "lexicon.reading-level", "lexicon.capitalization", "lexicon.punctuation", "lexicon.preferred-terms", "lexicon.avoid-terms",
      "lexicon.avoid-patterns",
    ]);
    expect(leaves("prose")).toEqual(["narratives.article", "narratives.case-study", "narratives.release-notes", "narratives.guide", "narratives.legal-document"]);
    expect(group("prose").slots.filter(slot => slot.new).map(slot => slot.id)).toEqual(["narratives.case-study"]);
    const old = new Set(oldWriterLeafIds());
    expect([...leaves("voice"), ...leaves("prose")].filter(id => old.has(id))).toHaveLength(16);
  });
});

describe("Writer tree soundness", () => {
  it("passes on the committed tree", () => {
    expect(checkWriterTrees(trees)).toEqual([]);
  });

  it("mutation: a leaf placed twice fails", () => {
    const next = clone(trees);
    group("voice", next).nodes[0]!.children[0]!.leaves.push("lexicon.person");
    expect(checkWriterTrees(next).map(finding => finding.message).join("\n")).toContain("lexicon.person is placed 2 times");
  });

  it("mutation: a slot with no placement fails", () => {
    const next = clone(trees);
    const prose = group("prose", next);
    prose.nodes[1]!.children[0]!.leaves = [];
    expect(checkWriterTrees(next).map(finding => finding.message).join("\n")).toMatch(/narratives\.guide is not placed|empty/);
  });

  it("mutation: a leaf id outside its group's id form fails", () => {
    const next = clone(trees);
    group("voice", next).nodes[0]!.children[0]!.leaves[0] = "strings.actions";
    expect(checkWriterTrees(next).length).toBeGreaterThan(0);
  });
});

describe("retired.json: the 121 old ids and where they went", () => {
  const retired = loadWriterRetired();
  const old = oldWriterLeafIds();

  it("the old tree had 137 ids; 16 are kept and 121 retire with a fate and a target", () => {
    expect(old).toHaveLength(137);
    expect(retired).toHaveLength(121);
    expect(checkWriterRetired(retired, old, trees)).toEqual([]);
  });

  it("splits by fate as the recut proves", () => {
    const byFate: Record<string, number> = {};
    for (const entry of retired) byFate[entry.fate] = (byFate[entry.fate] ?? 0) + 1;
    expect(byFate).toEqual({ copy: 60, "purpose-shape": 23, dropped: 11, "field-role": 10, "intl-code": 9, "director-field": 7, prose: 1 });
  });

  it("mutation: an old id with no retired row fails", () => {
    const next = retired.filter(entry => entry.id !== "strings.actions");
    expect(checkWriterRetired(next, old, trees).map(finding => finding.message).join("\n")).toContain("strings.actions");
  });

  it("mutation: a copy row pointing at a slot that is not in the Copy tree fails", () => {
    const next = clone(retired);
    next.find(entry => entry.id === "passages.hero")!.target = "sections.nope.copy";
    expect(checkWriterRetired(next, old, trees).map(finding => finding.message).join("\n")).toContain("sections.nope.copy");
  });

  it("mutation: a kept id also marked retired fails", () => {
    const next = [...clone(retired), { id: "lexicon.warmth", fate: "dropped", target: "nothing" }];
    expect(checkWriterRetired(next, old, trees).length).toBeGreaterThan(0);
  });
});

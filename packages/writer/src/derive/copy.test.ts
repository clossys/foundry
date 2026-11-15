/**
 * Copy slots are derived from the Designer catalog (writer.md 2 Copy, 9.4.3): one `<unit>.copy` slot per live Designer
 * unit that declares copy fields, fields projected with a digest, L2 = the unit's Designer L2, mark inherited.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPY_TARGET_UNITS, checkCopyAgainstDesigner, deriveCopyTree, loadDesignerCopyInput, type DesignerCopyInput } from "./copy.js";
import { runDeriveCopy } from "./cli.js";

const input = loadDesignerCopyInput();
const committed = JSON.parse(readFileSync(new URL("../catalog/ia/copy.json", import.meta.url), "utf8"));
const clone = <T>(value: T): T => structuredClone(value);
const messages = (tree: unknown, from: DesignerCopyInput = input) => checkCopyAgainstDesigner(tree as never, from).map(finding => finding.message).join("\n");

describe("Copy is generated from the Designer catalog", () => {
  it("the committed copy.json is exactly the derivation of the current Designer catalog", () => {
    expect(committed).toEqual(deriveCopyTree(input));
  });

  it("the derive CLI reports current with --check", () => {
    const out: string[] = [], err: string[] = [];
    expect(runDeriveCopy({ args: ["--check"], stdout: text => out.push(text), stderr: text => err.push(text) })).toBe(0);
    expect(err.join("")).toBe("");
  });

  it("lists the 58 writer.md units, in Designer order, each once", () => {
    expect(COPY_TARGET_UNITS).toHaveLength(58);
    expect(new Set(COPY_TARGET_UNITS).size).toBe(58);
    const placed = committed.nodes.flatMap((l1: { children: { leaves: string[] }[] }) => l1.children.flatMap(l2 => l2.leaves));
    expect(placed).toHaveLength(58);
    expect(new Set(placed)).toEqual(new Set(COPY_TARGET_UNITS.map(unit => `${unit}.copy`)));
  });

  it("every Designer unit with copy fields has exactly one Copy slot, and every Copy slot has Designer fields", () => {
    expect(checkCopyAgainstDesigner(committed, input)).toEqual([]);
    const withFields = input.slots.filter(slot => (slot.contract?.copy?.fields?.length ?? 0) > 0 && !input.retired.has(slot.id)).map(slot => slot.id);
    expect(committed.slots.map((slot: { contract: { unit: string } }) => slot.contract.unit).sort()).toEqual(withFields.map(id => `designer/${id}`).sort());
  });

  it("projects each field with its role and budget and pins a fields digest", () => {
    const hero = committed.slots.find((slot: { id: string }) => slot.id === "sections.hero.copy");
    expect(hero).toMatchObject({ kind: "copy", mark: "starter", contract: { unit: "designer/sections.hero", copy: { sourceLocale: "en" } } });
    expect(hero.contract.fieldsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hero.contract.copy.fields[0]).toEqual({ key: "header.heading", kind: "plain", role: "heading", required: true, maxLength: { en: 60 }, dir: "auto" });
  });

  it("names its Director inputs by key and reads style only through Voice", () => {
    const hero = committed.slots.find((slot: { id: string }) => slot.id === "sections.hero.copy");
    expect(hero.inputs.filter((ref: { to: string }) => ref.to.startsWith("writer/lexicon.")).length).toBe(12);
    expect(hero.inputs.some((ref: { to: string }) => ref.to === "director/identity.verbal.voice")).toBe(false);
    expect(hero.inputs.filter((ref: { to: string }) => ref.to.startsWith("director/")).every((ref: { key?: string }) => typeof ref.key === "string")).toBe(true);
  });
});

describe("mutations that must die", () => {
  it("a Copy slot with no Designer field", () => {
    const tree = clone(committed);
    const slot = clone(tree.slots[0]);
    slot.id = "sections.band.copy";
    slot.contract.unit = "designer/sections.band";
    tree.slots.push(slot);
    tree.nodes[1].children[0].leaves.push("sections.band.copy");
    expect(messages(tree)).toContain("sections.band.copy");
  });

  it("a Designer unit with copy fields and no Copy slot", () => {
    const tree = clone(committed);
    tree.slots = tree.slots.filter((slot: { id: string }) => slot.id !== "sections.faq.copy");
    expect(messages(tree)).toContain("designer/sections.faq");
  });

  it("a Designer field changed under a stale digest", () => {
    const next = clone(input);
    const faq = next.slots.find(slot => slot.id === "sections.faq")!;
    faq.contract!.copy!.fields![0]!.maxLength = { en: 10 };
    expect(messages(committed, next)).toContain("sections.faq.copy");
  });

  it("a waiting leaf whose Designer unit now declares fields", () => {
    const next = clone(input);
    const sidebar = next.slots.find(slot => slot.id === "components.sidebar")!;
    sidebar.contract = { ...(sidebar.contract ?? {}), copy: { sourceLocale: "en", fields: [{ key: "nav.label", kind: "plain", role: "label", required: true, maxLength: { en: 40 }, dir: "auto" }] } };
    expect(messages(committed, next)).toContain("components.sidebar");
  });

  it("a slot for a retired Designer unit", () => {
    const next = clone(input);
    next.retired.add("sections.hero");
    expect(messages(committed, next)).toContain("sections.hero");
  });
});

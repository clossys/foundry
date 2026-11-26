/**
 * Copy slots are derived from the Designer catalog (writer.md 2 Copy, 9.4.3): one `<unit>.copy` slot per live Designer
 * unit that declares copy fields, fields projected with a digest, L2 = the unit's Designer L2, mark inherited.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COPY_TARGET_UNITS, PAGE_METADATA_L1, RECORD_LABEL_LEAVES, checkCopyAgainstDesigner, checkRecordLabels, deriveCopyTree, fieldsSha256, loadDesignerCopyInput, type DesignerCopyInput,
} from "./copy.js";
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

  // CP1-WREC: the declared record-label leaves sit in the Designer-layer L1s too, but are not Designer units.
  it("lists the 58 writer.md units, in Designer order, each once", () => {
    expect(COPY_TARGET_UNITS).toHaveLength(58);
    expect(new Set(COPY_TARGET_UNITS).size).toBe(58);
    const declared = new Set(RECORD_LABEL_LEAVES.map(leaf => leaf.id));
    const placed = committed.nodes.filter((l1: { id: string }) => l1.id !== PAGE_METADATA_L1.id)
      .flatMap((l1: { children: { leaves: string[] }[] }) => l1.children.flatMap(l2 => l2.leaves)).filter((id: string) => !declared.has(id));
    expect(placed).toHaveLength(58);
    expect(new Set(placed)).toEqual(new Set(COPY_TARGET_UNITS.map(unit => `${unit}.copy`)));
  });

  it("every Designer unit with copy fields has exactly one Copy slot, and every Copy slot has Designer fields", () => {
    expect(checkCopyAgainstDesigner(committed, input)).toEqual([]);
    const withFields = input.slots.filter(slot => (slot.contract?.copy?.fields?.length ?? 0) > 0 && !input.retired.has(slot.id)).map(slot => slot.id);
    const designerUnits = committed.slots.map((slot: { contract: { unit: string } }) => slot.contract.unit).filter((unit: string) => unit.startsWith("designer/"));
    expect(designerUnits.sort()).toEqual(withFields.map(id => `designer/${id}`).sort());
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

describe("Page metadata is generated from the Publisher directory (foundry-build-0033)", () => {
  const pageMeta = committed.nodes.find((l1: { id: string }) => l1.id === PAGE_METADATA_L1.id);
  const livePages = Object.entries(input.directory.slots).filter(([, page]) => page.kind === "page" && !page.parked && page.records?.meta);

  it("is the last Copy L1, one L2 per live publication, labelled by the publication id", () => {
    expect(committed.nodes.at(-1).id).toBe("copy/page-metadata");
    expect(pageMeta.label).toBe("Page metadata");
    expect(pageMeta.children.map((l2: { id: string; label: string }) => [l2.id, l2.label])).toEqual([
      ["copy/page-metadata/site", "site"], ["copy/page-metadata/docs", "docs"], ["copy/page-metadata/app", "app"], ["copy/page-metadata/admin", "admin"], ["copy/page-metadata/slides", "slides"],
    ]);
  });

  // foundry-build-0048 (Amendment 2026-11-18b, A1/A2): the admin workspace publication and its five pages plus the generic
  // site page add six live pages (21 -> 27) and one publication (4 -> 5).
  it("has one page.<id>.meta per live Publisher page that names it (27) and one publication.<id>.meta per live publication (5)", () => {
    expect(livePages).toHaveLength(27);
    const leaves: string[] = pageMeta.children.flatMap((l2: { leaves: string[] }) => l2.leaves);
    expect(leaves.filter(id => id.startsWith("page."))).toEqual(livePages.map(([id]) => `${id}.meta`));
    expect(leaves.filter(id => id.startsWith("publication."))).toEqual(["publication.site.meta", "publication.docs.meta", "publication.app.meta", "publication.admin.meta", "publication.slides.meta"]);
    expect(leaves).not.toContain("page.company-one-pager.meta");
    for (const [id, page] of livePages) expect(page.records!.meta).toBe(`writer/${id}.meta#${id.slice("page.".length)}.meta`);
  });

  it("each slot is a starter Copy slot with its record, placement, fields digest and the Voice and Director inputs", () => {
    const home = committed.slots.find((slot: { id: string }) => slot.id === "page.home.meta");
    expect(home).toMatchObject({ kind: "copy", mark: "starter", contract: { unit: "publisher/page.home", records: { "home.meta": { placement: "publisher/page.home#meta" } }, candidate: "clossys.copy-candidate/1" } });
    expect(home.contract.copy.fields.map((field: { key: string }) => field.key)).toEqual(["title", "description", "share.title", "share.description"]);
    expect(home.contract.fieldsSha256).toMatch(/^[0-9a-f]{64}$/);
    const site = committed.slots.find((slot: { id: string }) => slot.id === "publication.site.meta");
    expect(site.contract.copy.fields.map((field: { key: string }) => field.key)).toEqual(["siteName", "share.title", "share.description"]);
    expect(home.inputs.filter((ref: { to: string }) => ref.to.startsWith("writer/lexicon.")).length).toBe(12);
  });

  it("each page.<id>.meta names its own publication's meta as an input, so site and app pages differ", () => {
    const tree = deriveCopyTree(input);
    const inputsOf = (id: string) => tree.slots.find(slot => slot.id === id)!.inputs.map(ref => ref.to);
    expect(input.directory.slots["page.not-found"]!.publication).toBe("site");
    expect(input.directory.slots["page.app-not-found"]!.publication).toBe("app");
    expect(inputsOf("page.not-found.meta")).toContain("writer/publication.site.meta");
    expect(inputsOf("page.app-not-found.meta")).toContain("writer/publication.app.meta");
    expect(inputsOf("page.not-found.meta")).not.toEqual(inputsOf("page.app-not-found.meta"));
    for (const [id, page] of livePages) expect(inputsOf(`${id}.meta`).filter(to => to.startsWith("writer/publication."))).toEqual([`writer/publication.${page.publication}.meta`]);
  });

  it("mutation: a live Publisher page with no Page metadata slot fails", () => {
    const tree = clone(committed);
    tree.slots = tree.slots.filter((slot: { id: string }) => slot.id !== "page.pricing.meta");
    expect(messages(tree)).toContain("page.pricing.meta");
  });

  it("mutation: a Page metadata slot for a parked page fails", () => {
    const next = clone(input);
    next.directory.slots["page.about"]!.parked = true;
    expect(messages(committed, next)).toContain("page.about.meta is a Page metadata slot with no live Publisher page");
  });

  it("mutation: a Publisher meta ref that is not writer/page.<id>.meta#<id>.meta fails", () => {
    const next = clone(input);
    next.directory.slots["page.home"]!.records!.meta = "writer/strings.page-titles#home.title";
    expect(messages(committed, next)).toContain("does not name a writer/page.<id>.meta record");
  });
});

describe("Record labels are a declared Copy leaf Writer owns (CP1-WREC)", () => {
  // The flat field set from the CP1-G34 receipt: column heads, headings, detail labels, empty text, slot and candidate status names.
  const KEYS = [
    "slot", "kind", "status", "group", "name", "version", "rung", "source", "created-by", "specimen",
    "gallery-heading", "contract", "pin-heading", "candidates-heading",
    "purpose", "standard", "inputs", "uses", "rules", "none", "pin-candidate", "pin-decided-by", "pin-at", "pin-none", "pinned", "no-specimen",
    "gallery-empty", "candidates-empty",
    "status-starter", "status-live", "status-parked", "status-retired", "status-needs-refresh",
    "status-draft", "status-submitted",
  ];
  const ID = "sections.records.copy";
  const recordsL2 = (tree: { nodes: { id: string; children: { id: string; leaves: string[] }[] }[] }) =>
    tree.nodes.find(l1 => l1.id === "copy/section-copy")!.children.find(l2 => l2.id === "copy/section-copy/records")!;

  it("(a) derives sections.records.copy in Section copy / Records with every declared field", () => {
    expect(RECORD_LABEL_LEAVES.map(leaf => leaf.id)).toEqual([ID]);
    const tree = deriveCopyTree(input);
    const slot = tree.slots.find(entry => entry.id === ID)!;
    expect(slot).toMatchObject({ kind: "copy", mark: "starter", contract: { unit: "producer/admin-records", copy: { sourceLocale: "en" }, candidate: "clossys.copy-candidate/1" } });
    const fields = (slot.contract as { copy: { fields: { key: string; kind: string; required: boolean }[] } }).copy.fields;
    expect(fields.map(field => field.key)).toEqual(KEYS);
    expect(fields.every(field => field.kind === "plain" && field.required)).toBe(true);
    expect(slot.contract!.fieldsSha256).toBe(fieldsSha256(RECORD_LABEL_LEAVES[0]!.fields));
    expect(recordsL2(tree).leaves.filter(id => id === ID)).toHaveLength(1);
    expect(COPY_TARGET_UNITS).not.toContain("sections.records");
    expect(input.slots.some(entry => entry.id === "sections.records")).toBe(false);
    expect(checkCopyAgainstDesigner(committed, input)).toEqual([]);
  });

  it("(b) an undeclared non-Designer copy leaf is still refused, with the same Designer findings", () => {
    const tree = clone(committed);
    const slot = clone(tree.slots.find((entry: { id: string }) => entry.id === ID));
    slot.id = "sections.labels.copy";
    tree.slots.push(slot);
    recordsL2(tree).leaves.push("sections.labels.copy");
    expect(checkCopyAgainstDesigner(tree, input).map(finding => finding.message).filter(message => message.includes("sections.labels.copy"))).toEqual([
      "COPY: sections.labels.copy names unit designer/producer/admin-records; the slot id must be <unit>.copy",
      "COPY: sections.labels.copy is a Copy slot with no Designer copy field (designer/producer/admin-records)",
    ]);
  });

  it("(c) a declared leaf missing from the derive output is a finding", () => {
    const tree = clone(committed);
    tree.slots = tree.slots.filter((entry: { id: string }) => entry.id !== ID);
    const l2 = recordsL2(tree);
    l2.leaves = l2.leaves.filter(id => id !== ID);
    expect(messages(tree)).toContain(`COPY: ${ID} is a declared record-label leaf (record-label-fields.json) with 0 Copy slots`);
    const extra = { ...clone(RECORD_LABEL_LEAVES[0]!), id: "sections.more-records.copy" };
    expect(checkRecordLabels(committed, [...RECORD_LABEL_LEAVES, extra]).map(finding => finding.message)).toEqual([
      "COPY: sections.more-records.copy is a declared record-label leaf (record-label-fields.json) with 0 Copy slots",
    ]);
  });

  it("mutation: a declared leaf with the wrong unit, stale fields or the wrong L2 fails", () => {
    const unit = clone(committed);
    unit.slots.find((entry: { id: string }) => entry.id === ID).contract.unit = "producer/other";
    expect(messages(unit)).toContain(`COPY: ${ID} names unit producer/other; record-label-fields.json declares producer/admin-records`);
    const stale = clone(committed);
    stale.slots.find((entry: { id: string }) => entry.id === ID).contract.copy.fields.pop();
    expect(messages(stale)).toContain(`COPY: ${ID} is stale against record-label-fields.json; run the Copy derive`);
    const moved = clone(committed);
    recordsL2(moved).leaves = recordsL2(moved).leaves.filter(id => id !== ID);
    moved.nodes.find((l1: { id: string }) => l1.id === "copy/section-copy").children[0].leaves.push(ID);
    expect(messages(moved)).toContain(`COPY: ${ID} is placed in copy/section-copy/parts; record-label-fields.json places it in copy/section-copy/records`);
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

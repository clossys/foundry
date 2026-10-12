import { describe, expect, it } from "vitest";
import * as contract from "./sectioned-view.js";
import type { SectionedViewDocument } from "./sectioned-view.js";
const ref = (id = "copy") => ({ id });
const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, heading: ref(`heading-${index}`) }));
const document = (fields: Record<string, unknown>): SectionedViewDocument => ({ id: "page", sections: [{ id: "band", kind: "content-section", ground: "base", heading: ref(), ...fields }] }) as SectionedViewDocument;
const findings = (block: unknown) => contract.validateSectionedViewDocument(document({ block }));
const errors = (block: unknown) => findings(block).filter((entry) => entry.severity === "error");
const resolver = (value: { id: string }) => ({ ref: value, text: value.id === "specimen-label" ? "A sample panel showing its labeled parts" : value.id === "scene-label" ? "A clear sample showing how source documents connect to the resolved result for this section" : value.id, recordId: "fixture", revision: "1", locale: "en", source: { kind: "consumer" as const, reference: "fixture" }, entryId: value.id });


const part = { id: "field-part", type: "fields", label: ref(), items: [{ id: "field", label: ref(), value: ref() }] };
const panel = { id: "panel", title: ref(), meta: ref(), badge: { label: ref("Beta"), tone: "info" }, parts: [part] };
const mediaErrors = (media: unknown, fields: Record<string, unknown> = {}) => contract.validateSectionedViewDocument(document({ media, ...fields })).filter((entry) => entry.severity === "error");
const sceneInput = { template: "converge", seed: "stable", sources: { heading: ref(), items: ["a", "b", "c"].map((id) => ({ id, format: "pdf", title: ref(), origin: ref() })) }, target: { heading: ref(), title: ref(), meta: ref(), rows: ["one", "two"].map((id) => ({ id, label: ref(), value: ref() })) }, relations: ["a", "b", "c"].map((from) => ({ from, to: "one" })) };
describe("canonical media data and CopyRef boundary", () => {
  it("accepts one specimen panel and a key targeting its actual parts/header/footer", () => {
    const media = { type: "specimen", label: ref("specimen-label"), panel: { ...panel, footer: { note: ref() } }, key: { label: ref(), items: ["header", "field-part", "footer"].map((target) => ({ id: target, target, heading: ref(), description: ref() })) } };
    expect(mediaErrors(media)).toEqual([]);
    expect(contract.resolveSectionedViewDocument(document({ media }), resolver).resolutions.map((entry) => entry.ref.id)).toContain("Beta");
    expect(mediaErrors({ ...media, key: { ...media.key, items: [{ id: "marker", target: "foreign", heading: ref(), description: ref() }] } }).length).toBeGreaterThan(0);
    expect(mediaErrors({ type: "specimen", label: ref("specimen-label"), arrangement: "single", panels: [panel] }).length).toBeGreaterThan(0);
  });
  it("holds specimen keys to three-to-five labeled targets in panel reading order", () => {
    const keyed = { type: "specimen", label: ref("specimen-label"), panel: { ...panel, footer: { note: ref() } }, key: { label: ref(), items: ["header", "field-part", "footer"].map((target) => ({ id: target, target, heading: ref(), description: ref() })) } };
    for (const count of [1, 2]) expect(mediaErrors({ ...keyed, key: { ...keyed.key, items: keyed.key.items.slice(0, count) } }).length).toBeGreaterThan(0);
    expect(mediaErrors({ ...keyed, key: { ...keyed.key, items: [...keyed.key.items].reverse() } }).length).toBeGreaterThan(0);
    const { label: _label, ...unlabeled } = part;
    expect(mediaErrors({ ...keyed, panel: { ...keyed.panel, parts: [unlabeled] } }).length).toBeGreaterThan(0);
    expect(mediaErrors({ ...keyed, key: { ...keyed.key, items: keyed.key.items.map((item, index) => index === 0 ? { ...item, id: "bad id" } : item) } }).length).toBeGreaterThan(0);
  });
  it("refuses whitespace in record instance, group and row ids", () => {
    const record = { type: "record", id: "record", head: { title: ref() }, caption: ref(), groups: [{ id: "group", label: ref(), rows: [{ id: "row", label: ref() }] }] };
    for (const media of [{ ...record, id: "bad id" }, { ...record, groups: [{ ...record.groups[0], id: "bad id" }] }, { ...record, groups: [{ ...record.groups[0], rows: [{ id: "bad id", label: ref() }] }] }]) expect(mediaErrors(media).length).toBeGreaterThan(0);
  });
  it("refuses undefined required Scene formats and tones without narrowing optional omissions", () => {
    const converge = { type: "scene", label: ref("scene-label"), input: sceneInput };
    expect(mediaErrors(converge)).toEqual([]);
    for (const format of [undefined, "unknown"]) expect(mediaErrors({ ...converge, input: { ...sceneInput, sources: { ...sceneInput.sources, items: sceneInput.sources.items.map((source, index) => index === 0 ? { ...source, format } : source) } } }).length).toBeGreaterThan(0);
    const evidence = { template: "evidence-trail", seed: "stable", sources: ["a", "b"].map((id) => ({ id, format: "pdf", title: ref(), cites: "one", cite: ref() })), result: { title: ref(), rows: ["one", "two"].map((id) => ({ id, label: ref(), value: ref() })), status: { tone: undefined, text: ref() } } };
    expect(mediaErrors({ type: "scene", label: ref("scene-label"), input: evidence }).length).toBeGreaterThan(0);
  });
  it("keeps prior meter fields, resolves previousText and restricts mobileRows to three", () => {
    const meter = { id: "meter", type: "meter", label: ref(), value: 40, scaleMax: 100, limit: 80, tone: "info", valueText: ref(), previous: 30, previousText: ref("Earlier") };
    expect(mediaErrors({ type: "specimen", label: ref("specimen-label"), panel: { ...panel, parts: [meter] } })).toEqual([]);
    expect(contract.resolveSectionedViewDocument(document({ media: { type: "specimen", label: ref("specimen-label"), panel: { ...panel, parts: [meter] } } }), resolver).resolutions.map((entry) => entry.ref.id)).toContain("Earlier");
    for (const previous of [-1, Infinity, NaN]) expect(mediaErrors({ type: "specimen", label: ref("specimen-label"), panel: { ...panel, parts: [{ ...meter, previous }] } }).length).toBeGreaterThan(0);
    for (const changed of [{ ...meter, previous: undefined }, { ...meter, previousText: undefined }, { ...meter, previousText: "raw" }]) expect(mediaErrors({ type: "specimen", label: ref("specimen-label"), panel: { ...panel, parts: [changed] } }).length).toBeGreaterThan(0);
    const { previous: _previous, previousText: _previousText, ...withoutPrevious } = meter;
    expect(mediaErrors({ type: "specimen", label: ref("specimen-label"), panel: { ...panel, parts: [withoutPrevious] } })).toEqual([]);
    const rows = { id: "rows", type: "status-rows", mobileRows: 3, items: [{ id: "row", label: ref(), status: { tone: "success", label: ref() } }] };
    expect(mediaErrors({ type: "specimen", label: ref("specimen-label"), panel: { ...panel, parts: [rows] } })).toEqual([]);
    expect(mediaErrors({ type: "specimen", label: ref("specimen-label"), panel: { ...panel, parts: [{ ...rows, mobileRows: 2 }] } }).length).toBeGreaterThan(0);
  });
  it("accepts record ledger CopyRefs and refuses raw ReactNode/text, invalid owner ordering and flags", () => {
    const media = { type: "record", id: "record", head: { title: ref(), meta: ref(), status: { tone: "success", label: ref() } }, columns: 2, caption: ref(), flagLabel: ref(), groups: [{ id: "rows", label: ref(), rows: [{ id: "row", label: ref(), detail: ref(), flag: true }] }, { id: "owner", label: ref(), owner: { initials: ref("AB"), name: ref(), note: ref() }, note: ref() }] };
    expect(mediaErrors(media)).toEqual([]);
    expect(contract.resolveSectionedViewDocument(document({ media }), resolver).resolutions.length).toBeGreaterThan(8);
    for (const changed of [{ ...media, head: { title: "raw" } }, { ...media, groups: [...media.groups].reverse() }, { ...media, flagLabel: undefined }, { ...media, columns: 3 }, { ...media, groups: [{ ...media.groups[0], owner: media.groups[1]?.owner }, media.groups[1]] }]) expect(mediaErrors(changed).length).toBeGreaterThan(0);
  });
  it("validates converge CopyRefs, declared relations and intrinsic split width", () => {
    const media = { type: "scene", label: ref("scene-label"), relationLabel: ref(), input: sceneInput };
    expect(mediaErrors(media)).toEqual([]);
    const resolved = contract.resolveSectionedViewDocument(document({ media }), resolver);
    expect(resolved.resolutions.map((entry) => entry.ref.id)).toContain("scene-label");
    for (const input of [{ ...sceneInput, sources: { ...sceneInput.sources, heading: "raw" } }, { ...sceneInput, relations: [{ from: "a", to: "foreign" }] }, { ...sceneInput, relations: [] }, { ...sceneInput, template: "unknown" }, { ...sceneInput, sample: true }]) expect(mediaErrors({ ...media, input }).length).toBeGreaterThan(0);
    expect(mediaErrors(media, { layout: "split-start" }).some((entry) => entry.rule === "sectioned-view-scene-slot-width")).toBe(true);
    expect(() => contract.resolveSectionedViewDocument(document({ media: { ...media, label: ref("short") } }), resolver)).toThrow(/label-length/);
  });
  it("accepts evidence and approval inputs with all visible strings resolved", () => {
    const rows = [{ id: "one", label: ref(), value: ref() }, { id: "two", label: ref(), value: ref() }];
    const status = { tone: "success", text: ref() }; const person = { initials: "AB", name: ref(), note: ref() };
    const evidence = { template: "evidence-trail", seed: "stable", sources: ["a", "b"].map((id) => ({ id, format: "doc", title: ref(), origin: ref(), cites: "one", cite: ref() })), result: { title: ref(), meta: ref(), rows, status, person } };
    const approval = { template: "approval-chain", seed: "stable", prepared: { heading: ref(), meta: ref() }, findings: ["a", "b"].map((id, index) => ({ id, fn: ref(), title: ref(), subjectOf: ref(), status, ...(index === 0 ? { subject: true } : {}) })), node: { label: ref() }, decision: { title: ref(), meta: ref(), rows, status, person } };
    for (const input of [evidence, approval]) {
      const media = { type: "scene", label: ref("scene-label"), input };
      expect(mediaErrors(media)).toEqual([]);
      const resolved = contract.resolveSectionedViewDocument(document({ media }), resolver);
      const refs: string[] = [];
      const collect = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(collect); return; }
        if (value !== null && typeof value === "object") {
          if (Object.keys(value).length === 1 && "id" in value) refs.push(String(value.id));
          else Object.values(value).forEach(collect);
        }
      };
      collect(media);
      expect(resolved.resolutions.map((entry) => entry.ref.id)).toEqual(["copy", ...refs]);
      expect(JSON.stringify(resolved.sections[0])).not.toContain('"id":"copy"');
    }
    expect(mediaErrors({ type: "scene", label: ref("scene-label"), input: { ...evidence, sources: evidence.sources.map((source) => ({ ...source, cites: "foreign" })) } }).length).toBeGreaterThan(0);
    expect(mediaErrors({ type: "scene", label: ref("scene-label"), input: { ...approval, findings: approval.findings.map((entry) => ({ ...entry, subject: true })) } }).length).toBeGreaterThan(0);
    expect(mediaErrors({ type: "scene", label: ref("scene-label"), input: { ...approval, decision: { ...approval.decision, person: { ...person, initials: "ABC" } } } }).length).toBeGreaterThan(0);
  });
  it("holds Scene count extrema, closed nested fields, unique ids and resolved text budgets", () => {
    const media = { type: "scene", label: ref("scene-label"), input: sceneInput };
    for (const count of [3, 8]) {
      const sources = Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, format: "pdf", title: ref("title") }));
      expect(mediaErrors({ ...media, input: { ...sceneInput, sources: { heading: ref(), items: sources }, relations: sources.map((source) => ({ from: source.id, to: "one" })) } })).toEqual([]);
    }
    for (const count of [2, 9]) expect(mediaErrors({ ...media, input: { ...sceneInput, sources: { ...sceneInput.sources, items: Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, format: "pdf", title: ref() })) } } }).length).toBeGreaterThan(0);
    for (const input of [{ ...sceneInput, target: { ...sceneInput.target, style: {} } }, { ...sceneInput, target: { ...sceneInput.target, rows: [sceneInput.target.rows[0], sceneInput.target.rows[0]] } }, { ...sceneInput, sources: { ...sceneInput.sources, items: [sceneInput.sources.items[0], sceneInput.sources.items[0], sceneInput.sources.items[2]] } }]) expect(mediaErrors({ ...media, input }).length).toBeGreaterThan(0);
    const titled = { ...media, input: { ...sceneInput, target: { ...sceneInput.target, title: ref("bounded-title") } } };
    const withTitle = (count: number) => (value: { id: string }) => ({ ...resolver(value), text: value.id === "bounded-title" ? "x".repeat(count) : resolver(value).text });
    expect(() => contract.resolveSectionedViewDocument(document({ media: titled }), withTitle(28))).not.toThrow();
    expect(() => contract.resolveSectionedViewDocument(document({ media: titled }), withTitle(29))).toThrow(/scene-text-length/);
  });
  it("does not invoke rejected media input accessors in split-width inspection", () => {
    const media = { type: "scene", label: ref("scene-label") }; let reads = 0;
    Object.defineProperty(media, "input", { enumerable: true, get() { reads++; throw new Error("malicious input accessor"); } });
    expect(() => mediaErrors(media, { layout: "split-start" })).not.toThrow();
    expect(reads).toBe(0); expect(mediaErrors(media, { layout: "split-start" }).length).toBeGreaterThan(0);
  });
  it("does not coerce invalid Scene templates during split-width inspection", () => {
    let calls = 0;
    const template = { toString() { calls++; throw new Error("malicious template coercion"); } };
    const media = { type: "scene", label: ref("scene-label"), input: { ...sceneInput, template } };
    expect(() => mediaErrors(media, { layout: "split-end" })).not.toThrow();
    expect(mediaErrors(media, { layout: "split-end" }).length).toBeGreaterThan(0); expect(calls).toBe(0);
  });
  it("does not inspect rejected block lane accessors in split placement", () => {
    let calls = 0;
    const block = { type: "items", arrangement: "rows", items: items(2) };
    Object.defineProperty(block, "lanes", { enumerable: true, get() { calls++; throw new Error("malicious lanes accessor"); } });
    expect(() => contract.validateSectionedViewDocument(document({ block, layout: "split-end" }))).not.toThrow();
    expect(contract.validateSectionedViewDocument(document({ block, layout: "split-end" })).length).toBeGreaterThan(0); expect(calls).toBe(0);
  });
  it("accepts a short plain specimen label while refusing a short keyed figure label", () => {
    const plain = { type: "specimen", label: ref("short"), panel: { ...panel, footer: { note: ref() } } };
    expect(() => contract.resolveSectionedViewDocument(document({ media: plain }), resolver)).not.toThrow();
    const keyed = { ...plain, key: { label: ref(), items: ["header", "field-part", "footer"].map((target) => ({ id: target, target, heading: ref(), description: ref() })) } };
    expect(() => contract.resolveSectionedViewDocument(document({ media: keyed }), resolver)).toThrow(/label-length/);
  });
  it("retains record text budgets and limits multi-column records to stacked frames", () => {
    const record = { type: "record", id: "record", head: { title: ref() }, columns: 2, caption: ref("caption"), groups: [{ id: "rows", label: ref("group-label"), rows: [{ id: "row", label: ref("row-label"), detail: ref("row-detail"), status: { tone: "success", label: ref("row-status") } }] }, { id: "owner", label: ref(), owner: { initials: ref("AB"), name: ref() }, note: ref("group-note") }] };
    expect(mediaErrors(record, { layout: "split-end" }).length).toBeGreaterThan(0);
    expect(mediaErrors({ ...record, columns: 1 }, { layout: "split-start" })).toEqual([]);
    for (const [id, max] of [["group-label", 24], ["row-label", 40], ["row-detail", 48], ["row-status", 20], ["group-note", 80], ["caption", 120]] as const) {
      const copy = (count: number) => (value: { id: string }) => ({ ...resolver(value), text: value.id === id ? "x".repeat(count) : resolver(value).text });
      expect(() => contract.resolveSectionedViewDocument(document({ media: record }), copy(max))).not.toThrow();
      expect(() => contract.resolveSectionedViewDocument(document({ media: record }), copy(max + 1))).toThrow(/record-text-length/);
    }
  });
  it("retains keyed specimen text and accessible figure label budgets", () => {
    const keyed = { type: "specimen", label: ref("specimen-label"), panel: { ...panel, footer: { note: ref() } }, key: { label: ref(), items: ["header", "field-part", "footer"].map((target) => ({ id: target, target, heading: ref("key-heading"), description: ref("key-description") })) } };
    for (const [id, max] of [["key-heading", 40], ["key-description", 140]] as const) {
      const copy = (count: number) => (value: { id: string }) => ({ ...resolver(value), text: value.id === id ? "x".repeat(count) : resolver(value).text });
      expect(() => contract.resolveSectionedViewDocument(document({ media: keyed }), copy(max))).not.toThrow();
      expect(() => contract.resolveSectionedViewDocument(document({ media: keyed }), copy(max + 1))).toThrow(/specimen-key-text-length/);
    }
    for (const count of [5, 26]) expect(() => contract.resolveSectionedViewDocument(document({ media: keyed }), (value) => ({ ...resolver(value), text: value.id === "specimen-label" ? Array(count).fill("word").join(" ") : resolver(value).text }))).toThrow(/label-length/);
  });
  it.each([0, 1, 2])("refuses Scene and Record accessor array elements before invoking them (%i)", (index) => {
    const fixtures = [
      { type: "scene", label: ref("scene-label"), input: { ...sceneInput, sources: { ...sceneInput.sources, items: [...sceneInput.sources.items] } } },
      { type: "scene", label: ref("scene-label"), input: { ...sceneInput, relations: [...sceneInput.relations] } },
      { type: "record", id: "record", head: { title: ref() }, caption: ref(), groups: [{ id: "group", label: ref(), rows: [{ id: "row", label: ref() }] }] },
    ];
    const media = fixtures[index]!;
    {
      const target = index === 0 ? media.input!.sources!.items : index === 1 ? media.input!.relations : media.groups;
      let reads = 0;
      Object.defineProperty(target, "0", { enumerable: true, get() { reads++; throw new Error("malicious array element"); } });
      expect(() => mediaErrors(media)).not.toThrow();
      expect(mediaErrors(media).length).toBeGreaterThan(0); expect(reads).toBe(0);
    }
  });
  it("accepts ordinary arrays and refuses sparse, non-enumerable, extra and symbolic array slots", () => {
    const valid = { type: "scene", label: ref("scene-label"), input: sceneInput };
    expect(mediaErrors(valid)).toEqual([]);
    expect(mediaErrors({ ...valid, input: { ...sceneInput, sources: { ...sceneInput.sources, items: Object.freeze([...sceneInput.sources.items]) } } })).toEqual([]);
    const variants = [
      () => { const value = [...sceneInput.sources.items]; delete value[0]; return value; },
      () => { const value = [...sceneInput.sources.items]; Object.defineProperty(value, "0", { value: value[0], enumerable: false }); return value; },
      () => { const value = [...sceneInput.sources.items]; Object.defineProperty(value, "extra", { value: true, enumerable: true }); return value; },
      () => { const value = [...sceneInput.sources.items]; Object.defineProperty(value, Symbol("extra"), { value: true }); return value; },
    ];
    for (const variant of variants) expect(mediaErrors({ ...valid, input: { ...sceneInput, sources: { ...sceneInput.sources, items: variant() } } }).length).toBeGreaterThan(0);
  });
  it.each(["forEach", "map", Symbol.iterator])("refuses own traversal accessors on media arrays (%s)", (key) => {
    const relations = [...sceneInput.relations]; let calls = 0;
    Object.defineProperty(relations, key, { get() { calls++; throw new Error("malicious traversal accessor"); } });
    const media = { type: "scene", label: ref("scene-label"), input: { ...sceneInput, relations } };
    expect(() => mediaErrors(media)).not.toThrow(); expect(mediaErrors(media).length).toBeGreaterThan(0); expect(calls).toBe(0);
  });
  it.each(["custom", "subclass"])("refuses %s media array prototypes before inherited traversal accessors", (kind) => {
    let calls = 0;
    const prototype = Object.create(Array.prototype, { forEach: { get() { calls++; throw new Error("malicious inherited traversal"); } } });
    const relations = kind === "custom" ? [...sceneInput.relations] : new (class extends Array {}) (...sceneInput.relations);
    if (kind === "custom") Object.setPrototypeOf(relations, prototype);
    else Object.defineProperty(Object.getPrototypeOf(relations), "forEach", { get() { calls++; throw new Error("malicious subclass traversal"); } });
    const media = { type: "scene", label: ref("scene-label"), input: { ...sceneInput, relations } };
    expect(() => mediaErrors(media)).not.toThrow(); expect(mediaErrors(media).length).toBeGreaterThan(0); expect(calls).toBe(0);
  });
  it("refuses keyed specimen part accessors before key target traversal", () => {
    const parts = [part]; let calls = 0;
    Object.defineProperty(parts, "0", { enumerable: true, get() { calls++; throw new Error("malicious keyed part"); } });
    const media = { type: "specimen", label: ref("specimen-label"), panel: { ...panel, parts, footer: { note: ref() } }, key: { label: ref(), items: ["header", "field-part", "footer"].map((target) => ({ id: target, target, heading: ref(), description: ref() })) } };
    expect(() => mediaErrors(media)).not.toThrow(); expect(mediaErrors(media).length).toBeGreaterThan(0); expect(calls).toBe(0);
  });
  it("refuses malformed structural ids and relation endpoints without coercion or serialization", () => {
    let calls = 0;
    const id = { toString() { calls++; throw new Error("malicious id coercion"); }, toJSON() { calls++; throw new Error("malicious endpoint serialization"); } };
    const record = { type: "record", id: "record", head: { title: ref() }, caption: ref(), groups: [{ id: "group", label: ref(), rows: [{ id: "row", label: ref() }] }] };
    const keyed = { type: "specimen", label: ref("specimen-label"), panel: { ...panel, footer: { note: ref() } }, key: { label: ref(), items: ["header", "field-part", "footer"].map((target) => ({ id: target, target, heading: ref(), description: ref() })) } };
    const invalid = [
      { ...record, id },
      { ...record, groups: [{ ...record.groups[0], id }] },
      { ...record, groups: [{ ...record.groups[0], rows: [{ id, label: ref() }] }] },
      { ...keyed, key: { ...keyed.key, items: [{ ...keyed.key.items[0], id }, ...keyed.key.items.slice(1)] } },
      { type: "scene", label: ref("scene-label"), input: { ...sceneInput, relations: [{ from: id, to: "one" }] } },
      { type: "scene", label: ref("scene-label"), input: { ...sceneInput, relations: [{ from: "a", to: id }] } },
    ];
    for (const media of invalid) { expect(() => mediaErrors(media)).not.toThrow(); expect(mediaErrors(media).length).toBeGreaterThan(0); }
    expect(calls).toBe(0);
  });
  it("rejects accessor, symbol and sparse canonical data before reading it", () => {
    const block = { type: "items", arrangement: "rows", items: items(2) }; let reads = 0;
    Object.defineProperty(block.items[0], "badge", { enumerable: true, get() { reads++; throw new Error("getter"); } });
    expect(() => errors(block)).not.toThrow(); expect(errors(block).length).toBeGreaterThan(0); expect(reads).toBe(0);
    expect(errors({ type: "items", arrangement: "rows", items: [items(2)[0], , items(2)[1]] }).length).toBeGreaterThan(0);
  });
});

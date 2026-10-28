import { describe, expect, it } from "vitest";
import { isCopyField, type CopyField } from "./section-copy.js";
import { loadSectionRegistry, sectionCopyCatalog, sectionRegistryFindings } from "./sections-contract.js";

const registryWith = (patch: (contract: any) => void, id = "sections.hero") => {
  const registry = loadSectionRegistry();
  patch(registry.slots.find(slot => slot.id === id)!.contract);
  return registry;
};
const findings = (patch: (contract: any) => void, id?: string) => sectionRegistryFindings(registryWith(patch, id));

describe("registered section copy", () => {
  it("lists every registered section and its unique mechanically paired passage through the public catalog API", () => {
    const registry = loadSectionRegistry(), rows = sectionCopyCatalog(registry);
    expect(rows).toHaveLength(46);
    expect(rows.map(row => row.id)).toEqual(registry.slots.map(slot => slot.id));
    expect(new Set(rows.map(row => row.passageSchema)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.passageSchema).toBe(`passages.${row.id.slice(9)}`);
      expect(row.sourceLocale).toBe("en");
      expect(row.status).toBe("draft");
      for (const field of row.fields) {
        expect(Object.keys(field).sort()).toEqual(["dir", "key", "kind", "maxLength", "required"]);
        expect(field.maxLength.en).toBeGreaterThan(0);
        expect(field.dir).toBe("auto");
      }
    }
    expect(rows.filter(row => !row.fields.length).map(row => row.id)).toEqual(["sections.band"]);
    expect(rows.find(row => row.id === "sections.logo-hero")!.fields.map(field => field.key)).toEqual(["name"]);
    (rows[0]!.fields as unknown[]).pop();
    expect(sectionCopyCatalog()[0]!.fields).toEqual(registry.slots[0]!.contract.copy.fields);
  });

  it("registers item copy and every declared state's messages, excluding selection identifiers", () => {
    const registry = loadSectionRegistry();
    for (const slot of registry.slots) for (const state of slot.contract.states ?? []) {
      expect(slot.contract.copy.fields.map(field => field.key)).toContain(`states.${state}.label`);
      expect(slot.contract.copy.fields.map(field => field.key)).toContain(`states.${state}.description`);
    }
    for (const [id, key] of [["features", "items[].heading"], ["people", "people[].name"], ["pricing", "plans[].features[]"], ["data-table", "columns[].label"], ["settings", "groups[].controls[].label"], ["activity-feed", "events[].actor.name"], ["cards", "records[].badge.label"], ["pricing", "plans[].priceByInterval[].priceText"]]) {
      expect(registry.slots.find(slot => slot.id === `sections.${id}`)!.contract.copy.fields.map(field => field.key)).toContain(key);
    }
    const toc = registry.slots.find(slot => slot.id === "sections.table-of-contents")!;
    expect(toc.contract.slots.find(row => row.name === "active-id")!.type).toBe("records");
    expect(toc.contract.copy.fields.map(field => field.key)).not.toContain("active-id");
  });

  it("refuses missing schemas, foreign passages and unregistered field roots", () => {
    expect(findings(contract => { delete contract.copy; }).join()).toContain("requires sourceLocale and fields");
    expect(findings(contract => { delete contract.passageSchema; }).join()).toContain("passageSchema must pair");
    expect(findings(contract => { contract.passageSchema = "passages.other"; }).join()).toContain("passageSchema must pair");
    expect(findings(contract => { contract.copy.fields[0].key = "unknown.heading"; }).join()).toContain("undeclared content root");
    expect(findings(contract => { contract.copy.fields.push(contract.copy.fields[0]); }).join()).toContain("duplicate field");
  });

  it.each([
    ["kind", "html", "invalid kind"], ["dir", "vertical", "invalid dir"], ["required", "yes", "boolean required"],
    ["key", "items.*.label", "invalid field key"], ["maxLength", {}, "per-locale maxLength"],
    ["maxLength", { en: 0 }, "per-locale maxLength"], ["maxLength", { en: 1.5 }, "per-locale maxLength"],
    ["maxLength", { en: 120, bad_locale: 120 }, "per-locale maxLength"],
  ])("refuses malformed %s", (key, value, message) => {
    expect(findings(contract => { contract.copy.fields[0][key as string] = value; }).join()).toContain(message);
  });

  it("requires source-locale limits, permits separately declared locale limits and directions, and closes the field shape", () => {
    expect(findings(contract => { contract.copy.sourceLocale = "fr"; }).join()).toContain("including sourceLocale");
    expect(findings(contract => { contract.copy.sourceLocale = "not_a_locale"; }).join()).toContain("requires sourceLocale and fields");
    expect(findings(contract => { contract.copy.fields[0].maxLength.ar = 180; contract.copy.fields[0].dir = "rtl"; })).toEqual([]);
    expect(findings(contract => { contract.copy.fields[0].dir = "ltr"; })).toEqual([]);
    expect(findings(contract => { contract.copy.fields[0].unregistered = true; }).join()).toContain("and dir only");
    expect(findings(contract => { contract.copy.fields = []; }, "sections.logo-hero").join()).toContain("missing copy slot name");
  });

  it("refuses missing state copy and copy for undeclared states", () => {
    expect(findings(contract => { contract.copy.fields = contract.copy.fields.filter((field: { key: string }) => !field.key.startsWith("states.empty.")); }, "sections.cards").join()).toContain("missing empty state copy");
    expect(findings(contract => { contract.copy.fields[0].key = "states.empty.label"; }).join()).toContain("undeclared state");
  });
});

describe("shared handwritten copy bridge", () => {
  const field: CopyField = { key: "header.heading", locale: "en", value: "Example", source: "handwritten" };
  it("accepts only the shared key, locale, value and handwritten source grammar", () => {
    expect(isCopyField(field)).toBe(true);
    for (const value of [null, [], { ...field, source: "writer" }, { ...field, source: "generated" }, { ...field, locale: "bad_locale" }, { ...field, value: 3 }, { ...field, ref: { id: "text" } }, { field: "heading", text: "Example", locale: "en", source: "handwritten" }]) expect(isCopyField(value)).toBe(false);
    for (const key of Object.keys(field)) { const copy: any = { ...field }; delete copy[key]; expect(isCopyField(copy)).toBe(false); }
  });
});

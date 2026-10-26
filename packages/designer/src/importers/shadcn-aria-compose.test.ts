// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import slots from "../catalog/slots/components.json" with { type: "json" };
import datePickerRule from "../catalog/rules/components.date-picker.json" with { type: "json" };
import composedFileTrigger from "../catalog/fills/shadcn@aria/components.file-trigger.json" with { type: "json" };
import { loadComponentCompositionRules } from "../catalog-core/component-compositions.js";
import { validateComponentRuleTemplate } from "../catalog-core/component-rule-validation.js";
import { stableStringify } from "../catalog-core/stable.js";
import { importShadcnAriaComponents, resolveShadcnComposeRules, SHADCN_COMPOSE_ITEMS, SHADCN_COMPOSE_MAX_DEPTH, SHADCN_COMPOSE_RULES, type ShadcnComposeRule } from "./shadcn-aria-components.js";

const here = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string): string => readFileSync(resolve(here, name), "utf8");
const pinnedInput = () => ({ items: readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
  styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } });
const registered = new Set((slots as readonly { id: string }[]).map(slot => slot.id));
const shadcn = (...leaves: string[]) => new Map(leaves.map(leaf => [`components.${leaf}`, "shadcn@aria"]));

describe("shadcn@aria compose rules", () => {
  const result = importShadcnAriaComponents(pinnedInput());
  const fills = new Map(result.fills.map(doc => [doc.$extensions["com.clossys.fill"].slot, doc.$extensions["com.clossys.fill"].source]));

  it("resolves every rule over registered constituents, one level deep, with a source only when every constituent carries it", () => {
    expect(result.compose.map(row => row.leaf)).toEqual(SHADCN_COMPOSE_RULES.map(rule => rule.leaf));
    for (const row of result.compose) {
      expect(registered.has(row.slot), row.slot).toBe(true);
      for (const constituent of row.constituents) expect(registered.has(`components.${constituent}`), `${row.leaf}<-${constituent}`).toBe(true);
      expect(row.depth, row.leaf).toBeLessThanOrEqual(SHADCN_COMPOSE_MAX_DEPTH);
      const constituentSource = (leaf: string) => result.compose.find(other => other.leaf === leaf)?.source ?? fills.get(`components.${leaf}`) ?? "foundry";
      if (row.status === "composed") {
        expect(row.source).toBe("shadcn@aria");
        expect(row.constituents.length).toBeGreaterThan(0);
        for (const constituent of row.constituents) expect(constituentSource(constituent), `${row.leaf}<-${constituent}`).toBe("shadcn@aria");
      } else expect(row.source, row.leaf).toBe("foundry");
    }
  });

  it("composes file-trigger from the shadcn@aria button and keeps every blocked leaf on its gap seat with the reason", () => {
    const by = Object.fromEntries(result.compose.map(row => [row.leaf, row]));
    expect(by["file-trigger"]).toMatchObject({ status: "composed", source: "shadcn@aria", constituents: ["button"], depth: 0 });
    expect(fills.get("components.button")).toBe("shadcn@aria");
    for (const rule of SHADCN_COMPOSE_RULES.filter(rule => rule.blocker)) expect(by[rule.leaf]).toMatchObject({ status: "gap", source: "foundry", reason: rule.blocker });
    // date-picker reads the registered rule's inputs and stays mixed while date-field is a gap seat.
    expect(by["date-picker"]!.constituents.map(leaf => `components.${leaf}`)).toEqual(datePickerRule.inputs);
    expect(by["date-picker"]).toMatchObject({ status: "gap", source: "foundry", reason: "constituent components.date-field=foundry is not shadcn@aria" });
    expect(result.compose.filter(row => row.status === "composed").map(row => row.leaf)).toEqual(["file-trigger"]);
  });

  it("emits the composed file-trigger as a shadcn@aria rule template that validates against its registered rule", () => {
    expect(result.composed.map(doc => doc.$extensions["com.clossys.fill"].id)).toEqual(["shadcn@aria/components.file-trigger"]);
    expect(stableStringify(result.composed[0])).toBe(stableStringify(composedFileTrigger));
    expect(result.fills.some(doc => doc.$extensions["com.clossys.fill"].slot === "components.file-trigger")).toBe(false);
    const rule = loadComponentCompositionRules().find(candidate => candidate.slot === "components.file-trigger")!;
    expect(rule.template).toMatchObject({ source: "shadcn@aria", root: "rac:FileTrigger", composes: ["components.button"], reads: { components: ["components.button"] } });
    expect(composedFileTrigger.$extensions["com.clossys.fill"]).toMatchObject({ source: "shadcn@aria", originKinds: ["composed"], sourceAddress: "rules/components.file-trigger.json#compose:file-trigger@1" });
    expect(() => validateComponentRuleTemplate(rule)).not.toThrow();
  });
  it("records the pinned D1 registry items each seat would wrap and keeps all seven on their gap seats with the measured reason", () => {
    const by = Object.fromEntries(result.compose.map(row => [row.leaf, row]));
    const seven = ["date-field", "field", "text-field", "search-field", "form", "spinner", "toolbar"];
    expect(Object.fromEntries(seven.map(leaf => [leaf, by[leaf]!.items]))).toEqual({
      "date-field": ["input-group"], field: ["label", "field"], "text-field": ["label", "input"], "search-field": ["input-group", "input"], form: [], spinner: ["spinner"], toolbar: [],
    });
    for (const leaf of seven) expect(by[leaf], leaf).toMatchObject({ status: "gap", source: "foundry" });
    for (const row of result.compose) for (const item of row.items) expect(SHADCN_COMPOSE_ITEMS, `${row.leaf}<-${item}`).toContain(item);
    // button-group and form ship no pinned bytes, so no rule may name them.
    for (const absent of ["button-group", "form"]) expect(() => resolveShadcnComposeRules([{ leaf: "toolbar", constituents: [], items: [absent] }], { slots: registered, sources: shadcn(), items: new Set(result.compose.flatMap(row => row.items)) })).toThrow(/not pinned|not a D1/);
  });
  it("composes over pinned registry items and refuses unlisted, unpinned and repeated items", () => {
    const items = new Set(["input", "label"]);
    expect(resolveShadcnComposeRules([{ leaf: "text-field", constituents: [], items: ["label", "input"] }], { slots: registered, sources: shadcn(), items })[0]).toMatchObject({ status: "composed", source: "shadcn@aria", items: ["label", "input"], depth: 0 });
    expect(() => resolveShadcnComposeRules([{ leaf: "text-field", constituents: [], items: ["textarea"] }], { slots: registered, sources: shadcn(), items: new Set(["textarea"]) })).toThrow(/textarea is not a D1 registry item/);
    expect(() => resolveShadcnComposeRules([{ leaf: "toolbar", constituents: [], items: ["button-group"] }], { slots: registered, sources: shadcn(), items })).toThrow(/button-group is not pinned/);
    expect(() => resolveShadcnComposeRules([{ leaf: "text-field", constituents: [], items: ["input", "input"] }], { slots: registered, sources: shadcn(), items })).toThrow(/items repeat/);
    expect(() => resolveShadcnComposeRules([{ leaf: "text-field", constituents: [], items: [] }], { slots: registered, sources: shadcn(), items })).toThrow(/composes nothing/);
  });
  it("refuses a cycle", () => {
    const rules: ShadcnComposeRule[] = [{ leaf: "date-picker", constituents: ["date-field"] }, { leaf: "date-field", constituents: ["date-picker"] }];
    expect(() => resolveShadcnComposeRules(rules, { slots: registered, sources: shadcn() })).toThrow(/cycle date-picker -> date-field -> date-picker/);
  });

  it("drops the shadcn@aria source when one constituent is Foundry", () => {
    const rules: ShadcnComposeRule[] = [{ leaf: "date-picker", constituents: ["calendar", "date-field", "popover"] }];
    expect(resolveShadcnComposeRules(rules, { slots: registered, sources: shadcn("calendar", "date-field", "popover") })[0]).toMatchObject({ status: "composed", source: "shadcn@aria" });
    expect(resolveShadcnComposeRules(rules, { slots: registered, sources: shadcn("calendar", "popover") })[0]).toMatchObject({ status: "gap", source: "foundry", reason: "constituent components.date-field=foundry is not shadcn@aria" });
  });

  it("allows one level of nested composition and refuses depth two", () => {
    const sources = shadcn("calendar", "popover", "field", "button");
    const nested: ShadcnComposeRule[] = [{ leaf: "date-picker", constituents: ["calendar", "date-field", "popover"] }, { leaf: "date-field", constituents: ["field"] }];
    expect(resolveShadcnComposeRules(nested, { slots: registered, sources }).map(row => [row.leaf, row.depth, row.source])).toEqual([["date-picker", 1, "shadcn@aria"], ["date-field", 0, "shadcn@aria"]]);
    const deep: ShadcnComposeRule[] = [...nested.slice(0, 1), { leaf: "date-field", constituents: ["field"] }, { leaf: "field", constituents: ["button"] }];
    expect(() => resolveShadcnComposeRules(deep, { slots: registered, sources })).toThrow(/date-picker nests compositions 2 levels deep/);
  });

  it("refuses unregistered constituents, self-reference and empty unblocked rules", () => {
    expect(() => resolveShadcnComposeRules([{ leaf: "file-trigger", constituents: ["upload-button"] }], { slots: registered, sources: shadcn() })).toThrow(/not a registered leaf/);
    expect(() => resolveShadcnComposeRules([{ leaf: "file-trigger", constituents: ["file-trigger"] }], { slots: registered, sources: shadcn() })).toThrow(/name the leaf itself/);
    expect(() => resolveShadcnComposeRules([{ leaf: "file-trigger", constituents: [] }], { slots: registered, sources: shadcn() })).toThrow(/composes nothing/);
  });
});

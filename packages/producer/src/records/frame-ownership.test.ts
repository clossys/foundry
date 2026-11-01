import { describe, expect, it } from "vitest";
import { validateSlotContract } from "./validate.js";
import type { SlotContract } from "./types.js";
import { SLOT_CONTRACT_SCHEMA } from "./schemas.js";
import { withFrameOwnershipSchema } from "./frame-ownership-schema.js";

const app: SlotContract = {
  schema: "clossys.slot-contract/1", slot: "frames.app", package: "designer", layer: "frames",
  purpose: "Application navigation surrounding a page frame.",
  inputs: [
    { name: "navigation", kind: "data", required: true },
    { name: "brand", kind: "asset", slot: "assets.mark", required: true },
    { name: "name", kind: "copy", slot: "strings.names", required: true },
  ],
  ownership: { kind: "app", regions: { navigation: ["navigation", "brand", "name"] } },
  limits: {}, references: [], checkSuite: "frames", specimenKind: "flow",
};
const page: SlotContract = {
  ...app, slot: "frames.page", purpose: "Page header, chat and body.",
  inputs: [
    { name: "breadcrumbs", kind: "data", required: true },
    { name: "actions", kind: "data", required: true },
    { name: "chat", kind: "cell", slot: "sections.chat", required: true },
    { name: "children", kind: "prop", required: true },
  ],
  ownership: { kind: "page", regions: { header: ["breadcrumbs", "actions"], chat: ["chat"], body: ["children"] } },
};
const fails = (value: unknown, message: string) => {
  const result = validateSlotContract(value);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues.some(issue => issue.message.includes(message))).toBe(true);
};

describe("frame region ownership", () => {
  it("binds app navigation separately from the page header, chat and body", () => {
    expect(validateSlotContract(app).ok).toBe(true);
    expect(validateSlotContract(page).ok).toBe(true);
  });
  it("rejects a page region inside an app frame and navigation inside a page frame", () => {
    fails({ ...app, ownership: { ...app.ownership, regions: { navigation: ["navigation"], header: ["name"] } } }, "one alternative");
    fails({ ...page, ownership: { ...page.ownership, regions: { ...page.ownership!.regions, navigation: ["navigation"] } } }, "one alternative");
  });
  it("rejects missing, empty, unknown and multiply owned region bindings", () => {
    fails({ ...page, ownership: { kind: "page", regions: { header: ["breadcrumbs"], body: ["children"] } } }, "one alternative");
    fails({ ...app, ownership: { kind: "app", regions: { navigation: [] } } }, "one alternative");
    fails({ ...app, ownership: { kind: "app", regions: { navigation: ["missing"] } } }, "undeclared input missing");
    fails({ ...page, ownership: { kind: "page", regions: { header: ["breadcrumbs", "actions"], chat: ["chat"], body: ["children", "actions"] } } }, "more than one region");
    fails({ ...page, ownership: { kind: "page", regions: { header: ["breadcrumbs"], chat: ["chat"], body: ["children"] } } }, "required input actions has no owning region");
  });
  it("requires identity and copy to name an owning slot, and refuses ownership on a section", () => {
    for (const name of ["brand", "name"]) fails({ ...app, inputs: app.inputs.map(input => input.name === name ? { name, kind: input.kind, required: true } : input) }, "must bind an owning slot");
    fails({ ...app, slot: "sections.app", layer: "sections" }, "only to frame contracts");
    fails({ ...app, inputs: [...app.inputs, app.inputs[0]] }, "input names must be unique");
    fails({ ...app, inputs: app.inputs.map(input => input.name === "brand" ? { ...input, slot: "literal-logo" } : input) }, "match");
  });
});

// The extension adds only ownership and source-slot binding; legacy constraints
// and the semantics of every other record validator remain authoritative.
describe("frame ownership schema composition", () => {
  it("preserves canonical schema constraints without mutating the shared schema", () => {
    const before = JSON.stringify(SLOT_CONTRACT_SCHEMA);
    const extended = withFrameOwnershipSchema(SLOT_CONTRACT_SCHEMA);
    expect(JSON.stringify(SLOT_CONTRACT_SCHEMA)).toBe(before);
    expect(extended.$defs).toBe(SLOT_CONTRACT_SCHEMA.$defs);
    expect(extended.required).toBe(SLOT_CONTRACT_SCHEMA.required);
    expect(extended.additionalProperties).toBe(false);
    const originalInputs = SLOT_CONTRACT_SCHEMA.properties!.inputs!;
    expect(extended.properties!.inputs!.items!.additionalProperties).toBe(originalInputs.items!.additionalProperties);
    expect(extended.properties!.inputs!.items!.required).toBe(originalInputs.items!.required);
    for (const [key, constraint] of Object.entries(SLOT_CONTRACT_SCHEMA.properties!)) {
      if (key !== "inputs") expect(extended.properties![key]).toBe(constraint);
    }
    for (const [key, constraint] of Object.entries(originalInputs.items!.properties!)) {
      expect(extended.properties!.inputs!.items!.properties![key]).toBe(constraint);
    }
  });
  it("keeps legacy contracts closed and checks their original constraints", () => {
    const { ownership: _ownership, ...legacy } = app;
    for (const invalid of [
      { ...app, unexpected: true },
      { ...app, inputs: app.inputs.map(input => ({ ...input, unexpected: true })) },
      { ...app, package: "Invalid Package" },
      { ...app, references: [{ registry: "shadcn", item: "sidebar", version: "4.23.0", hash: "bad" }] },
      { ...legacy, slot: "sections.app" },
      { ...legacy, inputs: [{ name: "x", kind: "unknown", required: true }] },
      { ...legacy, specimenKind: "unknown" },
    ]) expect(validateSlotContract(invalid).ok).toBe(false);
    expect(validateSlotContract(legacy).ok).toBe(true);
  });
  it("rejects duplicate region entries, unknown ownership fields and malformed input slots", () => {
    fails({ ...app, ownership: { kind: "app", regions: { navigation: ["navigation", "navigation"] } } }, "one alternative");
    fails({ ...app, ownership: { ...app.ownership, unexpected: true } }, "one alternative");
    fails({ ...app, inputs: app.inputs.map(input => ({ ...input, slot: "invalid" })) }, "match");
  });
});

import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { RenderError } from "../../internal/errors.js";
import { defineWebTemplate } from "./defineWebTemplate.js";
import { nodeSlotKeys, slotKindsFor } from "./webTemplates.js";

const minimalOptions = {
  name: "AcmeWidget",
  flow: { slots: [{ key: "heading", required: true }, { key: "caption" }] },
  build: (content: Record<string, unknown>) => createElement("div", null, content.heading as never),
};

function expectInvalidDefinition(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(RenderError);
  expect((thrown as RenderError).reason).toBe("invalid-template-definition");
}

describe("defineWebTemplate — happy path", () => {
  it("builds a WebTemplate from the minimal required fields", () => {
    const template = defineWebTemplate(minimalOptions);
    expect(template.name).toBe("AcmeWidget");
    expect(template.flow.slots.map((s) => s.key)).toEqual(["heading", "caption"]);
    expect(template.slotKinds).toBeUndefined();
    expect(template.repeatingSlots).toBeUndefined();
    expect(typeof template.build).toBe("function");
  });

  it("a slot absent from slotKinds defaults to ['copy', 'asset'], the same as every built-in", () => {
    const template = defineWebTemplate(minimalOptions);
    expect(slotKindsFor(template, "heading")).toEqual(["copy", "asset"]);
  });

  it("accepts a slot explicitly declared 'node'-kind, and nodeSlotKeys picks it up", () => {
    const template = defineWebTemplate({
      ...minimalOptions,
      flow: { slots: [{ key: "heading", required: true }, { key: "widget", required: true }] },
      slotKinds: { widget: ["node"] },
    });
    expect(slotKindsFor(template, "widget")).toEqual(["node"]);
    expect(nodeSlotKeys(template)).toEqual(["widget"]);
  });

  it("accepts a slot declared with more than one kind, e.g. both copy and node", () => {
    const template = defineWebTemplate({
      ...minimalOptions,
      flow: { slots: [{ key: "widget", required: true }] },
      slotKinds: { widget: ["copy", "node"] },
    });
    expect(slotKindsFor(template, "widget")).toEqual(["copy", "node"]);
  });

  it("accepts a repeatingSlots declaration alongside flowed slots, disjoint from them", () => {
    const template = defineWebTemplate({
      ...minimalOptions,
      repeatingSlots: [{ key: "items", required: true }, { key: "extras" }],
    });
    expect(template.repeatingSlots).toEqual([{ key: "items", required: true }, { key: "extras" }]);
  });

  it("returns a frozen template — flow, flow.slots, slotKinds, and repeatingSlots cannot be mutated after the fact", () => {
    const template = defineWebTemplate({
      ...minimalOptions,
      slotKinds: { heading: ["copy"] },
      repeatingSlots: [{ key: "items" }],
    });
    expect(Object.isFrozen(template)).toBe(true);
    expect(Object.isFrozen(template.flow)).toBe(true);
    expect(Object.isFrozen(template.flow.slots)).toBe(true);
    expect(Object.isFrozen(template.slotKinds)).toBe(true);
    expect(Object.isFrozen(template.repeatingSlots)).toBe(true);
  });
});

describe("defineWebTemplate — fails closed with RenderError('invalid-template-definition', ...), never a second error type", () => {
  it("rejects a non-object options argument", () => {
    expectInvalidDefinition(() => defineWebTemplate(null as never));
  });

  it("rejects an empty name", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, name: "" }));
  });

  it("rejects a flow with no slots array", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, flow: {} as never }));
  });

  it("rejects a flow slot with an empty key", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, flow: { slots: [{ key: "" }] } }));
  });

  it("rejects a duplicate slot key within the same flow", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, flow: { slots: [{ key: "heading" }, { key: "heading" }] } }));
  });

  it("rejects slotKinds naming a key flow.slots does not declare — the typo case", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, slotKinds: { headnig: ["copy"] } }));
  });

  it("rejects slotKinds with an empty content-kind list", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, slotKinds: { heading: [] } }));
  });

  it("rejects slotKinds with an unknown content-kind value", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, slotKinds: { heading: ["html" as never] } }));
  });

  it("rejects slotKinds listing the same kind twice for one slot", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, slotKinds: { heading: ["copy", "copy"] } }));
  });

  it("rejects a repeatingSlots key that collides with a flow.slots key", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, repeatingSlots: [{ key: "heading" }] }));
  });

  it("rejects a duplicate key within repeatingSlots itself", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, repeatingSlots: [{ key: "items" }, { key: "items" }] }));
  });

  it("rejects a non-function build", () => {
    expectInvalidDefinition(() => defineWebTemplate({ ...minimalOptions, build: "not-a-function" as never }));
  });
});

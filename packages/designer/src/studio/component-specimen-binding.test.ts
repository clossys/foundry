import { expect, it } from "vitest";
import * as components from "../components/index.js";
import { resolve, type CompositeResolved } from "../catalog-core/index.js";
import { adoptedComponentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { componentSpecimenPreview } from "./component-specimens.js";
import { bindComponentSpecimen } from "./component-specimen-binding.js";

it("pure selected binding and the public preview bind API preserve exact implementation, members and provenance", () => {
  const profile = resolve(adoptedComponentIntegration());
  const modules = { "@clossys/designer/components": components };
  const actual = bindComponentSpecimen(modules, "components.button", profile);
  expect(actual).toEqual(componentSpecimenPreview({ modules }).bind("components.button", profile));
  if (!("binding" in actual)) throw new Error("Expected the adopted actual Button implementation");
  expect(actual.binding.Component).toBe(components.Button);
  expect(actual.binding.members.length).toBeGreaterThan(0);
  expect(actual.binding.members.every(member => member.Component === components.Button)).toBe(true);
  expect(actual.binding.exports).toBe(components);
});

it("pure binding preserves all missing-selection/module/export refusals without borrowing defaults", () => {
  const profile = resolve(adoptedComponentIntegration());
  for (const [modules, leaf, code] of [
    [{}, "components.button", "module-unavailable"],
    [{ "@clossys/designer/components": {} }, "components.button", "export-unavailable"],
    [{ "@clossys/designer/components": { Button: "not a component" } }, "components.button", "export-unavailable"],
    [{ "@clossys/designer/components": components }, "components.select", "not-chosen"],
    [{ "@clossys/designer/components": components }, "tokens.text-color", "not-a-component"],
  ] as const) {
    const actual = bindComponentSpecimen(modules, leaf, profile);
    expect(actual).toEqual(componentSpecimenPreview({ modules }).bind(leaf, profile));
    expect(actual).toMatchObject({ refusal: { leaf, code } });
  }
});

it("an unsupported mapped member stays named and unbound under both APIs", () => {
  const profile = resolve(adoptedComponentIntegration()), component = profile.components.components["components.button"]!;
  const member = component.descriptor.members[0]!;
  const changed: CompositeResolved = { ...profile, components: { ...profile.components, components: { ...profile.components.components, "components.button": { ...component, propMap: { ...component.propMap, [member]: "[not an executable mapping]" } } } } };
  const modules = { "@clossys/designer/components": components };
  const actual = bindComponentSpecimen(modules, "components.button", changed);
  expect(actual).toEqual(componentSpecimenPreview({ modules }).bind("components.button", changed));
  if (!("binding" in actual)) throw new Error("The valid selected root should stay bound");
  expect(actual.binding.Component).toBe(components.Button);
  expect(actual.binding.unbound).toEqual([{ member, detail: `components: unsupported propMap components.button.${member}` }]);
  expect(actual.binding.members.some(row => row.member === member)).toBe(false);
});

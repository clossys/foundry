import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompositeResolved } from "../catalog-core/index.js";
import { glyphs } from "../components/preview-runtime/adapters/glyphs.js";
import { defaultComponentPreviews } from "./default-component-previews.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import profileData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };

const profile = () => ({ selectionHash: profileData.selectionHash, components: structuredClone(profileData), values: { members: Object.fromEntries(Object.entries(glyphs).map(([slot, value]) => [slot, { slot, value: { light: value } }])) } }) as unknown as CompositeResolved;
it("renders all 59 selected default component leaves with zero unavailable previews", () => {
  const selected = profile();
  const leaves = Object.keys(selected.components.components);
  expect(leaves).toHaveLength(59);
  const failures: Record<string,string> = {};
  for (const leaf of leaves) {
    const node = defaultComponentPreviews.preview(leaf, selected);
    if (!node) { failures[leaf] = "unavailable"; continue; }
    try {
      const html = renderToStaticMarkup(<>{node}</>);
      if (!html || /data-specimen-(?:unavailable|error)=/.test(html)) failures[leaf] = html;
      expect((html.match(/data-component-specimen=/g) ?? []).length, leaf).toBe(1);
    } catch (error) { failures[leaf] = String(error); }
  }
  expect(failures).toEqual({});
});
it("refuses edited source and dependency closures instead of borrowing compiled default bytes", () => {
  const changed = profile();
  const file = changed.components.files.find(row => row.path === "components/avatar/avatar.tsx")!;
  file.content += "\n// host correction\n";
  expect(defaultComponentPreviews.preview("components.avatar", changed)).toBeUndefined();
  const dependency = profile();
  dependency.components.components["components.popover"]!.impl = { kind: "package", module: "@host/custom", export: "Popover" };
  expect(defaultComponentPreviews.preview("components.date-picker", dependency)).toBeUndefined();
});
it("preserves another consumer's matching selection without tying previews to its name or adoption date", () => {
  const selected = profile();
  for (const component of Object.values(selected.components.components)) {
    component.descriptor.source = "another-consumer";
    if (component.origin.kind === "adopted") component.origin.sha256 = componentDescriptorHash(component.descriptor);
    if ("adoptedAt" in component.origin) component.origin.adoptedAt = "2026-10-28";
  }
  for (const leaf of Object.keys(selected.components.components)) expect(defaultComponentPreviews.preview(leaf, selected), leaf).toBeDefined();
});

it("refuses a stale adoption checksum even when its implementation matches", () => {
  const selected = profile();
  selected.components.components["components.avatar"]!.descriptor.source = "another-consumer";
  expect(defaultComponentPreviews.preview("components.avatar", selected)).toBeUndefined();
});

it("refuses a tampered origin checksum or a rehashed descriptor edit", () => {
  const checksum = profile(), edited = profile();
  const stale = checksum.components.components["components.avatar"]!;
  if (stale.origin.kind !== "adopted") throw new Error("Expected an adopted fixture");
  stale.origin.sha256 = "0".repeat(64);
  expect(defaultComponentPreviews.preview(stale.slot, checksum)).toBeUndefined();
  const changed = edited.components.components["components.avatar"]!;
  if (changed.origin.kind !== "adopted") throw new Error("Expected an adopted fixture");
  changed.descriptor.item += "-edited";
  changed.origin.sha256 = componentDescriptorHash(changed.descriptor);
  expect(defaultComponentPreviews.preview(changed.slot, edited)).toBeUndefined();
});

it("accepts additional open-scale members while refusing changed registered CSS bindings", () => {
  const extended = profile(), changed = profile();
  const button = extended.components.components["components.button"]!;
  button.reads.themes = { ...button.reads.themes, "tokens.easing.consumer": "--ease-consumer" };
  extended.values.members["tokens.easing.consumer"] = { slot: "tokens.easing" } as typeof extended.values.members[string];
  expect(defaultComponentPreviews.preview(button.slot, extended)).toBeDefined();
  const edited = changed.components.components["components.button"]!;
  edited.reads.themes = { ...edited.reads.themes, "tokens.easing.default": "--ease-consumer" };
  expect(defaultComponentPreviews.preview(edited.slot, changed)).toBeUndefined();
});

it("refuses missing registered bindings, undeclared reads and closed-scale extensions", () => {
  for (const member of ["tokens.not-declared.consumer", "themes.primary.default", "tokens.chart-color.axis"]) {
    const selected = profile(), button = selected.components.components["components.button"]!;
    button.reads.themes = { ...button.reads.themes, [member]: member === "tokens.chart-color.axis" ? "--color-chart-axis" : "--color-consumer" };
    expect(defaultComponentPreviews.preview(button.slot, selected)).toBeUndefined();
  }
  const selected = profile(), button = selected.components.components["components.button"]!;
  const { "tokens.easing.default": _removed, ...tokens } = button.reads.themes;
  button.reads.themes = tokens;
  expect(defaultComponentPreviews.preview(button.slot, selected)).toBeUndefined();
});

it("refuses a changed selected glyph rather than presenting its static default as selected", () => {
  const selected = profile();
  const component = Object.values(selected.components.components).find(row => row.reads.assets.length > 0)!;
  const asset = component.reads.assets[0]!;
  (selected.values.members[asset]!.value as { light: unknown }).light = [["path", { d: "M0 0h1" }]];
  expect(defaultComponentPreviews.preview(component.slot, selected)).toBeUndefined();
});

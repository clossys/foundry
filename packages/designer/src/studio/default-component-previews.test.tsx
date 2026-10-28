import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompositeResolved } from "../catalog-core/index.js";
import { glyphs } from "../components/preview-runtime/adapters/glyphs.js";
import { defaultComponentPreviews } from "./default-component-previews.js";
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
    if ("adoptedAt" in component.origin) component.origin.adoptedAt = "2026-10-28";
  }
  expect(defaultComponentPreviews.preview("components.avatar", selected)).toBeDefined();
});

it("refuses a changed selected glyph rather than presenting its static default as selected", () => {
  const selected = profile();
  const component = Object.values(selected.components.components).find(row => row.reads.assets.length > 0)!;
  const asset = component.reads.assets[0]!;
  (selected.values.members[asset]!.value as { light: unknown }).light = [["path", { d: "M0 0h1" }]];
  expect(defaultComponentPreviews.preview(component.slot, selected)).toBeUndefined();
});

import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import type { SpecimenLeafDefinition, SpecimenLeafId } from "./specimen-layouts.js";
import type { RegisteredSpecimenCases } from "./specimen-coverage.js";
import { designerViewportSpecimenLeaves, componentSpecimenItems, surfaceSpecimenItems } from "./specimen-viewports.js";
import { tokenAssetSpecimenLeaves, tokenSpecimenItems, assetSpecimenItems, colorRampSpecimenItems } from "./specimen-token-assets.js";
import { contentSpecimenLeaves } from "./specimen-content.js";

/** The executable definitions themselves are the registry; no separate list of claimed leaf implementations. */
export const studioSpecimenLeaves: readonly SpecimenLeafDefinition[] = [
  ...tokenAssetSpecimenLeaves,
  ...designerViewportSpecimenLeaves,
  ...contentSpecimenLeaves,
];

/** Native Designer enumeration is independent of a cell's supplied item subset. Other agents supply native source cases. */
export function enumerateRegisteredDesignerSpecimenCases(input: {
  readonly context: DesignerSpecimenContext;
  readonly specimen: SpecimenLeafId;
  readonly sourceLeaf: string;
}): RegisteredSpecimenCases | undefined {
  const { context, specimen, sourceLeaf } = input;
  if (specimen === "sections.specimen-variant-matrix") return componentSpecimenItems(context, sourceLeaf);
  if (specimen === "sections.specimen-section-viewports" || specimen === "sections.specimen-frame-viewports") return surfaceSpecimenItems(context, sourceLeaf);
  if (specimen === "sections.specimen-color-ramp") return { items: colorRampSpecimenItems(context, sourceLeaf) };
  if (specimen === "sections.specimen-asset-grid" || specimen === "sections.specimen-icon-grid") return { items: assetSpecimenItems(context, sourceLeaf) };
  if (tokenAssetSpecimenLeaves.some(leaf => leaf.id === specimen)) return { items: tokenSpecimenItems(context, sourceLeaf) };
  return undefined;
}

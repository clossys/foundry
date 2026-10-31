import type { SpecimenAgent } from "./specimen-coverage.js";
import type { SpecimenLeafDefinition, SpecimenLeafId } from "./specimen-layouts.js";

/** Semantic kinds come from the native cell projection; ambiguous or unknown kinds stay unbound. */
export const SPECIMEN_KIND_MAP: readonly { readonly agent: SpecimenAgent; readonly kind: string; readonly canonicalKind?: string; readonly layer?: string; readonly specimen: SpecimenLeafId }[] = [
  { agent: "designer", kind: "color", layer: "themes", specimen: "sections.specimen-swatch" },
  { agent: "designer", kind: "color-ramp", layer: "themes", specimen: "sections.specimen-color-ramp" },
  { agent: "designer", kind: "type", layer: "themes", specimen: "sections.specimen-type-ladder" },
  { agent: "designer", kind: "spacing", layer: "themes", specimen: "sections.specimen-spacing-ladder" },
  { agent: "designer", kind: "radius", layer: "themes", specimen: "sections.specimen-radius-ladder" },
  { agent: "designer", kind: "motion", layer: "themes", specimen: "sections.specimen-motion-player" },
  { agent: "designer", kind: "asset", layer: "assets", specimen: "sections.specimen-asset-grid" },
  { agent: "designer", kind: "icon", layer: "assets", specimen: "sections.specimen-icon-grid" },
  { agent: "designer", kind: "component", layer: "components", specimen: "sections.specimen-variant-matrix" },
  { agent: "designer", kind: "section", layer: "sections", specimen: "sections.specimen-section-viewports" },
  { agent: "designer", kind: "frame", layer: "frames", specimen: "sections.specimen-frame-viewports" },
  { agent: "director", kind: "passage", specimen: "sections.specimen-rich-passage" },
  { agent: "writer", kind: "copy", specimen: "sections.specimen-copy-in-context" },
  { agent: "publisher", kind: "page", specimen: "sections.specimen-page-viewports" },
  { agent: "director", kind: "director", canonicalKind: "passage", specimen: "sections.specimen-rich-passage" },
  { agent: "writer", kind: "writer", canonicalKind: "copy", specimen: "sections.specimen-copy-in-context" },
  { agent: "publisher", kind: "publisher", canonicalKind: "page", specimen: "sections.specimen-page-viewports" },
];

export interface SpecimenCellKind {
  readonly kind: string;
  readonly layer: string;
  /** An explicit id overrides only the default, never registration or compatibility checks. */
  readonly specimen?: SpecimenLeafId;
}
export type SpecimenLeafBinding = { readonly leaf: SpecimenLeafDefinition } | { readonly error: "unbound-specimen" | "unregistered-specimen" | "incompatible-specimen" | "duplicate-specimen-registration" };

export function resolveSpecimenLeafBinding(cell: SpecimenCellKind, registry: readonly SpecimenLeafDefinition[]): SpecimenLeafBinding {
  const mapping = SPECIMEN_KIND_MAP.find(entry => entry.kind === cell.kind && (entry.layer === undefined || entry.layer === cell.layer));
  const id = cell.specimen ?? mapping?.specimen;
  if (!id) return { error: "unbound-specimen" };
  const definitions = registry.filter(leaf => leaf.id === id);
  if (!definitions.length) return { error: "unregistered-specimen" };
  if (definitions.length !== 1) return { error: "duplicate-specimen-registration" };
  const leaf = definitions[0]!;
  if (!leaf.compatible.some(entry => entry.kind === (mapping?.canonicalKind ?? cell.kind) && (entry.layer === undefined || entry.layer === cell.layer))) return { error: "incompatible-specimen" };
  return { leaf };
}

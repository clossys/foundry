import type { SpecimenLeafDefinition, SpecimenLeafId } from "./specimen-layouts.js";

/** Semantic kinds come from the native cell projection; ambiguous or unknown kinds stay unbound. */
export const SPECIMEN_KIND_MAP: readonly { readonly kind: string; readonly canonicalKind?: string; readonly layer?: string; readonly specimen: SpecimenLeafId }[] = [
  { kind: "color", layer: "tokens", specimen: "sections.specimen-swatch" },
  { kind: "color-ramp", layer: "tokens", specimen: "sections.specimen-color-ramp" },
  { kind: "type", layer: "tokens", specimen: "sections.specimen-type-ladder" },
  { kind: "spacing", layer: "tokens", specimen: "sections.specimen-spacing-ladder" },
  { kind: "radius", layer: "tokens", specimen: "sections.specimen-radius-ladder" },
  { kind: "motion", layer: "tokens", specimen: "sections.specimen-motion-player" },
  { kind: "asset", layer: "assets", specimen: "sections.specimen-asset-grid" },
  { kind: "icon", layer: "assets", specimen: "sections.specimen-icon-grid" },
  { kind: "component", layer: "components", specimen: "sections.specimen-variant-matrix" },
  { kind: "section", layer: "sections", specimen: "sections.specimen-section-viewports" },
  { kind: "frame", layer: "frames", specimen: "sections.specimen-frame-viewports" },
  { kind: "passage", specimen: "sections.specimen-rich-passage" },
  { kind: "copy", specimen: "sections.specimen-copy-in-context" },
  { kind: "page", specimen: "sections.specimen-page-viewports" },
  { kind: "director", canonicalKind: "passage", specimen: "sections.specimen-rich-passage" },
  { kind: "writer", canonicalKind: "copy", specimen: "sections.specimen-copy-in-context" },
  { kind: "publisher", canonicalKind: "page", specimen: "sections.specimen-page-viewports" },
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

"use client";

import { createElement, type ReactNode } from "react";
import type { SpecimenLeafProps } from "../../studio/specimen-layouts.js";
import { SpecimenSwatch as SwatchSection, SpecimenColorRamp, SpecimenTypeLadder, SpecimenSpacingLadder, SpecimenRadiusLadder, SpecimenMotionPlayer, SpecimenAssetGrid, SpecimenIconGrid } from "../../studio/specimen-token-assets.js";
import { SpecimenVariantMatrix, SpecimenSectionViewports, SpecimenFrameViewports } from "../../studio/specimen-viewports.js";
import { SpecimenRichPassage, SpecimenCopyInContext as CopyInContextSection, SpecimenPageViewports } from "../../studio/specimen-content.js";

/**
 * Registered `components.specimen-*` leaves (owner 2026-11-05, DESIGNER-READOPT): the visual unit a Studio
 * specimen section renders. Each leaf is a composition of stock leaves (semantic-content, grid-list, table,
 * disclosure and the leaf's own content parts) through the selected consumer library; a variant prop selects
 * the specimen kind where one contract fits several. Data preparation stays in the section.
 */
export type SpecimenLeafComponentProps<Variant extends string = never> = SpecimenLeafProps & ([Variant] extends [never] ? object : { readonly variant?: Variant });

type Renderer = (props: SpecimenLeafProps) => ReactNode;
// The renderer table is read at render time: the studio renderers import the component barrel that exports
// these leaves, so their bindings are not initialised while this module evaluates.
const dispatch = <Variant extends string>(name: string, table: () => Readonly<Record<Variant, Renderer>>, fallback: Variant) => {
  const Leaf = ({ variant = fallback, ...props }: SpecimenLeafProps & { readonly variant?: Variant }): ReactNode => {
    const renderers = table();
    const render = Object.hasOwn(renderers, variant) ? renderers[variant] : undefined;
    if (!render) throw new TypeError(`${name}: unknown specimen variant ${String(variant)}`);
    return createElement(render, props);
  };
  Object.defineProperty(Leaf, "displayName", { value: name });
  return Leaf;
};

export type SpecimenSwatchVariant = "swatch" | "color-ramp";
export type SpecimenLadderVariant = "type" | "spacing" | "radius";
export type SpecimenGridVariant = "asset" | "icon";
export type SpecimenViewportVariant = "section" | "frame" | "page";

/** Colour swatches: a single swatch or a ramp of steps with contrast. */
export const SpecimenSwatch = dispatch<SpecimenSwatchVariant>("SpecimenSwatch", () => ({ swatch: SwatchSection, "color-ramp": SpecimenColorRamp }), "swatch");
/** Token ladders: type, spacing or radius steps in order. */
export const SpecimenLadder = dispatch<SpecimenLadderVariant>("SpecimenLadder", () => ({ type: SpecimenTypeLadder, spacing: SpecimenSpacingLadder, radius: SpecimenRadiusLadder }), "type");
/** Motion tokens played on demand. */
export function SpecimenPlayer(props: SpecimenLeafProps): ReactNode { return createElement(SpecimenMotionPlayer, props); }
/** Asset and icon grids. */
export const SpecimenGrid = dispatch<SpecimenGridVariant>("SpecimenGrid", () => ({ asset: SpecimenAssetGrid, icon: SpecimenIconGrid }), "asset");
/** Component variants and states on two or more axes. */
export function SpecimenMatrix(props: SpecimenLeafProps): ReactNode { return <SpecimenVariantMatrix {...props} />; }
/** Section, frame or published page across viewports. */
export const SpecimenViewport = dispatch<SpecimenViewportVariant>("SpecimenViewport", () => ({ section: SpecimenSectionViewports, frame: SpecimenFrameViewports, page: SpecimenPageViewports }), "section");
/** A rich-text passage as authored. */
export function SpecimenPassage(props: SpecimenLeafProps): ReactNode { return <SpecimenRichPassage {...props} />; }
/** Copy shown in the component that carries it. */
export function SpecimenCopyInContext(props: SpecimenLeafProps): ReactNode { return <CopyInContextSection {...props} />; }

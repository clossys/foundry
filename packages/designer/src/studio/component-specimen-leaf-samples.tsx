"use client";
import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { applyLibraryChange, importFoundryFrames, importFoundrySections, libraryHash, loadCatalog, resolve } from "../catalog-core/index.js";
import type { CompositeResolved, LibraryData, Resolved, ResolvedMember } from "../catalog-core/types.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { isImageResource, isVideoResource } from "../catalog-assets/media.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import componentData from "./default-component-preview-profile.json" with { type: "json" };
import { readStudioCopy, type StudioCopyBinding, type StudioCopyRef } from "./copy-binding.js";
import type { DesignerSpecimenContext, DesignerSpecimenNeed, DesignerSurfaceSpecimen } from "./DesignerSpecimen.js";
import type { SpecimenAxis, SpecimenItem, SpecimenLeafProps, SpecimenNativeViewportParts, SpecimenRenderParts } from "./specimen-layouts.js";
import { colorRampSpecimenItems, tokenAssetSpecimenLeaves, tokenSpecimenItems } from "./specimen-token-assets.js";
import { renderSpecimenContrastHostPart, renderSpecimenSwatchHostPart } from "./specimen-token-host-parts.js";
import { componentSpecimenItems, surfaceSpecimenItems } from "./specimen-viewports.js";
import { packageSurfacePreview } from "./planned-surface-previews.js";
import { componentSpecimenKey, componentSpecimenPreview, type ComponentSpecimenModule } from "./component-specimens.js";
import { componentSpecimenSample, type ComponentSpecimenSample } from "./component-specimen-samples.js";
import { SPECIMEN_ANCHOR_DATE, specimenDataset } from "./specimen-dataset.js";

/**
 * Sample content for the registered `components.specimen-*` leaves (planner:R2F-48). Each leaf draws one
 * specimen section, so its sample is a whole DesignerSpecimenContext: the cell's own selection where the host
 * supplied one, filled in from a sample context. The sample context is not a consumer resolution: its values
 * are the catalog's Foundry themes and the dataset's asset slots resolved through resolve(), its components the
 * generated default component profile, and its surfaces the Foundry package previews. Every gap renders a
 * visible NEED marker; nothing is replaced by a label.
 */

/** Where the cell's selection comes from: the profile and modules the host passed to componentSpecimenPreview. */
export interface ComponentSpecimenHost {
  readonly profile?: CompositeResolved;
  readonly modules?: Readonly<Record<string, ComponentSpecimenModule>>;
  /** The host's Writer resolver. Without one, Writer-owned Studio chrome (the show-all action) is a NEED. */
  readonly copy?: StudioCopyBinding;
}

/** Writer reference for the specimen sections' show-all action: strings.admin.action.showAll. */
export const SPECIMEN_SHOW_ALL_COPY: StudioCopyRef = Object.freeze({ id: "st.aegf3kwazy" });

type Recipe =
  | { readonly kind: "token" | "ramp" | "component" | "surface"; readonly leaf: string }
  | { readonly kind: "items"; readonly items: readonly SpecimenItem[] };
type Recipes = Readonly<Record<string, Recipe>>;

/** The package exports whose sample is a specimen section, by sample key. */
const LEAF_KEYS = new Set(["SpecimenSwatch", "SpecimenLadder", "SpecimenPlayer", "SpecimenGrid", "SpecimenMatrix", "SpecimenViewport", "SpecimenPassage", "SpecimenCopyInContext"].map(name => `./components#${name}`));
export const isSpecimenLeafKey = (key: string): boolean => LEAF_KEYS.has(key);

/** tokenAssetSpecimenLeaves order: the validator that admits one token or asset item for a variant. */
const TOKEN_DEFINITION: Readonly<Record<string, number>> = { swatch: 0, "color-ramp": 1, type: 2, spacing: 3, radius: 4, player: 5, asset: 6, icon: 7 };

const sampleAssetSlots = (): readonly string[] => [...new Set([
  ...Object.values(specimenDataset.specimenLeaves).flatMap(recipes => Object.values(recipes as Recipes)).flatMap(recipe => "leaf" in recipe && recipe.leaf.startsWith("assets.") ? [recipe.leaf] : []),
  specimenDataset.mediaPlayer.video.slot, specimenDataset.mediaPlayer.poster.slot,
])];

let values: Resolved | undefined;
/** The catalog's Foundry themes (else the first offer) and the dataset's asset slots, resolved once. */
function sampleValues(): Resolved {
  if (values) return values;
  const catalog = loadCatalog();
  let library: LibraryData = { source: { id: "component-specimen-sample", kind: "consumer", author: "consumer", license: "MIT" }, fills: [], adoptedAt: SPECIMEN_ANCHOR_DATE.toString() };
  const assets = new Set(sampleAssetSlots());
  const changes = catalog.slots.filter(slot => slot.layer === "themes" || assets.has(slot.id)).flatMap(slot => {
    const offers = catalog.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
    const chosen = offers.find(doc => doc.$extensions["com.clossys.fill"].source === "foundry") ?? offers[0];
    return chosen ? [{ op: "adopt" as const, slot: slot.id, source: chosen.$extensions["com.clossys.fill"].source }] : [];
  });
  library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes });
  values = resolve({ catalog, library });
  return values;
}

interface SampleSurface { readonly fill: { readonly document: unknown; readonly descriptorHash: string }; readonly specimen: DesignerSurfaceSpecimen }
let surfaces: Readonly<Record<string, SampleSurface>> | undefined;
/** The Foundry package preview of each surface a recipe names; the hash pairs the fill with its renderer. */
function sampleSurfaces(): Readonly<Record<string, SampleSurface>> {
  if (surfaces) return surfaces;
  const leaves = new Set(Object.values(specimenDataset.specimenLeaves.viewport as Recipes).flatMap(recipe => "leaf" in recipe ? [recipe.leaf] : []));
  const docs = [...importFoundrySections().fills, ...importFoundryFrames().fills].filter(doc => leaves.has(doc.$extensions["com.clossys.fill"].slot));
  const rows: Record<string, SampleSurface> = {};
  for (const doc of docs) {
    const preview = packageSurfacePreview(doc as Parameters<typeof packageSurfacePreview>[0]);
    if ("reason" in preview) continue;
    const descriptorHash = `sample:${sha256(stableStringify(doc))}`;
    rows[doc.$extensions["com.clossys.fill"].slot] = { fill: { document: doc, descriptorHash }, specimen: { descriptorHash, render: () => preview.render() } };
  }
  surfaces = rows;
  return rows;
}

type Components = CompositeResolved["components"];
const defaultComponents = componentData as unknown as Components;
const contexts = new WeakMap<object, DesignerSpecimenContext>();
const NO_PROFILE = {};
/** The cell's selection over the sample context: host members, components, files and surfaces win. */
function sampleContext(host: ComponentSpecimenHost): DesignerSpecimenContext {
  const key = host.profile ?? NO_PROFILE;
  const cached = contexts.get(key);
  if (cached && Object.entries(host.modules ?? {}).every(([name, module]) => cached.modules[name] === module)) return cached;
  const base = sampleValues(), profile = host.profile as Partial<CompositeResolved> | undefined;
  const hostComponents = profile?.components as Partial<Components> | undefined;
  const files = new Map(defaultComponents.files.map(file => [file.path, file]));
  for (const file of hostComponents?.files ?? []) files.set(file.path, file);
  const selectionHash = `sample:${sha256(stableStringify([defaultComponents.selectionHash, hostComponents?.selectionHash ?? null, profile?.selectionHash ?? null]))}`;
  const sample = sampleSurfaces();
  const hostSurfaces = profile?.surfaces;
  const context: DesignerSpecimenContext = {
    profile: {
      ...profile,
      consumer: profile?.consumer ?? base.consumer,
      selectionHash,
      values: { ...base, ...profile?.values, members: { ...base.members, ...profile?.values?.members } },
      components: { ...defaultComponents, ...hostComponents, selectionHash, components: { ...defaultComponents.components, ...hostComponents?.components }, files: [...files.values()] },
      surfaces: { ...hostSurfaces, fills: { ...Object.fromEntries(Object.entries(sample).map(([leaf, row]) => [leaf, row.fill])), ...hostSurfaces?.fills } },
    } as CompositeResolved,
    // Only the host's modules: importing the preview runtime here would cycle through the components barrel.
    modules: { ...host.modules },
    surfaces: Object.fromEntries(Object.entries(sample).map(([leaf, row]) => [leaf, row.specimen])),
  };
  contexts.set(key, context);
  return context;
}

/** A gap stays visible: the marker carries the reason, and the zero-unavailable checks see it. */
const need = ({ leaf, reason }: DesignerSpecimenNeed): ReactNode => <span data-specimen-unavailable="needs-sample-content" data-specimen-need={leaf}>{reason}</span>;

const viewportWidth = (width: number | string): number => width === "var(--breakpoint-mobile)" ? 375 : typeof width === "number" ? width : 1280;
function viewportParts(context: DesignerSpecimenContext): SpecimenNativeViewportParts {
  return {
    renderSurface: ({ leaf, width, state }) => {
      const surface = context.surfaces?.[leaf];
      return surface ? surface.render({ width, state }) : need({ leaf, reason: "The selected surface has no sample fixture." });
    },
    renderViewport: ({ Content, leaf, width, children }) => <Content as="div" data-specimen-viewport={leaf} data-specimen-width={String(width)} style={{ inlineSize: typeof width === "number" ? `${width}px` : width, maxInlineSize: "100%", overflow: "hidden" }}>{children(viewportWidth(width))}</Content>,
  };
}

function renderParts(context: DesignerSpecimenContext, host: ComponentSpecimenHost): SpecimenRenderParts {
  return {
    "studio.specimen-swatch": input => renderSpecimenSwatchHostPart(context, input),
    "studio.specimen-contrast": input => renderSpecimenContrastHostPart(context, input),
    "sections.specimen-variant-matrix": { renderComponentState: request => {
      // The cell's bound component drawn with its own dataset sample and the case's member props.
      const bound = componentSpecimenPreview({ modules: context.modules }).bind(request.leaf, context.profile);
      if ("refusal" in bound) return request.unavailable(`${bound.refusal.code}: ${bound.refusal.detail}`);
      const { binding } = bound, chosen = context.profile.components.components[request.leaf]!;
      const sample = componentSpecimenSample(componentSpecimenKey(chosen, binding.specifier, binding.exportName), binding.Component, binding.exports, host);
      if (!sample) return request.unavailable("No dataset sample content for the selected component.");
      const node = createElement(binding.Component, { ...sample.props, children: sample.children, ...request.props });
      return sample.host ? sample.host(node) : node;
    } },
    "sections.specimen-section-viewports": viewportParts(context),
    "sections.specimen-frame-viewports": viewportParts(context),
  };
}

function itemsOf(recipe: Recipe, variant: string, context: DesignerSpecimenContext, props: Omit<SpecimenLeafProps, "items">): { readonly items: readonly SpecimenItem[]; readonly axes?: readonly SpecimenAxis[] } {
  if (recipe.kind === "items") return { items: recipe.items };
  if (recipe.kind === "surface") return surfaceSpecimenItems(context, recipe.leaf);
  // One case: a single specimen draws without the variant grid, its disclosure or the show-all action.
  if (recipe.kind === "component") return { items: componentSpecimenItems(context, recipe.leaf).items.slice(0, 1) };
  const candidates = recipe.kind === "ramp" ? colorRampSpecimenItems(context, recipe.leaf) : tokenSpecimenItems(context, recipe.leaf);
  const definition = tokenAssetSpecimenLeaves[TOKEN_DEFINITION[variant === "default" ? "player" : variant] ?? -1];
  const admitted = definition ? candidates.find(item => !definition.validate({ ...props, items: [item] }).length) : undefined;
  return { items: admitted ? [admitted] : candidates.slice(0, 1) };
}

function SpecimenLeafSample({ node, recipes, host }: { readonly node: ReactElement<Record<string, unknown>>; readonly recipes: Recipes; readonly host: ComponentSpecimenHost }): ReactNode {
  const context = sampleContext(host);
  const variant = typeof node.props.variant === "string" ? node.props.variant : Object.hasOwn(recipes, "default") ? "default" : Object.keys(recipes)[0]!;
  const recipe = Object.hasOwn(recipes, variant) ? recipes[variant] : undefined;
  if (!recipe) return need({ leaf: variant, reason: `No dataset sample recipe for the ${variant} variant.` });
  const labels = { showAllVariants: (count: number) => host.copy ? readStudioCopy(host.copy, SPECIMEN_SHOW_ALL_COPY, { count }) : need({ leaf: SPECIMEN_SHOW_ALL_COPY.id, reason: "The show-all action needs the host's Writer resolver." }) };
  const props = { context, need, labels, renderParts: renderParts(context, host) };
  const { items, axes } = itemsOf(recipe, variant, context, props);
  const value = {
    profile: context.profile,
    selectionHash: context.profile.components.selectionHash,
    modules: context.modules,
    descriptors: Object.fromEntries(Object.entries(context.profile.components.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])),
  };
  return <ConsumerComponentProvider value={value}>{cloneElement(node, { ...props, items, ...(axes ? { axes } : {}) })}</ConsumerComponentProvider>;
}

/** A specimen leaf's sample: its section drawn inside the sample context, by the variant the row selects. */
export function specimenLeafSample(key: string, host: ComponentSpecimenHost, recipes: Recipes): ComponentSpecimenSample {
  return { props: {}, host: node => <SpecimenLeafSample key={key} node={node as ReactElement<Record<string, unknown>>} recipes={recipes} host={host} /> };
}

const memberOf = (context: DesignerSpecimenContext, slot: string, accept: (value: unknown) => boolean): ResolvedMember | undefined =>
  Object.values(context.profile.values.members).find(member => member.slot === slot && accept(member.value.light));

/** The inline player: the selected video and still from the sample context, with the dataset's Writer passage. */
export function mediaPlayerSample(host: ComponentSpecimenHost): ComponentSpecimenSample | undefined {
  const context = sampleContext(host), recipe = specimenDataset.mediaPlayer;
  const video = memberOf(context, recipe.video.slot, isVideoResource), poster = memberOf(context, recipe.poster.slot, isImageResource);
  if (!video || !poster) return undefined;
  return { props: { video: video.value.light, poster: poster.value.light, passage: recipe.passage } };
}

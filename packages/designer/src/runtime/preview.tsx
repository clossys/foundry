/**
 * Studio preview through the package runtime renderers: one surface fill entry (planned or adopted) drawn by
 * the same registered renderer the consumer runtime uses, from that renderer's specimen-dataset sample
 * content. Preview only: no runtime assembly, manifest, host or adoption evidence. A leaf without a
 * registered renderer, or a sample the fill does not map, yields a reason instead of a stand-in.
 */
import { standaloneComponents } from "../selected-components/standalone.js";
import { Fragment, type ReactNode } from "react";
import { SemanticContent } from "../selected-components/SemanticContent.js";
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import type { CompositeResolved } from "../catalog-core/types.js";
import { runtimeHash, SECTION_HEADER_CONTENT_KEY, type RuntimeContent, type RuntimeContentRef, type RuntimeFillDescriptor, type RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { specimenDataset } from "../studio/specimen-dataset.js";
import { surfaceRendererId } from "./contract.js";
import { surfaceRuntimeRenderers } from "./index.js";

/** The parts of a surface fill entry (sections.* or frames.* document entry) the preview reads. */
export interface SurfacePreviewEntry {
  readonly slot?: unknown;
  readonly slotMap?: unknown;
  readonly slots?: unknown;
  readonly propMap?: unknown;
  readonly members?: unknown;
}
export interface SurfaceRuntimePreviewOptions {
  /** Fill id shown on the descriptor; preview only. */
  readonly fill?: string;
  /** Selected members; the fill's defaults (none) when absent. */
  readonly members?: readonly string[];
  /** Board cell state; renderers that support it draw it, the rest draw default. */
  readonly state?: string;
  /** Explicit host copy for previewing renderers whose selected runtime requires resolved copy. */
  readonly sectionHost?: RuntimeRenderInput<ReactNode>["sectionHost"];
}

type SectionRow = { id: string; contract: { slots: readonly { name: string; type: string }[]; anatomy?: { band?: string | null } | null } };
const sectionRows = sectionSlots as unknown as readonly SectionRow[];
const sectionKinds = new Map(sectionRows.map(row => [row.id, new Map(row.contract.slots.map(slot => [slot.name, slot.type]))]));
/** Band leaf → the registered Sections whose contracts name it as their band, in id order. */
const bandChildren = (leaf: string) => sectionRows.filter(row => row.contract.anatomy?.band === leaf && Object.hasOwn(surfaceRuntimeRenderers, row.id)).map(row => row.id).sort();
const keys = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : value && typeof value === "object" ? Object.keys(value) : [];

/** The runtime renderer preview for one fill entry, or the reason there is none. */
export function surfaceRuntimePreview(entry: SurfacePreviewEntry, options: SurfaceRuntimePreviewOptions = {}): { leaf: string; render(): ReactNode } | { reason: string } {
  const leaf = typeof entry.slot === "string" ? entry.slot : "";
  const runtime = Object.hasOwn(surfaceRuntimeRenderers, leaf) ? surfaceRuntimeRenderers[leaf] : undefined;
  if (!runtime) return { reason: `no package runtime renderer for ${leaf || "this fill"}` };
  // An html/head/body renderer needs an isolated document, not invalid nested document roots in a board cell.
  if (leaf === "frames.document") return { reason: "frames.document preview requires an isolated document renderer" };
  const kind = leaf.startsWith("frames.") ? "frame" : "section";
  const slots = keys(entry.slotMap ?? entry.slots).sort(), members = keys(entry.members ?? entry.propMap).sort();
  const sample = runtime.sample(specimenDataset), kinds = sectionKinds.get(leaf);
  const content: Record<string, RuntimeContent> = {}, refs: Record<string, RuntimeContentRef> = {};
  for (const [slot, value] of Object.entries(sample)) {
    const header = kind === "section" && slot === SECTION_HEADER_CONTENT_KEY && !kinds?.has(slot);
    if (!header && !slots.includes(slot)) return { reason: `${leaf} sample content ${slot} is not mapped by this fill` };
    const reference: RuntimeContentRef = { kind: (header ? "copy" : kind === "frame" ? "region" : kinds?.get(slot) ?? "record") as RuntimeContentRef["kind"], ref: `specimen:${leaf}/${slot}` };
    content[slot] = { reference, value, hash: runtimeHash(value) };
    refs[slot] = reference;
  }
  // A band previews holding one Section its contract admits (the first registered one), drawn from that
  // Section's own sample, so the board shows the band around real content instead of an empty frame.
  const nested: ReactNode[] = [];
  for (const child of kind === "section" ? bandChildren(leaf) : []) {
    const childSample = surfaceRuntimeRenderers[child]!.sample(specimenDataset);
    const preview = surfaceRuntimePreview({ slot: child, slotMap: Object.fromEntries(Object.keys(childSample).map(slot => [slot, slot])) });
    if ("render" in preview) { nested.push(<Fragment key={child}>{preview.render()}</Fragment>); break; }
  }
  const frameSlots: Record<string, readonly ReactNode[]> = {};
  if (kind === "frame" && slots.includes("main") && leaf !== "frames.app-shell") {
    const child = leaf === "frames.auth-shell" ? "sections.sign-in-form" : "sections.content";
    const childSample = surfaceRuntimeRenderers[child]?.sample(specimenDataset);
    if (childSample) {
      const preview = surfaceRuntimePreview({ slot: child, slotMap: Object.fromEntries(Object.keys(childSample).map(slot => [slot, slot])) });
      if ("render" in preview) frameSlots.main = [<Fragment key={child}>{preview.render()}</Fragment>];
    }
  }
  const app = specimenDataset.frames.app;
  if (leaf === "frames.app-shell") frameSlots.main = [<SemanticContent as="section" key="app-main" className="flex flex-col gap-sm"><SemanticContent as="h2">{app.heading}</SemanticContent><SemanticContent as="p">{app.body}</SemanticContent></SemanticContent>];
  const fill = options.fill ?? `preview/${leaf}`, selected = options.members ?? [];
  const descriptor = { kind, library: "preview", fill, leaf, config: null, slots, members, states: ["default"], renderer: { id: surfaceRendererId(leaf) } } as unknown as RuntimeFillDescriptor;
  const input = {
    components: standaloneComponents, sectionHost: options.sectionHost,
    path: kind === "frame" ? "frame" : "sections.preview.0", fill: descriptor, cell: { theme: "light", state: options.state ?? "default", width: 1280 },
    selection: { leaf, fill, config: null, members: selected, content: refs }, content, slots: nested.length ? { children: nested } : frameSlots, profile: {} as CompositeResolved,
    ...(leaf === "frames.app-shell" ? { pageHeader: { id: "specimen.app-shell", data: { title: app.page }, module: { package: "@clossys/designer/shell", export: "PageHeaderModule" } } } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
  // The renderer's own content checks run here, so a refused sample is a reason, never a broken board cell.
  let node: ReactNode;
  try { node = runtime.render(input); } catch (error) { return { reason: error instanceof Error ? error.message : `${leaf} preview refused` }; }
  return { leaf, render: () => node };
}

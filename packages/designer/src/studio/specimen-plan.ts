import type { SpecimenAxis, SpecimenItem, SpecimenLeafId, SpecimenLeafProps } from "./specimen-layouts.js";
import type { SpecimenAgent, SpecimenCoverageCell } from "./specimen-coverage.js";
import { resolveSpecimenLeafBinding } from "./specimen-kind-map.js";
import { studioSpecimenLeaves } from "./specimen-registry.js";

/** Structural Producer source-plan port. The Designer package imports no host implementation. */
export interface NativeAgentSpecimenPlan {
  readonly cellId: string;
  readonly items: readonly Readonly<Record<string, unknown>>[];
  readonly expectedVariantIds: readonly string[];
  readonly issues: readonly string[];
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Preserve native identities and complete values; missing Designer data and Writer matrix axes remain NEEDs. */
export function projectAgentSpecimenPlan(input: {
  readonly agent: SpecimenAgent;
  readonly plan: NativeAgentSpecimenPlan;
  readonly specimen?: SpecimenLeafId;
  readonly axes?: readonly SpecimenAxis[];
}): { readonly cell: SpecimenCoverageCell; readonly issues: readonly string[] } {
  const { agent, plan } = input;
  const issues = [...plan.issues];
  const items: SpecimenItem[] = [];
  const pageAxes = new Map<string, string>(), viewportAxes = new Map<string, string>();
  for (const item of plan.items) {
    if (!text(item.id)) { issues.push("A native source item has no identity."); continue; }
    if (agent === "director" && item.kind === "director" && text(item.title) && text(item.value)) {
      items.push({ id: item.id, label: item.title, value: { passage: item.value } });
    } else if (agent === "writer" && item.kind === "writer" && text(item.role) && ["headline", "body", "cta", "nav", "error", "empty"].includes(item.role) && text(item.context) && text(item.locale) && text(item.value)) {
      const value = { role: item.role, context: item.context, locale: item.locale, dir: /^(?:ar|fa|he|ur|ps|dv|yi)(?:-|$)/i.test(item.locale) ? "rtl" : "ltr", ...(item.role === "body" ? { passage: item.value } : { text: item.value }) };
      items.push({ id: item.id, label: item.context, value, ...(object(item.coordinates) ? { coordinates: item.coordinates as Record<string, string> } : {}) });
    } else if (agent === "publisher" && item.kind === "publisher" && object(item.page) && text(item.page.id) && object(item.viewport) && text(item.viewport.id) && typeof item.viewport.width === "number" && typeof item.viewport.height === "number" && Number.isFinite(item.viewport.width) && Number.isFinite(item.viewport.height)) {
      const page = item.page.id, viewport = item.viewport.id;
      pageAxes.set(page, text(item.page.title) ? item.page.title : page); viewportAxes.set(viewport, viewport);
      items.push({ id: item.id, label: viewport, value: { pageId: page, viewport: { id: viewport, width: item.viewport.width, height: item.viewport.height, label: viewport } }, coordinates: { page, viewport } });
    } else issues.push(`Native ${agent} specimen item is unavailable or unsupported: ${item.id}`);
  }
  if (agent === "designer") issues.push("Designer specimens require the native Designer item enumeration.");
  if (!items.length) issues.push("The native source has no supported specimen items.");
  if (!plan.expectedVariantIds.length || new Set(plan.expectedVariantIds).size !== plan.expectedVariantIds.length) issues.push("The native source variant inventory is missing or repeats identities.");
  const ids = items.map(item => item.id);
  if (new Set(ids).size !== ids.length || ids.some(id => !plan.expectedVariantIds.includes(id)) || plan.expectedVariantIds.some(id => !ids.includes(id))) issues.push("One or more native source variants have no specimen item.");
  const axes = input.axes ?? (agent === "publisher" ? [{ id: "page", label: "Page", values: [...pageAxes].map(([id, label]) => ({ id, label })) }, { id: "viewport", label: "Viewport", values: [...viewportAxes].map(([id, label]) => ({ id, label })) }] : undefined);
  const kind = agent === "director" ? "passage" : agent === "writer" ? "copy" : agent === "publisher" ? "page" : "unknown";
  return { cell: { agent, id: plan.cellId, kind, layer: agent, items, ...(axes ? { axes } : {}), ...(input.specimen ? { specimen: input.specimen } : {}) }, issues };
}

/** Static host binding only. Actual rendered coverage still requires collectSpecimenDomEvidence. */
export function bindAgentSpecimenPlan(input: Parameters<typeof projectAgentSpecimenPlan>[0] & {
  readonly props: Omit<SpecimenLeafProps, "items" | "axes">;
  /** Must consult the host's actual selected native section registry. JS definition presence is insufficient. */
  readonly nativeRegistered: (id: SpecimenLeafId) => boolean;
}): {
  readonly sectionId?: string;
  readonly registered: boolean;
  readonly items: readonly SpecimenItem[];
  readonly variantIds: readonly string[];
  readonly cell: SpecimenCoverageCell;
  readonly issues: readonly string[];
} {
  const projection = projectAgentSpecimenPlan(input), issues = [...projection.issues];
  const binding = resolveSpecimenLeafBinding(projection.cell, studioSpecimenLeaves);
  if ("error" in binding) return { ...projection, registered: false, items: projection.cell.items, variantIds: [], issues: [...issues, binding.error] };
  const leaf = binding.leaf;
  if (typeof input.nativeRegistered !== "function" || !input.nativeRegistered(leaf.id)) issues.push("The bound leaf has no selected native registration.");
  const props = { ...input.props, items: projection.cell.items, axes: projection.cell.axes };
  for (const need of leaf.validate?.(props) ?? []) issues.push(`${need.leaf}: ${need.reason}`);
  return { sectionId: leaf.id, registered: issues.length === 0, items: projection.cell.items, variantIds: issues.length ? [] : projection.cell.items.map(item => item.id), cell: projection.cell, issues };
}

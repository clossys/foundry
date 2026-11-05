import { TAILWIND_BREAKPOINT_NAMES } from "@clossys/designer/catalog";
import { FORMAT_IDS, FORMAT_DELIVERY_IDS } from "./contract.js";
import type { FormatBindingFinding, FormatFinding, FormatIA, FormatLeaf } from "./contract.js";
import { formatLeaves } from "./slots/formats.js";
import { formatIA } from "./ia/formats.js";
import { LAYOUT_LEAVES } from "../layouts/resolve.js";
import type { LayoutLeaf } from "../layouts/contract.js";

export * from "./contract.js";
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const FORMAT_LEAVES: readonly FormatLeaf[] = freeze(formatLeaves);
export const FORMAT_IA: FormatIA = freeze(formatIA);
export function getFormatLeaf(id: string, registry: readonly FormatLeaf[] = FORMAT_LEAVES): FormatLeaf | undefined {
  return registry.find(leaf => leaf.id === id);
}
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const fields = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const names = (values: readonly string[]) => Array.isArray(values) && unique(values) && values.every(value => typeof value === "string" && value.length > 0 && value.trim() === value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const positive = (value: number) => Number.isFinite(value) && value > 0;
const integer = (value: number) => Number.isSafeInteger(value) && value > 0;
const BREAKPOINTS: readonly string[] = TAILWIND_BREAKPOINT_NAMES;
const MEDIA = ["screen", "email", "image", "document", "video", "deck"];

function data(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) return true;
  if (typeof value !== "object" || seen.has(value)) return false;
  const array = Array.isArray(value);
  if (![Object.prototype, null, ...(array ? [Array.prototype] : [])].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && Object.keys(descriptors).length !== value.length + 1) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === "length") continue;
    const descriptor = descriptors[key as string]!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !data(descriptor.value, seen)) return false;
  }
  seen.delete(value); return true;
}

/** Check configuration data against actual registered compositions; concepts cannot admit instances. */
export function checkFormatRegistry(registry: readonly FormatLeaf[] = FORMAT_LEAVES, tree: FormatIA = FORMAT_IA, layouts: readonly LayoutLeaf[] = LAYOUT_LEAVES): FormatFinding[] {
  if (!data(registry)) return [{ code: "contract", subject: "formats", message: "Format registry must be plain configuration data" }];
  if (!data(tree)) return [{ code: "ia", subject: "formats", message: "Format IA must be plain configuration data" }];
  try { return validateRegistry(registry, tree, layouts); }
  catch { return [{ code: "contract", subject: "formats", message: "Malformed format registry or IA" }]; }
}
function validateRegistry(registry: readonly FormatLeaf[], tree: FormatIA, layouts: readonly LayoutLeaf[]): FormatFinding[] {
  const findings: FormatFinding[] = [];
  const add = (code: FormatFinding["code"], subject: string, message: string) => findings.push({ code, subject, message });
  if (!unique(registry.map(leaf => leaf.id)) || registry.length !== FORMAT_IDS.length || FORMAT_IDS.some(id => !registry.some(leaf => leaf.id === id))) add("id", "formats", "Expected each registered format exactly once");
  for (const leaf of registry) findings.push(...leafFindings(leaf, layouts));
  const placements: string[] = [];
  if (!fields(tree, ["nodes"]) || !unique(tree.nodes.map(node => node.id)) || tree.nodes.length !== MEDIA.length || MEDIA.some(id => !tree.nodes.some(node => node.id === id))) add("ia", "formats", "Each medium must appear exactly once");
  for (const node of tree.nodes) {
    if (!fields(node, ["id", "label", "children"]) || !text(node.label) || !Array.isArray(node.children) || !node.children.length || !unique(node.children.map(group => group.id))) { add("ia", node.id, "Medium must contain unique families at level two"); continue; }
    for (const group of node.children) {
      if (!fields(group, ["id", "label", "leaves"]) || !text(group.id) || !text(group.label) || !Array.isArray(group.leaves) || !group.leaves.length) { add("ia", node.id, "Family must contain format leaves at exactly level three"); continue; }
      for (const id of group.leaves) {
        placements.push(id);
        const leaf = getFormatLeaf(id, registry);
        if (!leaf || leaf.medium !== node.id || leaf.family !== group.id) add("ia", id, "Format placement must match its medium and family");
      }
    }
  }
  if (!unique(placements) || placements.length !== registry.length || registry.some(leaf => !placements.includes(leaf.id))) add("ia", "formats", "Each format must appear exactly once at level three");
  return findings;
}

function leafFindings(leaf: FormatLeaf, layouts: readonly LayoutLeaf[]): FormatFinding[] {
  const findings: FormatFinding[] = [];
  const add = (code: FormatFinding["code"], subject: string, message: string) => findings.push({ code, subject, message });
  if (!(FORMAT_IDS as readonly string[]).includes(leaf.id)) add("id", leaf.id, "Unknown format id");
  if (!fields(leaf, ["id", "medium", "family", "label", "status", "outputType", "size", "deliveries", "fps", "arrangement", "allowedCompositions", "heldCompositions", "frames", "usedByPacks"]) ||
    !MEDIA.includes(leaf.medium) || !text(leaf.family) || !text(leaf.label) || !["built", "concept"].includes(leaf.status) ||
    !["html", "png", "pdf", "mp4", "slides"].includes(leaf.outputType) || !["page", "canvas", "paged", "panes"].includes(leaf.arrangement)) add("contract", leaf.id, "Invalid format metadata or executable/content field");
  const expectedDeliveries = FORMAT_DELIVERY_IDS[leaf.id] as readonly string[] | undefined;
  if (!Array.isArray(leaf.deliveries) || !expectedDeliveries || leaf.deliveries.length !== expectedDeliveries.length ||
    !unique(leaf.deliveries.map(delivery => delivery.id)) || expectedDeliveries.some(id => !leaf.deliveries.some(delivery => delivery.id === id))) add("contract", leaf.id, "Expected every registered delivery exactly once");
  else for (const delivery of leaf.deliveries) {
    const slides = delivery.id === "pptx" || delivery.id === "google-slides";
    if (!fields(delivery, ["id", "label", "status", "fidelityChoices"]) || !text(delivery.label) ||
      // This inventory contains no built exporter. A format renderer is not export proof.
      delivery.status !== "concept-only" || (slides ? !Array.isArray(delivery.fidelityChoices) ||
        delivery.fidelityChoices.length !== 2 || !delivery.fidelityChoices.includes("editable") || !delivery.fidelityChoices.includes("flat") : delivery.fidelityChoices !== undefined)) add("contract", leaf.id, "Unproven delivery or invalid slide fidelity choices");
  }
  const size = leaf.size;
  let validSize = false;
  if (size.kind === "responsive") validSize = fields(size, ["kind", "breakpoints"]) && names(size.breakpoints) && size.breakpoints.length > 0 && size.breakpoints.every(at => BREAKPOINTS.includes(at));
  if (size.kind === "fixed") validSize = fields(size, ["kind", "unit", "width", "height"]) && size.unit === "px" && integer(size.width) && (size.height === undefined || integer(size.height));
  if (size.kind === "paper") validSize = fields(size, ["kind", "unit", "width", "height"]) && size.unit === "mm" && positive(size.width) && positive(size.height);
  if (size.kind === "aspect-ratio") validSize = fields(size, ["kind", "width", "height"]) && integer(size.width) && integer(size.height);
  if (!validSize || (leaf.fps !== undefined && (!positive(leaf.fps) || leaf.outputType !== "mp4"))) add("contract", leaf.id, "Invalid size, units, breakpoint tokens or frame rate");
  if (![leaf.allowedCompositions, leaf.heldCompositions, leaf.frames, leaf.usedByPacks].every(names)) add("contract", leaf.id, "References must be unique nonempty names");
  for (const id of leaf.allowedCompositions) {
    const layout = layouts.find(entry => entry.id === id);
    if (!layout || !["draft", "stable"].includes(layout.status) || layout.contract.arrangement !== leaf.arrangement || leaf.heldCompositions.includes(id)) add("contract", leaf.id, "Allowed composition must be active and match the arrangement");
  }
  for (const id of leaf.heldCompositions) if (layouts.find(entry => entry.id === id)?.status !== "held") add("contract", leaf.id, "Held composition must be registered as held");
  if (leaf.status === "concept" && (leaf.allowedCompositions.length || leaf.frames.length || leaf.usedByPacks.length)) add("contract", leaf.id, "Concept formats have no compositions, frames or pack usage");
  if (leaf.status === "built" && (leaf.id !== "web.page.responsive" || leaf.arrangement !== "page" || leaf.outputType !== "html" || leaf.size.kind !== "responsive" || !leaf.allowedCompositions.length || !leaf.frames.length || leaf.frames.some(id => !["frames.site-shell", "frames.app-shell"].includes(id)))) add("contract", leaf.id, "Only responsive web pages have a built page-shell contract");
  return findings;
}

/** LK16 reads only the supplied format projection; an absent registry is never a catalog lookup. */
export function checkFormatBinding(formatId: unknown, layoutId: string, frameId: string, registry: unknown, layouts: readonly LayoutLeaf[]): readonly FormatBindingFinding[] {
  const refusal = (message: string): readonly FormatBindingFinding[] => [{ path: "format", message }];
  if (!text(formatId)) return refusal("An explicit registered format is required");
  if (!Array.isArray(registry) || !data(registry)) return refusal("A plain supplied format registry is required");
  try {
    const matches = registry.filter(leaf => leaf.id === formatId);
    if (matches.length !== 1) return refusal("Format must resolve exactly once in the supplied registry");
    const leaf = matches[0] as FormatLeaf;
    const problems: FormatBindingFinding[] = leafFindings(leaf, layouts).map(finding => ({ path: "format", message: finding.message }));
    if (leaf.status !== "built") problems.push({ path: "format", message: "Concept formats cannot have instances" });
    if (!(leaf.allowedCompositions as readonly string[]).includes(layoutId)) problems.push({ path: "layout", message: "Layout is not an allowed composition of this format" });
    if (!(leaf.frames as readonly string[]).includes(frameId)) problems.push({ path: "frame", message: "Frame does not match this format" });
    return problems;
  } catch { return refusal("Malformed supplied format contract"); }
}

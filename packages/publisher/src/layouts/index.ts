import { freeze, configProblems, LAYOUT_LEAVES } from "./resolve.js";
export { LAYOUT_LEAVES, getLayoutLeaf, getEffectiveLayoutContract } from "./resolve.js";
export type { EffectivePageLayoutContract } from "./resolve.js";
import ia from "./ia/layouts.json" with { type: "json" };
import retired from "./retired/layouts.json" with { type: "json" };
import { ARRANGEMENT_MODELS, LAYOUT_CONFIG_ID, LAYOUT_IDS, SECTION_ID, isLayoutId } from "./ids.js";
import type { LayoutFinding, LayoutIA, LayoutLeaf, RetiredLayout } from "./contract.js";

export * from "./ids.js";
export type * from "./contract.js";

export const LAYOUT_IA = freeze(ia as LayoutIA);
export const RETIRED_LAYOUTS = freeze(retired as Readonly<Record<string, RetiredLayout>>);
const PARTS = new Set(["sections.band", "sections.section-header", "sections.pagination"]);
const BREAKPOINTS = ["mobile", "mobile-lg", "tablet", "tablet-lg", "desktop", "wide"];
const READS = new Set(["tokens.spacing", "tokens.gutter", "tokens.content-size", "tokens.region-width", "tokens.breakpoint"]);
const SPANS = new Set(["1x1", "2x1", "1x2", "2x2"]);
const SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Validate acceptance against the caller's actual permanent section registry. */
export function checkLayoutRegistry(
  sectionLeafIds: readonly string[],
  registry: readonly LayoutLeaf[] = LAYOUT_LEAVES,
  tree: LayoutIA = LAYOUT_IA,
  aliases: Readonly<Record<string, RetiredLayout>> = RETIRED_LAYOUTS,
): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const add = (code: LayoutFinding["code"], subject: string, message: string) => findings.push({ code, subject, message });
  const sections = new Set(sectionLeafIds);
  if (!unique(registry.map((leaf) => leaf.id))) add("id", "layouts", "duplicate layout id");
  for (const id of LAYOUT_IDS) if (!registry.some((leaf) => leaf.id === id)) add("id", id, "missing layout leaf");
  for (const leaf of registry) {
    if (!isLayoutId(leaf.id) || leaf.layer !== "layouts") add("id", leaf.id, "unknown layout id or layer");
    if (!["draft", "stable", "held", "deprecated"].includes(leaf.status)) add("contract", leaf.id, "unknown status");
    if (leaf.id === "layouts.staggered-grid" && leaf.status !== "held") add("contract", leaf.id, "staggered-grid is held");
    const contract = leaf.contract;
    if (contract.kind !== "layout" || contract.arrangement !== "page" || !["site", "app", "both"].includes(contract.surface)) add("contract", leaf.id, "invalid page contract");
    if (!contract.slots.length || !unique(contract.slots.map((slot) => slot.id))) add("contract", leaf.id, "slots must be nonempty and unique");
    for (const [index, slot] of contract.slots.entries()) {
      const subject = `${leaf.id}/${slot.id}`;
      if (!SEGMENT.test(slot.id) || !count(slot.min) || !count(slot.max) || slot.min > slot.max) add("contract", subject, "invalid slot id or count range");
      if (!["first", "any", "last"].includes(slot.position) || (slot.position === "first" && index !== 0) || (slot.position === "last" && index !== contract.slots.length - 1)) add("contract", subject, "invalid slot reading position");
      if (!["bar", "panel", "rail", "tile"].includes(slot.previewShape)) add("contract", subject, "invalid preview shape");
      if (!slot.accepts.length || !unique(slot.accepts)) add("section", subject, "acceptance must be nonempty and unique");
      for (const id of slot.accepts) {
        const streamPart = leaf.id === "layouts.stack" && slot.id === "body" && (id === "sections.band" || id === "sections.section-header");
        if (!SECTION_ID.test(id) || !sections.has(id) || PARTS.has(id) && !streamPart) add("section", subject, `unregistered section leaf or part: ${id}`);
      }
      if (slot.tile && (!slot.tile.spans.length || !unique(slot.tile.spans) || slot.tile.spans.some((span) => !SPANS.has(span)))) add("contract", subject, "invalid tile spans");
    }
    for (const [id, values] of Object.entries(contract.members)) {
      if (!SEGMENT.test(id) || !values.length || !unique(values) || values.some((value) => typeof value !== "string" || !value.length)) add("contract", `${leaf.id}/${id}`, "invalid closed member");
    }
    if (!unique(contract.allowedReads) || contract.allowedReads.some((read) => !READS.has(read))) add("contract", leaf.id, "invalid layout token read");
    let previous = -1;
    for (const step of contract.reflow) {
      const at = BREAKPOINTS.indexOf(step.at.replace(/^tokens\.breakpoint\./, ""));
      if (!step.at.startsWith("tokens.breakpoint.") || at <= previous || !Number.isSafeInteger(step.columns) || step.columns < 1 || (step.spans !== undefined && step.spans !== "clamp")) add("contract", leaf.id, "invalid ordered token reflow");
      previous = at;
    }
    if (leaf.id === "layouts.bento" && contract.requiresSection?.container !== "adaptive") add("contract", leaf.id, "bento requires adaptive section containers");
    if (!unique(contract.configs.map((config) => config.id))) add("config", leaf.id, "duplicate config id");
    for (const config of contract.configs) {
      if (!LAYOUT_CONFIG_ID.test(config.id) || !config.id.startsWith(leaf.id.slice("layouts.".length) + ".")) add("config", config.id, "invalid config id or leaf ownership");
      for (const problem of configProblems(contract, config)) add("config", `${leaf.id}/${config.id}`, problem);
    }
  }
  if (tree.layer !== "layouts" || !unique(tree.nodes.map((node) => node.id)) || ARRANGEMENT_MODELS.some((id) => !tree.nodes.some((node) => node.id === id)) || tree.nodes.some((node) => !(ARRANGEMENT_MODELS as readonly string[]).includes(node.id))) add("ia", "layouts", "arrangement models must be exactly page, canvas, paged, panes");
  const placements: string[] = [];
  for (const node of tree.nodes) {
    if (!Array.isArray(node.children) || Object.keys(node).some((key) => !["id", "label", "children"].includes(key))) {
      add("ia", node.id, "arrangement groups must contain child groups, not direct leaves");
      continue;
    }
    if (!unique(node.children.map((group) => group.id))) add("ia", node.id, "duplicate child group id");
    for (const group of node.children) {
      const subject = `${node.id}/${group.id}`;
      if (!SEGMENT.test(group.id) || !group.label || !Array.isArray(group.leaves) || !group.leaves.length || Object.keys(group).some((key) => !["id", "label", "leaves"].includes(key))) {
        add("ia", subject, "child groups must contain layout leaves at exactly the third level");
        continue;
      }
      for (const id of group.leaves) {
        placements.push(id);
        const leaf = registry.find((entry) => entry.id === id);
        if (!leaf || node.id !== leaf.contract.arrangement) add("ia", subject, "leaf placement must match arrangement");
      }
    }
  }
  if (!unique(placements) || placements.length !== registry.length || registry.some((leaf) => !placements.includes(leaf.id))) add("ia", "layouts", "each leaf must appear exactly once");
  for (const [id, alias] of Object.entries(aliases)) {
    const leaf = registry.find((entry) => entry.id === alias.replacedBy);
    if (!leaf || leaf.status === "held" || leaf.status === "deprecated" || (alias.config && !leaf.contract.configs.some((config) => config.id === alias.config))) add("retired", id, "retired target or config does not resolve to an active layout");
  }
  return findings;
}

import { TAILWIND_BREAKPOINT_NAMES } from "@clossys/designer/catalog";
import { freeze, configProblems, LAYOUT_LEAVES } from "./resolve.js";
export { LAYOUT_LEAVES, getLayoutLeaf, getEffectiveLayoutContract } from "./resolve.js";
export type { EffectivePageLayoutContract } from "./resolve.js";
import { LAYOUT_CONFIG_ID, LAYOUT_IDS, SECTION_ID, isLayoutId } from "./ids.js";
import type { LayoutFinding, LayoutLeaf } from "./contract.js";

export * from "./ids.js";
export type * from "./contract.js";

const PARTS = new Set(["sections.band", "sections.section-header", "sections.pagination"]);
const BREAKPOINTS: readonly string[] = TAILWIND_BREAKPOINT_NAMES;
const READS = new Set(["themes.spacing"]);
const SPANS = new Set(["1x1", "2x1", "1x2", "2x2"]);
const SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Validate acceptance against the caller's actual permanent section registry. */
export function checkLayoutRegistry(
  sectionLeafIds: readonly string[],
  registry: readonly LayoutLeaf[] = LAYOUT_LEAVES,
): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const add = (code: LayoutFinding["code"], subject: string, message: string) => findings.push({ code, subject, message });
  const sections = new Set(sectionLeafIds);
  if (!unique(registry.map((leaf) => leaf.id))) add("id", "layouts", "duplicate layout id");
  for (const id of LAYOUT_IDS) if (!registry.some((leaf) => leaf.id === id)) add("id", id, "missing layout leaf");
  for (const leaf of registry) {
    if (!isLayoutId(leaf.id) || leaf.layer !== "layouts") add("id", leaf.id, "unknown layout id or layer");
    if (!["draft", "stable", "held", "deprecated"].includes(leaf.status)) add("contract", leaf.id, "unknown status");
    if (leaf.id === "staggered-grid" && leaf.status !== "held") add("contract", leaf.id, "staggered-grid is held");
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
        const streamPart = leaf.id === "stack" && slot.id === "body" && (id === "sections.band" || id === "sections.section-header");
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
      const at = BREAKPOINTS.indexOf(step.at);
      if (at < 0 || at <= previous || !Number.isSafeInteger(step.columns) || step.columns < 1 || (step.spans !== undefined && step.spans !== "clamp")) add("contract", leaf.id, "invalid ordered token reflow");
      previous = at;
    }
    if (leaf.id === "bento" && contract.requiresSection?.container !== "adaptive") add("contract", leaf.id, "bento requires adaptive section containers");
    if (!unique(contract.configs.map((config) => config.id))) add("config", leaf.id, "duplicate config id");
    for (const config of contract.configs) {
      if (!LAYOUT_CONFIG_ID.test(config.id) || !config.id.startsWith(leaf.id + ".")) add("config", config.id, "invalid config id or leaf ownership");
      for (const problem of configProblems(contract, config)) add("config", `${leaf.id}/${config.id}`, problem);
    }
  }
  return findings;
}

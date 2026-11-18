import { TAILWIND_BREAKPOINT_NAMES } from "@clossys/designer/catalog";
import { freeze, configProblems, LAYOUT_ENGINES } from "./resolve.js";
export { LAYOUT_ENGINES, getLayoutEngine, getEffectiveLayoutContract } from "./resolve.js";
export type { EffectivePageLayoutContract } from "./resolve.js";
import { ENGINE_CONFIG_ID, SECTION_ID } from "../layouts/ids.js";
import { ENGINE_KEYS, isEngineKey } from "./keys.js";
import type { LayoutFinding, LayoutEngine } from "./contract.js";

export * from "../layouts/ids.js";
export * from "./keys.js";
export * from "./layout-slots.js";
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
  registry: readonly LayoutEngine[] = LAYOUT_ENGINES,
): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const add = (code: LayoutFinding["code"], subject: string, message: string) => findings.push({ code, subject, message });
  const sections = new Set(sectionLeafIds);
  if (!unique(registry.map((leaf) => leaf.engine))) add("id", "layouts", "duplicate engine key");
  for (const id of ENGINE_KEYS) if (!registry.some((leaf) => leaf.engine === id)) add("id", id, "missing engine");
  for (const leaf of registry) {
    if (!isEngineKey(leaf.engine) || Object.hasOwn(leaf, "id") || Object.hasOwn(leaf, "layer")) add("id", String(leaf.engine), "unknown engine key, or an engine carrying slot identity");
    if (!["draft", "stable", "held", "deprecated"].includes(leaf.status)) add("contract", leaf.engine, "unknown status");
    if (leaf.engine === "staggered-grid" && leaf.status !== "held") add("contract", leaf.engine, "staggered-grid is held");
    const contract = leaf.contract;
    if (contract.kind !== "layout" || contract.arrangement !== "page" || !["site", "app", "both"].includes(contract.surface)) add("contract", leaf.engine, "invalid page contract");
    if (!contract.slots.length || !unique(contract.slots.map((slot) => slot.id))) add("contract", leaf.engine, "slots must be nonempty and unique");
    for (const [index, slot] of contract.slots.entries()) {
      const subject = `${leaf.engine}/${slot.id}`;
      if (!SEGMENT.test(slot.id) || !count(slot.min) || !count(slot.max) || slot.min > slot.max) add("contract", subject, "invalid slot id or count range");
      if (!["first", "any", "last"].includes(slot.position) || (slot.position === "first" && index !== 0) || (slot.position === "last" && index !== contract.slots.length - 1)) add("contract", subject, "invalid slot reading position");
      if (!["bar", "panel", "rail", "tile"].includes(slot.previewShape)) add("contract", subject, "invalid preview shape");
      if (!slot.accepts.length || !unique(slot.accepts)) add("section", subject, "acceptance must be nonempty and unique");
      for (const id of slot.accepts) {
        const streamPart = leaf.engine === "stack" && slot.id === "body" && (id === "sections.band" || id === "sections.section-header");
        if (!SECTION_ID.test(id) || !sections.has(id) || PARTS.has(id) && !streamPart) add("section", subject, `unregistered section leaf or part: ${id}`);
      }
      if (slot.tile && (!slot.tile.spans.length || !unique(slot.tile.spans) || slot.tile.spans.some((span) => !SPANS.has(span)))) add("contract", subject, "invalid tile spans");
    }
    for (const [id, values] of Object.entries(contract.members)) {
      if (!SEGMENT.test(id) || !values.length || !unique(values) || values.some((value) => typeof value !== "string" || !value.length)) add("contract", `${leaf.engine}/${id}`, "invalid closed member");
    }
    if (!unique(contract.allowedReads) || contract.allowedReads.some((read) => !READS.has(read))) add("contract", leaf.engine, "invalid layout token read");
    let previous = -1;
    for (const step of contract.reflow) {
      const at = BREAKPOINTS.indexOf(step.at);
      if (at < 0 || at <= previous || !Number.isSafeInteger(step.columns) || step.columns < 1 || (step.spans !== undefined && step.spans !== "clamp")) add("contract", leaf.engine, "invalid ordered token reflow");
      previous = at;
    }
    if (leaf.engine === "bento" && contract.requiresSection?.container !== "adaptive") add("contract", leaf.engine, "bento requires adaptive section containers");
    if (!unique(contract.configs.map((config) => config.id))) add("config", leaf.engine, "duplicate config id");
    for (const config of contract.configs) {
      if (!ENGINE_CONFIG_ID.test(config.id) || !config.id.startsWith(leaf.engine + ".")) add("config", config.id, "invalid config id or leaf ownership");
      for (const problem of configProblems(contract, config)) add("config", `${leaf.engine}/${config.id}`, problem);
    }
  }
  return findings;
}

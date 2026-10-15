import { planContentGrounds } from "./content-ground.js";
import { desugarRecipe, resolveRoleActionEmphasis } from "./sectioned-view.js";
import type { ComposeFinding } from "./types.js";
import type { SectionedViewDocument, SectionedViewSection, SectionedViewContentSection, ResolvedSectionedViewSection, SectionedViewContentActionEmphasis } from "./sectioned-view.js";

/** The structural shape of a hero or body band; no authored override. */
export type SectionShape = "hero" | "table" | "specimen" | "compare" | "grid" | "sequence" | "statement" | "reference" | "frame" | "list" | "proof";
export interface SectionWeight { weight: "hero" | "A" | "B" | "C"; shape: SectionShape }
export type SectionedViewFlowWarning = ComposeFinding & { severity: "warning" };
export interface CheckPageFlowOptions { callToAction?: { href: string } }

/** Derives weight from the current authored block vocabulary, independent of ground. */
export function sectionWeight(section: SectionedViewSection | ResolvedSectionedViewSection): SectionWeight {
  if (section.kind === "hero") return { weight: "hero", shape: "hero" };
  if (section.kind === "pricing") return { weight: "A", shape: "table" };
  if (section.kind !== "content-section") {
    switch (section.kind) {
      case "faq": return { weight: "C", shape: "reference" };
      case "feature-grid": return { weight: "C", shape: "list" };
      case "ordered-step-sequence": return { weight: "B", shape: "sequence" };
      case "status-list": return { weight: "B", shape: "table" };
      case "stat-grid":
      case "stat":
      case "testimonial": return { weight: "B", shape: "proof" };
      default: {
        const _: never = section;
        return _;
      }
    }
  }
  const layout = section.layout ?? "stacked";
  const split = layout === "split-start" || layout === "split-end";
  const block = section.block;
  if (section.media?.type === "record") return { weight: "B", shape: "table" };
  if (section.media?.type === "scene") return { weight: "A", shape: "specimen" };
  if (section.media !== undefined && !split) return { weight: "A", shape: "specimen" };
  switch (block?.type) {
    case "prose": return split && section.media !== undefined ? { weight: "B", shape: "specimen" } : { weight: "C", shape: "reference" };
    case "matrix": {
      if (block.sides.some((side) => side.visual !== undefined)) return { weight: "A", shape: "compare" };
      if (split && section.media !== undefined) return { weight: "B", shape: "specimen" };
      return { weight: "B", shape: "compare" };
    }
    case "items": {
      // Only structural axes enter desugaring; resolved copy has the same weight.
      const structural = { type: "items" as const, items: [], columns: block.columns, order: block.order, reveal: block.reveal, treatment: block.treatment, scale: block.scale };
      let axes;
      if (block.recipe !== undefined) axes = desugarRecipe({ ...structural, recipe: block.recipe, arrangement: block.arrangement });
      else {
        if (block.arrangement === undefined) throw new Error("Items require an arrangement or recipe.");
        axes = desugarRecipe({ ...structural, arrangement: block.arrangement });
      }
      const visual = block.items.some((item) => item.visual !== undefined);
      if (axes.scale === "statement") return { weight: "A", shape: "statement" };
      if (axes.order === "connected" || axes.order === "numbered") {
        if (visual) return { weight: "A", shape: "sequence" };
        if (split && section.media !== undefined) return { weight: "B", shape: "specimen" };
        return { weight: "B", shape: "sequence" };
      }
      if (visual) return { weight: "A", shape: axes.arrangement === "stacked" ? "specimen" : "grid" };
      if (axes.reveal === "disclose") return { weight: "C", shape: "reference" };
      if (split && section.media !== undefined) return { weight: "B", shape: "specimen" };
      if (axes.arrangement === "columns" && axes.treatment !== "plate" && block.items.length <= 4 && section.media === undefined && !split) return { weight: "C", shape: "list" };
      return { weight: "B", shape: axes.arrangement === "bento" || (axes.arrangement === "columns" && axes.treatment === "plate") ? "grid" : "list" };
    }
    case undefined: return section.media !== undefined ? { weight: "B", shape: "specimen" } : { weight: "C", shape: "frame" };
    default: {
      const _: never = block;
      return _;
    }
  }
}

/** Explicit emphasis wins; omitted emphasis follows the same structural weight as flow lint. */
export function resolveActionEmphasis(section: SectionedViewSection | ResolvedSectionedViewSection, index: number): SectionedViewContentActionEmphasis {
  if (section.kind === "hero") return resolveRoleActionEmphasis(section.actions?.[index]?.emphasis, index);
  if (section.kind === "content-section" && section.actions?.[index]?.emphasis !== undefined) return section.actions[index]!.emphasis!;
  const { weight, shape } = sectionWeight(section);
  return weight === "A" ? (index === 0 ? "secondary" : "quiet") : weight === "B" || shape === "frame" ? "tertiary" : "quiet";
}

/** Mirrors the linked-item validator's destination comparison. */
function destination(href: string): string {
  const hash = href.indexOf("#");
  const base = hash > 0 ? href.slice(0, hash) : href;
  return base.length > 1 && base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * Advisory flow checks for a valid sectioned document whose first section is
 * a hero. Body positions exclude that hero; the close is supplied separately.
 * Callers own header target matching. This function never renders or mutates.
 */
export function checkPageFlow(document: SectionedViewDocument, options: CheckPageFlowOptions = {}): SectionedViewFlowWarning[] {
  if (document.sections[0]?.kind !== "hero") return [];
  const grounds = planContentGrounds([document], { callToAction: options.callToAction === undefined ? false : true }).bands;
  const body = document.sections.slice(1).map((section, index) => ({ section, ...sectionWeight(section), path: `sections.${index + 1}` }));
  const findings: SectionedViewFlowWarning[] = [];
  const warn = (code: string, path: string, message: string) => findings.push({ rule: `sectioned-view-flow-${code}`, severity: "warning", path, message: `${path} ${message}` });
  const n = body.length;
  if (n >= 3 && !body.slice(0, 2).some((band) => band.weight === "A")) warn("opening-set-piece", body[0]!.path, "opens on low-impact bands; move a set piece into the first two body bands.");
  const openingA = body.slice(0, 3).filter((band) => band.weight === "A");
  openingA.slice(1).forEach((band) => warn("opening-crowded", band.path, "adds a second early set piece; move it below the first three body bands."));
  if (body[0]?.weight === "C" && !(body[0].shape === "frame" && body[1]?.weight === "A")) warn("opening-pause", body[0].path, "stalls the opening; use a frame followed by a set piece or move the breather down.");
  if (body[1]?.weight === "C") warn("opening-pause", body[1].path, "puts a breather in the second body band; move it down.");
  body.forEach((band, index) => {
    const previous = body[index - 1];
    if (previous?.weight === "A" && band.weight === "A") warn("set-piece-run", band.path, "touches another set piece; put a supporting band or breather between them.");
    if (previous?.weight === "C" && band.weight === "C") warn("pause-run", band.path, "follows another breather; merge them or move one.");
    if (band.weight === "B" && previous?.weight === "B" && body[index - 2]?.weight === "B") warn("support-run", band.path, "is a third consecutive supporting band; add a breather or promote one to a set piece.");
  });
  const setPieces = body.filter((band) => band.weight === "A");
  setPieces.forEach((band, index) => {
    if (setPieces[index - 1]?.shape === band.shape) warn("set-piece-shape", band.path, `repeats the ${band.shape} shape of the previous set piece; vary its shape.`);
  });
  const minA = n < 3 ? 0 : n < 6 ? 1 : 2;
  const maxA = Math.ceil(n / 3);
  if (setPieces.length < minA || setPieces.length > maxA) warn("set-piece-count", "sections", `has ${setPieces.length} set pieces across ${n} body bands; use ${minA}-${maxA}.`);
  const pauses = body.filter((band) => band.weight === "C").length;
  const minC = n >= 5 ? 1 : 0;
  if (pauses < minC || pauses > Math.ceil(n / 3)) warn("pause-count", "sections", `has ${pauses} breathers across ${n} body bands; use ${minC}-${Math.ceil(n / 3)}.`);
  const last = body[n - 1];
  if (last?.weight === "A" && last.shape !== "proof") warn("closing-band", last.path, "competes with the close; end on a supporting band, breather or proof set piece.");
  body.forEach((band, index) => {
    if (grounds[index + 1]?.ground === "inverse" && (band.weight !== "A" || band.shape !== "statement" || index === 0 || index === n - 1)) warn("inverse-weight", band.path, "uses inverse outside a middle statement set piece; change the ground or move the statement away from the first and last body bands.");
  });
  const primaryTargets: { href: string; path: string }[] = [];
  document.sections[0].actions?.forEach((action, index) => {
    if (resolveActionEmphasis(document.sections[0]!, index) === "primary") primaryTargets.push({ href: action.href, path: `sections.0.actions.${index}.href` });
  });
  body.forEach((band, index) => {
    if (band.section.kind !== "content-section") return;
    band.section.actions?.forEach((action, actionIndex) => {
      if (action.emphasis !== "primary") return;
      const path = `${band.path}.actions.${actionIndex}`;
      if (band.weight !== "A" || index >= n - 2) warn("primary-placement", path, "places a primary action outside an early set piece; use a quieter emphasis or move it before the last two body bands.");
      primaryTargets.push({ href: action.href, path: `${path}.href` });
    });
  });
  if (options.callToAction !== undefined) primaryTargets.push({ href: options.callToAction.href, path: "callToAction.href" });
  primaryTargets.slice(1).forEach((target) => {
    if (destination(target.href) !== destination(primaryTargets[0]!.href)) warn("primary-target", target.path, "points to a different primary destination; share one main-action target with the hero and close.");
  });
  body.forEach((band) => {
    if (band.section.kind !== "content-section") return;
    const actions = band.section.actions ?? [];
    const maxActions = band.weight === "A" ? 2 : 1;
    const ceiling = band.weight === "A" ? "primary or secondary, then quiet" : band.shape === "frame" || band.weight === "B" ? "tertiary or quiet" : "quiet";
    if (actions.length > maxActions) warn("action-weight", `${band.path}.actions`, `has ${actions.length} actions; use at most ${maxActions} section actions with ${ceiling} emphasis.`);
    actions.forEach((action, index) => {
      const emphasis = resolveActionEmphasis(band.section, index);
      const fits = band.weight === "A" ? (index === 0 || emphasis === "quiet") : band.weight === "B" || band.shape === "frame" ? emphasis === "tertiary" || emphasis === "quiet" : emphasis === "quiet";
      if (!fits) warn("action-weight", `${band.path}.actions.${index}`, `exceeds this band's ceiling; use ${ceiling}, with at most ${maxActions} section actions.`);
    });
    // Linked cards are quiet (T4), allowed at every weight; their count is
    // independent of section actions and is governed by linked-item validation.
  });
  let groups = 0;
  const seen = new Map<string, string>();
  const link = (href: string, path: string) => {
    const key = destination(href);
    const first = seen.get(key);
    if (first !== undefined) warn("link-repeat", path, `repeats destination ${key} from ${first}; keep each body destination once.`);
    else seen.set(key, path);
  };
  body.forEach((band) => {
    if (band.section.kind !== "content-section") return;
    const section: SectionedViewContentSection = band.section;
    const block = section.block;
    if (block?.type === "items") {
      const items = block.items;
      if (items.some((item) => item.href !== undefined)) {
        groups += 1;
        if (groups > 2) warn("link-groups", `${band.path}.block`, "adds a third linked block; keep at most two linked body blocks.");
        items.forEach((item, index) => { if (typeof item.href === "string") link(item.href, `${band.path}.block.items.${index}.href`); });
      }
    }
    section.actions?.forEach((action, index) => link(action.href, `${band.path}.actions.${index}.href`));
    if (section.footnote?.link !== undefined) link(section.footnote.link.href, `${band.path}.footnote.link.href`);
  });
  return findings;
}

import type { CopyRef } from "@clossys/writer";
import type { ContentAssetContract } from "./content-asset.js";
import type { ContentIconName, SectionedViewSpecimenPanel, SectionedViewSpecimenPart, SectionedViewSpecimenStatus, SectionedViewSpecimenTone } from "./sectioned-view.js";

/** Shared authored and renderer-facing vocabulary; recipes resolve into these axes. */
export const SECTIONED_VIEW_CONTENT_CONTRACT = Object.freeze({
  sizes: Object.freeze(["standard", "display"] as const),
  layouts: Object.freeze(["stacked", "split-start", "split-end"] as const),
  arrangements: Object.freeze(["columns", "rows", "bento", "stacked"] as const),
  orders: Object.freeze(["none", "numbered", "connected"] as const),
  reveals: Object.freeze(["all", "disclose"] as const),
  treatments: Object.freeze(["plain", "rule", "plate"] as const),
  scales: Object.freeze(["item", "statement"] as const),
  tones: Object.freeze(["neutral", "success", "warning", "danger", "info"] as const),
  recipes: Object.freeze(["features", "statement", "cards", "topics", "link-index", "faq", "steps", "specimen-stack"] as const),
  spans: Object.freeze({ third: 4, half: 6, "two-thirds": 8, full: 12 }),
  columnOptions: Object.freeze([2, 3] as const),
  rowColumnOptions: Object.freeze([1, 2] as const),
  prose: Object.freeze({ paragraphs: 8, linksPerParagraph: 6, spansPerParagraph: 24, charactersPerParagraph: 1200 }),
  counts: Object.freeze({ columns: Object.freeze([2, 6] as const), groups: Object.freeze([2, 4] as const), groupItems: Object.freeze([2, 4] as const), laneDefinitions: 2, columns2: Object.freeze([2, 4, 6]), columns3: Object.freeze([3, 6]), rows: Object.freeze([2, 8] as const), bento: Object.freeze([2, 6] as const), stacked: Object.freeze([2, 4] as const), connected: Object.freeze([3, 5] as const), disclose: Object.freeze([4, 6] as const), matrix: 2, points: Object.freeze([2, 4] as const), linked: 6, rowUnits: 12 }),
});
export type FrameSize = typeof SECTIONED_VIEW_CONTENT_CONTRACT.sizes[number];
export type FrameLayout = typeof SECTIONED_VIEW_CONTENT_CONTRACT.layouts[number];
export type ItemsRecipe = typeof SECTIONED_VIEW_CONTENT_CONTRACT.recipes[number];
export type SectionedViewItemsArrangement = typeof SECTIONED_VIEW_CONTENT_CONTRACT.arrangements[number];
export type SectionedViewItemsOrder = typeof SECTIONED_VIEW_CONTENT_CONTRACT.orders[number];
export type SectionedViewItemsReveal = typeof SECTIONED_VIEW_CONTENT_CONTRACT.reveals[number];
export type SectionedViewItemsTreatment = typeof SECTIONED_VIEW_CONTENT_CONTRACT.treatments[number];
export type SectionedViewItemsScale = typeof SECTIONED_VIEW_CONTENT_CONTRACT.scales[number];
export type SectionedViewItemSpan = keyof typeof SECTIONED_VIEW_CONTENT_CONTRACT.spans;
export interface SectionedViewBadge { label: CopyRef; tone?: SectionedViewSpecimenTone }
/** One data-only item. Arrangement and recipe determine which optional slots apply. */
export interface SectionedViewItem {
  id: string;
  heading: CopyRef;
  description?: CopyRef;
  eyebrow?: CopyRef;
  icon?: ContentIconName;
  meta?: CopyRef;
  visual?: SectionedViewSpecimenPart;
  href?: string;
  span?: SectionedViewItemSpan;
  lane?: string;
  badge?: SectionedViewBadge;
}
export interface SectionedViewItemGroup { id: string; label: CopyRef; items: string[] }
export interface SectionedViewItemLane { id: string; label: CopyRef }
interface ItemsFields {
  type: "items";
  columns?: 1 | 2 | 3;
  order?: SectionedViewItemsOrder;
  reveal?: SectionedViewItemsReveal;
  treatment?: SectionedViewItemsTreatment;
  scale?: SectionedViewItemsScale;
  items: SectionedViewItem[];
  groups?: SectionedViewItemGroup[];
  lanes?: SectionedViewItemLane[];
  end?: "ends" | "continues";
  endLabel?: CopyRef;
  caption?: CopyRef;
}
export type SectionedViewItemsBlock = ItemsFields & (
  | { recipe: ItemsRecipe; arrangement?: SectionedViewItemsArrangement }
  | { recipe?: never; arrangement: SectionedViewItemsArrangement }
);
/** Canonical recipe output always names every layout axis. */
export type CanonicalSectionedViewItemsBlock = Omit<SectionedViewItemsBlock, "arrangement" | "order" | "reveal" | "treatment" | "scale"> & {
  arrangement: SectionedViewItemsArrangement;
  order: SectionedViewItemsOrder;
  reveal: SectionedViewItemsReveal;
  treatment: SectionedViewItemsTreatment;
  scale: SectionedViewItemsScale;
};
export type SectionedViewMatrixSide = { id: string; label?: CopyRef; heading: CopyRef; description?: CopyRef } & (
  | { points: CopyRef[]; visual?: never }
  | { visual: SectionedViewSpecimenPanel; points?: never }
);
export interface SectionedViewMatrixBlock { type: "matrix"; recipe?: "comparison"; sides: SectionedViewMatrixSide[]; featured?: string }
/** Visible span text resolves through Writer; destinations use Publisher's shared href policy. */
export type SectionedViewProseSpan =
  | { type: "text"; text: CopyRef }
  | { type: "link"; text: CopyRef; href: string };
/** One to eight paragraphs, each with at most 24 spans, six links and 1200 resolved characters. */
export interface SectionedViewProseBlock { type: "prose"; paragraphs: SectionedViewProseSpan[][] }
export interface SectionedViewSpecimenKeyItem { id: string; target: string; heading: CopyRef; description: CopyRef }
export interface SectionedViewSpecimenKey { label: CopyRef; items: SectionedViewSpecimenKeyItem[] }
export interface SectionedViewSpecimenMedia { type: "specimen"; label: CopyRef; panel: SectionedViewSpecimenPanel; key?: SectionedViewSpecimenKey }
export interface SectionedViewLedgerRow { id: string; label: CopyRef; detail?: CopyRef; status?: SectionedViewSpecimenStatus; flag?: boolean }
export type SectionedViewLedgerGroup = { id: string; label: CopyRef } & (
  | { rows: SectionedViewLedgerRow[]; owner?: never; note?: never }
  | { owner: { initials: CopyRef; name: CopyRef; note?: CopyRef }; note?: CopyRef; rows?: never }
);
export interface SectionedViewRecordMedia { type: "record"; id: string; head: { title: CopyRef; meta?: CopyRef; status?: SectionedViewSpecimenStatus }; columns?: 1 | 2 | 3; groups: SectionedViewLedgerGroup[]; caption: CopyRef; flagLabel?: CopyRef }
export type SectionedViewSceneFormat = "pdf" | "email" | "sheet" | "doc" | "note" | "scan" | "calendar";
export interface SectionedViewSceneDocument { id: string; format: SectionedViewSceneFormat; title: CopyRef; origin?: CopyRef }
export interface SectionedViewSceneRow { id: string; label: CopyRef; value: CopyRef; status?: SectionedViewSpecimenTone; figure?: boolean; quiet?: boolean }
export interface SectionedViewSceneStatus { tone: SectionedViewSpecimenTone; text: CopyRef }
export interface SectionedViewScenePerson { initials: string; name: CopyRef; note: CopyRef }
export interface SectionedViewSceneConvergeInput {
  template: "converge"; seed: string; disorder?: "none" | "low" | "medium";
  sources: { heading: CopyRef; items: SectionedViewSceneDocument[] };
  target: { heading: CopyRef; title: CopyRef; meta?: CopyRef; rows: SectionedViewSceneRow[] };
  relations: { from: string; to: string; emphasis?: true }[];
}
export interface SectionedViewSceneEvidenceTrailInput {
  template: "evidence-trail"; seed: string; disorder?: "none" | "low";
  sources: (SectionedViewSceneDocument & { cites: string; cite: CopyRef })[];
  result: { title: CopyRef; meta?: CopyRef; rows: SectionedViewSceneRow[]; status: SectionedViewSceneStatus; person?: SectionedViewScenePerson };
}
export interface SectionedViewSceneApprovalChainInput {
  template: "approval-chain"; seed: string; disorder?: "none" | "low";
  prepared: { heading: CopyRef; meta?: CopyRef };
  findings: { id: string; fn: CopyRef; title: CopyRef; subjectOf: CopyRef; status: SectionedViewSceneStatus; subject?: true }[];
  node: { label: CopyRef };
  decision: { title: CopyRef; meta?: CopyRef; status: SectionedViewSceneStatus; rows: SectionedViewSceneRow[]; person: SectionedViewScenePerson };
}
export type SectionedViewSceneInput = SectionedViewSceneConvergeInput | SectionedViewSceneEvidenceTrailInput | SectionedViewSceneApprovalChainInput;
export interface SectionedViewSceneMedia { type: "scene"; label: CopyRef; relationLabel?: CopyRef; input: SectionedViewSceneInput }
/** Consumer-owned image or video data, rendered by the existing media slot. */
export type SectionedViewAssetMedia = { type: "asset"; assetId: string; contract: ContentAssetContract; caption?: CopyRef } & (
  | { purpose: "meaningful"; alt: CopyRef }
  | { purpose: "decorative"; alt?: never; contract: ContentAssetContract & { format: Extract<ContentAssetContract["format"], `image/${string}`> } }
);
export type SectionedViewMedia = SectionedViewSpecimenMedia | SectionedViewRecordMedia | SectionedViewSceneMedia | SectionedViewAssetMedia;

interface Recipe {
  readonly fixed: Readonly<Partial<Record<"arrangement" | "order" | "reveal" | "treatment" | "scale" | "columns", string | number>>>;
  readonly defaults?: Readonly<Partial<Record<"arrangement" | "columns" | "treatment", string | number>>>;
  readonly treatments?: readonly string[];
  readonly slots: readonly string[];
  readonly requiredSlot?: "href" | "visual";
}
function freezeRecipes(recipes: Record<ItemsRecipe, Recipe>): Readonly<Record<ItemsRecipe, Recipe>> {
  for (const recipe of Object.values(recipes)) {
    Object.freeze(recipe.fixed);
    if (recipe.defaults !== undefined) Object.freeze(recipe.defaults);
    if (recipe.treatments !== undefined) Object.freeze(recipe.treatments);
    Object.freeze(recipe.slots);
    Object.freeze(recipe);
  }
  return Object.freeze(recipes);
}
/** Recipe constraints are shared by desugaring and slot validation. Badge is independent metadata. */
export const SECTIONED_VIEW_ITEM_RECIPES: Readonly<Record<ItemsRecipe, Recipe>> = freezeRecipes({
  features: { fixed: { arrangement: "columns", order: "none", reveal: "all", scale: "item" }, defaults: { columns: 3 }, slots: ["icon", "eyebrow", "href"] },
  statement: { fixed: { arrangement: "columns", columns: 3, order: "none", reveal: "all", scale: "statement" }, treatments: ["plain", "rule"], slots: [] },
  cards: { fixed: { arrangement: "bento", order: "none", reveal: "all" }, defaults: { treatment: "rule" }, treatments: ["rule", "plate"], slots: ["eyebrow", "visual", "href", "meta", "span"] },
  topics: { fixed: { arrangement: "rows", order: "none", reveal: "all", treatment: "rule" }, defaults: { columns: 1 }, slots: ["icon", "href", "groups"] },
  "link-index": { fixed: { arrangement: "columns", order: "none", reveal: "all", treatment: "plate" }, defaults: { columns: 3 }, slots: ["href", "icon"], requiredSlot: "href" },
  faq: { fixed: { arrangement: "rows", order: "none", reveal: "disclose", treatment: "rule" }, slots: [] },
  steps: { fixed: { order: "connected", reveal: "all", treatment: "plain" }, defaults: { arrangement: "columns" }, slots: ["meta", "visual", "lane"] },
  "specimen-stack": { fixed: { arrangement: "stacked", order: "none", reveal: "all", treatment: "rule" }, slots: ["visual"], requiredSlot: "visual" },
});

/** Fill recipe defaults; explicit fixed-axis conflicts are refused before canonical validation. */
export function desugarRecipe(block: SectionedViewItemsBlock): CanonicalSectionedViewItemsBlock {
  if (block === null || typeof block !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(block))) throw new Error("recipe-axis: expected a plain items block.");
  if (Reflect.ownKeys(block).some((key) => typeof key !== "string" || !Object.getOwnPropertyDescriptor(block, key)?.enumerable || !("value" in Object.getOwnPropertyDescriptor(block, key)!))) throw new Error("recipe-axis: expected own enumerable data fields.");
  if (Object.hasOwn(block, "emphasis")) throw new Error("recipe-axis: emphasis is retired; use scale.");
  if ((block as { recipe?: unknown }).recipe === "flow") throw new Error("recipe-axis: flow is retired; use steps with arrangement: stacked.");
  if (block.recipe !== undefined && typeof block.recipe !== "string") throw new Error("recipe-axis: recipe must be a known string.");
  const recipe = block.recipe === undefined ? undefined : Object.hasOwn(SECTIONED_VIEW_ITEM_RECIPES, block.recipe) ? SECTIONED_VIEW_ITEM_RECIPES[block.recipe] : undefined;
  if (block.recipe !== undefined && recipe === undefined) throw new Error(`recipe-axis: unknown recipe ${String(block.recipe)}.`);
  for (const [axis, value] of Object.entries(recipe?.fixed ?? {})) if ((block as unknown as Record<string, unknown>)[axis] !== undefined && (block as unknown as Record<string, unknown>)[axis] !== value) throw new Error(`recipe-axis: ${block.recipe} fixes ${axis} to ${value}.`);
  const canonical = { order: "none", reveal: "all", treatment: "plain", scale: "item", ...recipe?.defaults, ...recipe?.fixed, ...Object.fromEntries(Object.entries(block).filter(([, value]) => value !== undefined)) } as CanonicalSectionedViewItemsBlock;
  if (canonical.arrangement === "columns" && canonical.columns === undefined) canonical.columns = 3;
  if (canonical.arrangement === "rows" && canonical.columns === undefined) canonical.columns = 1;
  if (recipe?.treatments !== undefined && !recipe.treatments.includes(canonical.treatment)) throw new Error(`recipe-axis: ${block.recipe} treatment must be ${recipe.treatments.join(" or ")}.`);
  return canonical;
}

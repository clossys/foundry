/**
 * Shared content readers for the group-a Section runtime renderers. A renderer receives the assembly's
 * RuntimeRenderInput: plain JSON content keyed by contract slot and the selected members. These readers
 * turn that JSON into the props of the real registered blocks and components, and refuse (throw) rather
 * than drop anything the fill does not map: a content slot outside the fill, a member outside the
 * renderer's declared inputs, or a value of the wrong shape. Nothing here renders markup of its own.
 */
import type { ReactNode } from "react";
import { BarChart } from "../../charts/BarChart.js";
import { LineChart } from "../../charts/LineChart.js";
import { Link } from "../../components/Link.js";
import { Logomark } from "../../components/Logomark.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";

export type SectionRenderInput = RuntimeRenderInput<ReactNode>;
export type SectionRenderer = (input: SectionRenderInput) => ReactNode;
/** The contract slots and members a renderer reads: exactly the fill's slotMap and propMap keys. */
export interface SectionRendererInputs { readonly slots: readonly string[]; readonly members: readonly string[] }
export type JsonObject = { readonly [key: string]: RuntimeJson };

export class SectionContentError extends Error {
  constructor(leaf: string, message: string) { super(`${leaf}: ${message}`); this.name = "SectionContentError"; }
}

/** One leaf's checked content: the slot values the fill maps, and the selected members. */
export interface SectionContent {
  readonly leaf: string;
  readonly values: Readonly<Record<string, RuntimeJson>>;
  readonly members: readonly string[];
}

/** Refuses a foreign leaf, an unmapped content slot or an undeclared member; never drops one silently. */
export function readSectionContent(input: SectionRenderInput, leaf: string, inputs: SectionRendererInputs): SectionContent {
  if (input.fill.leaf !== leaf || input.selection.leaf !== leaf) throw new SectionContentError(leaf, `renderer received ${input.fill.leaf}`);
  const values: Record<string, RuntimeJson> = {};
  for (const [slot, content] of Object.entries(input.content)) {
    if (!inputs.slots.includes(slot) || !input.fill.slots.includes(slot)) throw new SectionContentError(leaf, `content slot ${slot} is not mapped by this fill`);
    values[slot] = content.value;
  }
  for (const member of input.selection.members) if (!inputs.members.includes(member) || !input.fill.members.includes(member)) throw new SectionContentError(leaf, `member ${member} is not mapped by this fill`);
  return { leaf, values, members: input.selection.members };
}

export function object(content: SectionContent, value: RuntimeJson | undefined, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SectionContentError(content.leaf, `${path} must be an object`);
  return value as JsonObject;
}
export function list(content: SectionContent, value: RuntimeJson | undefined, path: string): readonly RuntimeJson[] {
  if (!Array.isArray(value) || !value.length) throw new SectionContentError(content.leaf, `${path} must be a non-empty list`);
  return value;
}
export function text(content: SectionContent, value: RuntimeJson | undefined, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new SectionContentError(content.leaf, `${path} must be text`);
  return value;
}
export function optionalText(content: SectionContent, value: RuntimeJson | undefined, path: string): string | undefined {
  return value === undefined || value === null ? undefined : text(content, value, path);
}
export function numbers(content: SectionContent, value: RuntimeJson | undefined, path: string): readonly number[] {
  const values = list(content, value, path);
  if (values.some(item => typeof item !== "number" || !Number.isFinite(item))) throw new SectionContentError(content.leaf, `${path} must hold finite numbers`);
  return values as readonly number[];
}
export function texts(content: SectionContent, value: RuntimeJson | undefined, path: string): readonly string[] {
  return list(content, value, path).map((item, index) => text(content, item, `${path}.${index}`));
}
/** A required slot's value; the assembly already refuses a missing required slot, this keeps the renderer honest. */
export function required(content: SectionContent, slot: string): RuntimeJson {
  const value = content.values[slot];
  if (value === undefined) throw new SectionContentError(content.leaf, `required content slot ${slot} is missing`);
  return value;
}

/** The one selected value on a member axis (`layout.split` gives `split`), or undefined; two on one axis is refused. */
export function memberValue<Value extends string>(content: SectionContent, axis: string, allowed: readonly Value[]): Value | undefined {
  const chosen = content.members.filter(member => member.startsWith(`${axis}.`)).map(member => member.slice(axis.length + 1));
  if (chosen.length > 1) throw new SectionContentError(content.leaf, `more than one ${axis} member selected`);
  if (chosen[0] !== undefined && !(allowed as readonly string[]).includes(chosen[0])) throw new SectionContentError(content.leaf, `unknown ${axis} member ${chosen[0]}`);
  return chosen[0] as Value | undefined;
}

const LINK_VARIANTS = ["primary", "secondary", "outline", "ghost", "tonal", "quiet"] as const;
type ActionVariant = (typeof LINK_VARIANTS)[number];
/** An action record `{ label, href, variant? }`, rendered by the registered Link in its button look. */
export function actionNode(content: SectionContent, value: RuntimeJson | undefined, path: string, fallback: ActionVariant): ReactNode {
  const action = object(content, value, path);
  const variant = action.variant === undefined ? fallback : text(content, action.variant, `${path}.variant`);
  if (!(LINK_VARIANTS as readonly string[]).includes(variant)) throw new SectionContentError(content.leaf, `${path}.variant ${variant} is not a link button variant`);
  return <Link href={text(content, action.href, `${path}.href`)} buttonVariant={variant as ActionVariant}>{text(content, action.label, `${path}.label`)}</Link>;
}

/**
 * A media record rendered by a registered component: `{ kind: "chart", chart: "bar" | "line", ... }` draws the
 * dataset series through the chart leaves, `{ kind: "mark", src, title }` the brand mark through components.logo.
 */
export function mediaNode(content: SectionContent, value: RuntimeJson | undefined, path: string): ReactNode {
  const media = object(content, value, path);
  const kind = text(content, media.kind, `${path}.kind`);
  if (kind === "mark") return <Logomark src={text(content, media.src, `${path}.src`)} size="lg" title={text(content, media.title, `${path}.title`)} />;
  if (kind !== "chart") throw new SectionContentError(content.leaf, `${path}.kind ${kind} has no registered media component`);
  const title = text(content, media.title, `${path}.title`);
  const series = list(content, media.series, `${path}.series`).map((row, index) => {
    const entry = object(content, row, `${path}.series.${index}`);
    return { name: text(content, entry.name, `${path}.series.${index}.name`), values: numbers(content, entry.values, `${path}.series.${index}.values`) };
  });
  const chart = text(content, media.chart, `${path}.chart`);
  if (chart === "bar") return <BarChart title={title} categories={texts(content, media.categories, `${path}.categories`)} series={series} fit="fluid" marks="static" />;
  if (chart === "line") return <LineChart title={title} x={numbers(content, media.x, `${path}.x`)} series={series} />;
  throw new SectionContentError(content.leaf, `${path}.chart ${chart} has no registered chart component`);
}

/**
 * Prose blocks for a region body: headings, paragraphs and lists only, each through SemanticContent (no look of its
 * own). A heading may carry an `id`, the in-page target a table of contents links to.
 */
export function proseNodes(content: SectionContent, value: RuntimeJson | undefined, path: string): ReactNode {
  return list(content, value, path).map((row, index) => {
    const block = object(content, row, `${path}.${index}`);
    const kind = text(content, block.kind, `${path}.${index}.kind`);
    if (kind === "heading") {
      const id = optionalText(content, block.id, `${path}.${index}.id`);
      return <SemanticContent key={index} as="h2" {...(id === undefined ? {} : { id })}>{text(content, block.text, `${path}.${index}.text`)}</SemanticContent>;
    }
    if (kind === "paragraph") return <SemanticContent key={index} as="p">{text(content, block.text, `${path}.${index}.text`)}</SemanticContent>;
    if (kind === "list") return <SemanticContent key={index} as="ul">{texts(content, block.items, `${path}.${index}.items`).map(item => <SemanticContent key={item} as="li">{item}</SemanticContent>)}</SemanticContent>;
    throw new SectionContentError(content.leaf, `${path}.${index}.kind ${kind} is not a prose block`);
  });
}

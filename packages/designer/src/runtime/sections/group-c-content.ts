import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";

/**
 * Shared, markup-free readers for the group-c Section renderers. A renderer receives its content as JSON
 * keyed by contract slot name (runtime-ports `RuntimeRenderInput.content`); these helpers project that
 * JSON into plain values the renderer hands to its registered block and components. Nothing here renders:
 * every element a Section draws is written in the leaf's own renderer file, where the wiring scan reads it.
 */
export type SectionRenderer = (input: RuntimeRenderInput<ReactNode>) => ReactNode;
export type RuntimeObject = { readonly [key: string]: RuntimeJson };

/** The slots and member names a renderer consumes; equal to its generated fill's slotMap and propMap keys. */
export interface SectionInputs {
  readonly slots: readonly string[];
  readonly members: readonly string[];
  /** Contract slots and members the selected fill cannot render: filled or selected, the renderer refuses. */
  readonly unmapped?: { readonly slots?: readonly string[]; readonly members?: readonly string[] };
}

/**
 * Anatomy copy (a Section's own heading, description, eyebrow or region label) has no contract slot yet, so
 * the runtime assembly cannot deliver it. Renderers read it from this reserved content key when present and
 * refuse, naming the NEED, when the block requires it. Remove once the contracts carry a header copy slot.
 */
export const ANATOMY_CONTENT_KEY = "header";

export const noop = (): void => {};

export function isObject(value: RuntimeJson | undefined): value is RuntimeObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function slotValue(input: RuntimeRenderInput<ReactNode>, slot: string): RuntimeJson | undefined {
  return input.content[slot]?.value;
}

/** Copy as text: a string, a number, or an object carrying `text`. */
export function textOf(value: RuntimeJson | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isObject(value)) return textOf(value.text);
  return undefined;
}

export function stringField(value: RuntimeJson | undefined, key: string): string | undefined {
  return isObject(value) ? textOf(value[key]) : undefined;
}

export function numberField(value: RuntimeJson | undefined, key: string): number | undefined {
  const field = isObject(value) ? value[key] : undefined;
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

/** Records as objects: an array, or an object carrying `items`. Non-object rows are refused. */
export function recordsOf(leaf: string, slot: string, value: RuntimeJson | undefined): readonly RuntimeObject[] {
  const rows = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.items) ? value.items : value === undefined ? [] : null;
  if (!rows) throw new TypeError(`${leaf}: content slot "${slot}" must be a list of records`);
  return rows.map((row, index) => {
    if (!isObject(row)) throw new TypeError(`${leaf}: content slot "${slot}" row ${index} is not a record`);
    return row;
  });
}

export function requiredText(input: RuntimeRenderInput<ReactNode>, leaf: string, slot: string): string {
  const text = textOf(slotValue(input, slot));
  if (text === undefined || text === "") throw new TypeError(`${leaf}: required content slot "${slot}" is missing`);
  return text;
}

export function requireSlot(input: RuntimeRenderInput<ReactNode>, leaf: string, slot: string): RuntimeJson {
  const value = slotValue(input, slot);
  if (value === undefined || value === null) throw new TypeError(`${leaf}: required content slot "${slot}" is missing`);
  return value;
}

export interface ActionValue { readonly id: string; readonly label: string; readonly href?: string }

/** One action or a list of them; each needs a label, an optional href makes it a link. */
export function actionsOf(leaf: string, slot: string, value: RuntimeJson | undefined, max?: number): readonly ActionValue[] {
  if (value === undefined || value === null) return [];
  const rows = Array.isArray(value) ? value : [value];
  if (max !== undefined && rows.length > max) throw new TypeError(`${leaf}: content slot "${slot}" takes at most ${max} action(s), got ${rows.length}`);
  return rows.map((row, index) => {
    const label = typeof row === "string" ? row : stringField(row, "label");
    if (!label) throw new TypeError(`${leaf}: content slot "${slot}" action ${index} has no label`);
    const href = stringField(row, "href");
    return { id: stringField(row, "id") ?? `${slot}-${index}`, label, ...(href ? { href } : {}) };
  });
}

export interface AnatomyCopy { readonly heading?: string; readonly description?: string; readonly eyebrow?: string; readonly label?: string }

export function anatomyOf(input: RuntimeRenderInput<ReactNode>): AnatomyCopy {
  const value = slotValue(input, ANATOMY_CONTENT_KEY);
  const pick = (key: keyof AnatomyCopy) => stringField(value, key);
  const copy: Record<string, string> = {};
  for (const key of ["heading", "description", "eyebrow", "label"] as const) { const text = pick(key); if (text) copy[key] = text; }
  return copy;
}

export function requiredAnatomy(input: RuntimeRenderInput<ReactNode>, leaf: string, key: keyof AnatomyCopy): string {
  const text = anatomyOf(input)[key];
  if (!text) throw new TypeError(`${leaf}: anatomy ${key} is required, but no contract slot carries it (NEED: a header copy slot on ${leaf})`);
  return text;
}

/** The selected member on one axis (`layout.list` -> `list`), refusing two members on the same axis. */
export function memberOf(input: RuntimeRenderInput<ReactNode>, axis: string): string | undefined {
  const values = input.selection.members.filter(member => member.startsWith(`${axis}.`)).map(member => member.slice(axis.length + 1));
  if (values.length > 1) throw new TypeError(`${input.selection.leaf}: members ${values.map(value => `${axis}.${value}`).join(", ")} select one axis twice`);
  return values[0];
}

/** Refuse filled unmapped slots and selected unmapped members instead of silently dropping them. */
export function refuseUnmapped(input: RuntimeRenderInput<ReactNode>, inputs: SectionInputs): void {
  const leaf = input.selection.leaf;
  for (const slot of inputs.unmapped?.slots ?? []) if (input.content[slot] !== undefined) throw new TypeError(`${leaf}: content slot "${slot}" has no API in the selected fill (NEED)`);
  for (const member of inputs.unmapped?.members ?? []) if (input.selection.members.includes(member)) throw new TypeError(`${leaf}: member "${member}" has no API in the selected fill (NEED)`);
}

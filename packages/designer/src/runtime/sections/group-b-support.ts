import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";

/**
 * Shared reading helpers for the group-b Section renderers. A renderer receives only JSON content keyed by
 * the leaf's contract slot names; every label, callback and accessible name is owned by the renderer, never
 * by the content. Nothing here renders: each renderer composes its registered block and components.
 */
export type SectionRenderInput = RuntimeRenderInput<ReactNode>;
export type SectionRenderer = (input: SectionRenderInput) => ReactNode;
export interface GroupBSection {
  /** The contract leaf this renderer fills. */
  readonly leaf: `sections.${string}`;
  /** The contract slot names this renderer reads, equal to the leaf's fill slotMap keys. */
  readonly slots: readonly string[];
  readonly render: SectionRenderer;
}

/** One selection record: a selected row or node id. */
export interface SelectionRecord { readonly id: string }

/** The rendered state cell: "default" unless the board cell asks for loading, empty or error. */
export function stateOf(input: SectionRenderInput): "default" | "loading" | "empty" | "error" {
  const state = input.cell.state;
  return state === "loading" || state === "empty" || state === "error" ? state : "default";
}

function valueOf(input: SectionRenderInput, slot: string): RuntimeJson | undefined {
  return Object.hasOwn(input.content, slot) ? input.content[slot]!.value : undefined;
}

/** A records slot as a list. The empty state renders every records slot empty. */
export function recordsOf<T>(input: SectionRenderInput, slot: string): readonly T[] {
  if (stateOf(input) === "empty") return [];
  const value = valueOf(input, slot);
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${input.fill.leaf}: slot "${slot}" must be a records list`);
  return value as unknown as readonly T[];
}

/**
 * A records slot whose kebab-case copy ids map onto camelCase block props: `props` names each renamed field
 * (`{ "used-text": "usedText" }`); every other field passes through by its own name.
 */
export function recordsAs<T>(input: SectionRenderInput, slot: string, props: Readonly<Record<string, string>>): readonly T[] {
  return recordsOf<unknown>(input, slot).map(row => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return row as T;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [props[key] ?? key, value])) as T;
  });
}

/** A copy, action or region slot as one object or string; absent when the slot is not filled. */
export function entryOf<T>(input: SectionRenderInput, slot: string): T | undefined {
  const value = valueOf(input, slot);
  return value === undefined || value === null ? undefined : value as unknown as T;
}

/** Selected member names on one axis, e.g. `layout` -> ["row"]. */
export function membersOn(input: SectionRenderInput, axis: string): readonly string[] {
  return input.selection.members.filter(member => member.startsWith(`${axis}.`)).map(member => member.slice(axis.length + 1));
}

/** The no-op change callback for controlled blocks whose host has no store behind the preview. */
export const inert = (): void => undefined;

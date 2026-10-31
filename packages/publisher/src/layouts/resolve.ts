import { isTailwindBreakpoint } from "@clossys/designer/catalog";
import leaves from "./slots/layouts.json" with { type: "json" };
import { isLayoutId } from "./ids.js";
import type { LayoutConfig, LayoutLeaf, LayoutSlot, PageLayoutContract } from "./contract.js";

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const LAYOUT_LEAVES = freeze(leaves as unknown as readonly LayoutLeaf[]);
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function getLayoutLeaf(id: string): LayoutLeaf | undefined {
  return isLayoutId(id) ? LAYOUT_LEAVES.find((leaf) => leaf.id === id) : undefined;
}

export function configProblems(contract: PageLayoutContract, config: LayoutConfig): string[] {
  const problems: string[] = [];
  const slots = contract.slots;
  if (!Array.isArray(slots)) throw new Error("Invalid layout slots");
  for (const [name, value] of Object.entries(config.members)) {
    const options = contract.members[name] ?? [];
    if (!Array.isArray(options)) throw new Error("Invalid layout members");
    if (!options.includes(value)) problems.push(`unknown member selection ${name}=${value}`);
  }
  for (const [id, override] of Object.entries(config.slotOverrides ?? {})) {
    const slot = slots.find((candidate) => candidate.id === id);
    if (!slot) { problems.push(`unknown slot ${id}`); continue; }
    if (Object.keys(override).some((key) => !["accepts", "min", "max"].includes(key))) problems.push(`unknown override field for ${id}`);
    const min = override.min ?? slot.min;
    const max = override.max ?? slot.max;
    if (!count(min) || !count(max) || min < slot.min || max > slot.max || min > max) problems.push(`count override widens or invalidates ${id}`);
    const accepts = override.accepts ?? [];
    const allowed = slot.accepts;
    if (!Array.isArray(accepts) || !Array.isArray(allowed)) throw new Error("Invalid slot acceptance");
    const allowedValues = new Set(allowed);
    if (override.accepts && (!accepts.length || !unique(accepts) || accepts.some((id) => !allowedValues.has(id)))) problems.push(`acceptance override widens or invalidates ${id}`);
  }
  return problems;
}

export interface EffectivePageLayoutContract extends PageLayoutContract {
  readonly memberValues: Readonly<Record<string, string>>;
}

/** Resolve a registered config and explicit closed members without selecting content. */
export function getEffectiveLayoutContract(
  value: LayoutLeaf | string,
  configId?: string,
  members: Readonly<Record<string, string>> = {},
): EffectivePageLayoutContract {
  const leaf = typeof value === "string" ? getLayoutLeaf(value) : value;
  if (!leaf || !isLayoutId(leaf.id) || leaf.status === "held" || leaf.status === "deprecated") throw new Error("Layout is unknown, held or retired");
  const contract = leaf.contract;
  const configs = contract.configs;
  const sourceSlots = contract.slots;
  const sourceReflow = contract.reflow;
  if (!Array.isArray(configs)) throw new Error("Invalid layout configs");
  if (!Array.isArray(sourceSlots)) throw new Error("Invalid layout slots");
  if (!Array.isArray(sourceReflow)) throw new Error("Invalid layout reflow");
  const config = configId === undefined ? undefined : configs.find((entry) => entry.id === configId);
  if (configId !== undefined && !config) throw new Error(`Unknown layout config: ${configId}`);
  if (config && configProblems(contract, config).length) throw new Error(`Invalid layout config: ${config.id}`);
  for (const [name, selection] of Object.entries(members)) {
    const options = contract.members[name] ?? [];
    if (!Array.isArray(options)) throw new Error("Invalid layout members");
    if (!options.includes(selection)) throw new Error(`Unknown layout member: ${name}=${selection}`);
    if (config?.members[name] !== undefined && config.members[name] !== selection) throw new Error(`Layout member conflicts with config: ${name}`);
  }
  const memberValues = { ...config?.members, ...members };
  const slots: LayoutSlot[] = sourceSlots.map((slot) => ({ ...slot, ...config?.slotOverrides?.[slot.id] }));
  const effectiveSlots = memberValues.lead === "required"
    ? slots.map(slot => slot.id === "lead" ? { ...slot, min: Math.max(1, slot.min) } : slot)
    : slots;
  // Preserve the existing Layout's inherited aside-width behavior in the one
  // effective contract, so Stage DOM order and CSS reflow share that choice.
  const breakpoint = memberValues.breakpoint ?? (leaf.id === "layouts.sidebar-content" ? (memberValues["aside-width"] ?? contract.members["aside-width"]?.[0]) === "region" ? "lg" : "md" : undefined);
  let at: PageLayoutContract["reflow"][number]["at"] | undefined;
  if (isTailwindBreakpoint(breakpoint)) at = breakpoint;
  else if (leaf.id === "layouts.sidebar-content" && breakpoint) throw new Error("Unknown layout breakpoint");
  const reflow = leaf.id === "layouts.sidebar-content" && at
    ? sourceReflow.map((step) => ({ ...step, at }))
    : sourceReflow;
  return freeze({ ...contract, slots: effectiveSlots, reflow, memberValues });
}

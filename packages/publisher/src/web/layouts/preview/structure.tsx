import { Children } from "react";
import type { ReactNode } from "react";
import { getLayoutLeaf, getEffectiveLayoutContract } from "../../../layouts/resolve.js";
import type { LayoutId, LayoutSpan } from "../../../layouts/index.js";

import type { FlowStagePlan } from "../../../core/flow-stage.js";

/** Width is measured by the host, so server and client use the same structural plan. */
export interface LayoutProps {
  readonly slots: Readonly<Record<string, readonly ReactNode[]>>;
  readonly stage: FlowStagePlan;
  readonly config?: string;
  readonly members?: Readonly<Record<string, string>>;
}
export type TileSpan = LayoutSpan;
export function layoutState(id: LayoutId, props: LayoutProps) {
  if (!props.stage || props.stage.leaf !== id || props.stage.config !== props.config) throw new Error("Exact measured Stage plan required");
  const leaf = getLayoutLeaf(id);
  if (!leaf || leaf.status === "held" || leaf.status === "deprecated") throw new Error("Layout is not active");
  const contract = getEffectiveLayoutContract(id, props.config, props.members);
  const members = Object.fromEntries(Object.entries(contract.members).map(([key, values]) => [key, values[0]!]));
  if (id === "layouts.stack") members.lead = "optional";
  Object.assign(members, contract.memberValues);
  if (id === "layouts.stack" && members.lead === "required" && !props.slots.lead?.length) throw new Error("Layout requires a lead");
  if (id === "layouts.stack" && members.align === "center" && props.slots.body?.length !== 1) throw new Error("Centered stack requires one body");
  for (const [key, value] of Object.entries(members)) {
    const options = contract.members[key] ?? [];
    if (!Array.isArray(options)) throw new Error("Invalid layout members");
    if (!options.includes(value)) throw new Error(`Unknown layout member: ${key}`);
  }
  const slots = contract.slots;
  if (!Array.isArray(slots)) throw new Error("Invalid layout slots");
  for (const key of Object.keys(props.slots)) if (!slots.some(slot => slot.id === key)) throw new Error(`Unknown layout slot: ${key}`);
  for (const slot of slots) {
    const count = props.slots[slot.id]?.length ?? 0;
    if (count < slot.min || count > slot.max) throw new Error(`Invalid layout slot count: ${slot.id}`);
  }
  if (JSON.stringify(props.stage.members) !== JSON.stringify(contract.memberValues)) throw new Error("Stage member selection differs from Layout");
  return { contract, members };
}
export function Slot({ id, children }: { id: string; children?: ReactNode }) {
  if (!Children.count(children)) return null;
  return <div data-layout-slot={id} className="grid gap-lg">{children}</div>;
}
export function slotNodes(props: LayoutProps, id: string) {
  const list = props.slots[id] ?? [];
  if (!Array.isArray(list)) throw new Error("Invalid slot nodes");
  return list.map((node, index) => <div data-layout-item="" key={index}>{node}</div>);
}

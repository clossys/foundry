import { Skeleton } from "@clossys/designer/components/server";
import type { ReactNode } from "react";
import type { LayoutId, LayoutSlot } from "../../../layouts/index.js";
import { getEffectiveLayoutContract } from "../../../layouts/index.js";
import { Stack } from "../Stack.js";
import { Split } from "../Split.js";
import { SidebarContent } from "../SidebarContent.js";
import { Bento } from "../Bento.js";
import type { LayoutProps } from "./structure.js";
import { planFlowStage } from "../../../core/flow-stage.js";
import type { BreakpointValues } from "../../../core/flow-stage.js";

const SHAPES: Record<LayoutSlot["previewShape"], string> = {
  bar: "h-[var(--spacing-xl)]", panel: "h-[var(--ui-layout-aside-w)]",
  rail: "h-[var(--ui-layout-aside-w)]", tile: "h-[var(--ui-layout-aside-w)]",
};
export interface LayoutPreviewProps {
  readonly leaf: LayoutId;
  readonly width: number;
  readonly breakpointValues: BreakpointValues;
  readonly theme: "light" | "dark";
  readonly config?: string;
  readonly members?: Readonly<Record<string, string>>;
}
/** Contract-only placeholders: no real section, content choice, or authored copy. */
export function LayoutPreview(props: LayoutPreviewProps) {
  const contract = getEffectiveLayoutContract(props.leaf, props.config, props.members);
  const slots: Record<string, readonly ReactNode[]> = Object.fromEntries(contract.slots.map(slot => [slot.id,
    Array.from({ length: Math.min(slot.max, Math.max(1, slot.min)) }, (_, index) => <div key={index} className="min-w-0 grid" data-preview-shape={slot.previewShape}>
      <Skeleton shape="block" className={SHAPES[slot.previewShape]} />
      <span>{slot.id}</span>
    </div>),
  ]));
  const layoutProps: LayoutProps = { slots, stage: planFlowStage(props.leaf, props.config, props.members, props.width, props.breakpointValues), config: props.config, members: props.members };
  const content = props.leaf === "layouts.stack" ? <Stack {...layoutProps} />
    : props.leaf === "layouts.split" ? <Split {...layoutProps} />
    : props.leaf === "layouts.sidebar-content" ? <SidebarContent {...layoutProps} asideSections={slots.aside?.map(() => contract.slots.find(slot => slot.id === "aside")!.accepts[0]!)} />
    : props.leaf === "layouts.bento" ? <Bento {...layoutProps} /> : null;
  return <div data-theme={props.theme} className="min-w-0" style={{ width: props.width }}>{content}</div>;
}
export function LayoutPreviewMatrix({ leaf, config, breakpointValues }: Pick<LayoutPreviewProps, "leaf" | "config" | "breakpointValues">) {
  return <>{([320, 1280] as const).flatMap(width => (["light", "dark"] as const).map(theme => <LayoutPreview key={`${width}-${theme}`} leaf={leaf} config={config} breakpointValues={breakpointValues} width={width} theme={theme} />))}</>;
}

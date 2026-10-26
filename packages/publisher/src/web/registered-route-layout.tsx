import type { ReactNode } from "react";
import { runtimeHash, runtimeSourceFindings } from "@clossys/designer/catalog";
import type { RuntimeLayoutPort, RuntimeRendererDescriptor, CompositeResolved, RuntimeCell } from "@clossys/designer/catalog";
import { sha256 } from "../planning/digest.js";
import type { ConsumerInstanceLibrary, FlowInstanceBinding, LayoutRendererSource } from "../core/instance-binding.js";
import { registeredLayoutSourcePin } from "../core/layout-fill-source.js";
import { planFlowStage } from "../core/flow-stage.js";
import { getEffectiveLayoutContract } from "../layouts/resolve.js";
import { Stack } from "./layouts/Stack.js";
import { Split } from "./layouts/Split.js";
import { SidebarContent } from "./layouts/SidebarContent.js";
import { Bento } from "./layouts/Bento.js";
import type { LayoutProps } from "./layouts/preview/structure.js";
import type { BreakpointValues } from "../core/flow-stage.js";

/** Source pins bind these executable implementations; they never choose a Layout. */
export function registeredLayoutSourceMatches(leaf: string, source: LayoutRendererSource): boolean {
  const pin = registeredLayoutSourcePin(leaf);
  return !!pin && source.entry === pin.entry && Object.keys(source.files).sort().join(",") === Object.keys(pin.files).sort().join(",") && Object.entries(pin.files).every(([file, hash]) => `sha256:${sha256(source.files[file]!)}` === hash);
}
export function registeredRouteBreakpointValues(profile: CompositeResolved, measured: Readonly<Record<string, number>>): BreakpointValues {
  return Object.fromEntries(Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint.")).map(([id, member]) => {
    const value = member.value.light;
    return [id, value && typeof value === "object" && !Array.isArray(value) && "unit" in value && "value" in value && value.unit === "px" ? value.value : measured[id]];
  })) as BreakpointValues;
}
/** Execute only the exact adopted public Layout source/configuration. Custom
 * consumer implementations remain pending rather than being silently replaced. */
export function bindRegisteredFlowLayout(binding: FlowInstanceBinding, library: ConsumerInstanceLibrary, renderer: RuntimeRendererDescriptor, measured: Readonly<Record<string, number>> = {}): RuntimeLayoutPort<ReactNode> | undefined {
  const selected = library.resolveFill(binding.layout.leaf, binding.layout.config);
  if (library.role !== "consumer" || library.id !== binding.context.consumer || !selected || selected.library !== library.id || selected.leaf !== binding.layout.leaf || selected.config !== binding.layout.config || !selected.renderer || !registeredLayoutSourceMatches(binding.layout.leaf, selected.renderer)) return undefined;
  if (runtimeSourceFindings(renderer).length || renderer.source.entry !== selected.renderer.entry || runtimeHash(renderer.source.files) !== runtimeHash(selected.renderer.files)) return undefined;
  const contract = getEffectiveLayoutContract(binding.layout.leaf, binding.layout.config, binding.layout.members);
  if (contract.reflow.some(step => !Number.isSafeInteger(measured[step.at]) || measured[step.at]! <= 1)) return undefined;
  const order = (_cell: RuntimeCell, paths: Readonly<Record<string, readonly string[]>>, stageWidth: number): readonly string[] => {
    const stage = planFlowStage(binding.layout.leaf, binding.layout.config, binding.layout.members, stageWidth, measured);
    return stage.slotOrder.flatMap(slot => paths[slot] ?? []);
  };
  return {
    descriptor: { library: library.id, fill: `${selected.leaf}:${selected.config}`, leaf: binding.layout.leaf, config: binding.layout.config, members: contract.memberValues, slots: contract.slots, breakpoints: [...new Set([...contract.reflow.map(step => step.at), ...(binding.layout.leaf === "layouts.stack" ? ["tokens.breakpoint.mobile" as const] : [])])], states: selected.states, renderer, inputs: { spans: Object.fromEntries(Object.entries(binding.fills).map(([slot, fills]) => [slot, fills.map(fill => fill.span ?? null)])) } },
    expectedOrder: order,
    render: ({ slots, stageWidth, profile }) => {
      const props: LayoutProps = { slots, stage: planFlowStage(binding.layout.leaf, binding.layout.config, binding.layout.members, stageWidth, registeredRouteBreakpointValues(profile, measured)), config: binding.layout.config, members: binding.layout.members };
      const content = binding.layout.leaf === "layouts.stack" ? <Stack slots={props.slots} stage={props.stage} config={props.config} members={props.members} />
        : binding.layout.leaf === "layouts.split" ? <Split slots={props.slots} stage={props.stage} config={props.config} members={props.members} />
        : binding.layout.leaf === "layouts.sidebar-content" ? <SidebarContent slots={props.slots} stage={props.stage} config={props.config} members={props.members} asideSections={binding.fills.aside?.map(fill => fill.section)} />
        : binding.layout.leaf === "layouts.bento" ? <Bento slots={props.slots} stage={props.stage} config={props.config} members={props.members} spans={binding.fills.tiles?.map(fill => fill.span)} /> : null;
      if (!content) throw new Error("Selected Layout has no registered executable implementation");
      return <div data-layout-stage="flow">{content}</div>;
    },
  };
}

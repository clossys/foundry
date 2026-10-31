import type { ReactNode } from "react";
import { resolve, runtimeHash, runtimeSnapshot, runtimeSourceFindings, TAILWIND_BREAKPOINTS } from "@clossys/designer/catalog";
import type { RuntimeLayoutPort, RuntimeRendererDescriptor, CompositeResolved, CompositeEngineInput, RuntimeCell } from "@clossys/designer/catalog";
import type { ConsumerInstanceFill, ConsumerInstanceLibrary, FlowInstanceBinding } from "../core/instance-binding.js";
import { registeredLayoutSourceMatches } from "../core/layout-fill-source.js";
export { registeredLayoutSourceMatches } from "../core/layout-fill-source.js";
import { flowStageStyleSheet, planFlowStage } from "../core/flow-stage.js";
import { getEffectiveLayoutContract } from "../layouts/resolve.js";
import { Stack } from "./layouts/Stack.js";
import { Split } from "./layouts/Split.js";
import { SidebarContent } from "./layouts/SidebarContent.js";
import { Bento } from "./layouts/Bento.js";
import type { LayoutProps } from "./layouts/preview/structure.js";
import type { BreakpointValues } from "../core/flow-stage.js";

/** Breakpoints are Tailwind's fixed screens; no consumer measurement can move them. */
export function registeredRouteBreakpointValues(): BreakpointValues {
  return { ...TAILWIND_BREAKPOINTS };
}
/** Execute only the exact adopted public Layout source/configuration. Custom
 * consumer implementations remain pending rather than being silently replaced. */
export function bindRegisteredFlowLayout(binding: FlowInstanceBinding, library: ConsumerInstanceLibrary, renderer: RuntimeRendererDescriptor, measured: BreakpointValues = registeredRouteBreakpointValues()): RuntimeLayoutPort<ReactNode> | undefined {
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
    descriptor: { library: library.id, fill: `${selected.leaf}:${selected.config}`, leaf: binding.layout.leaf, config: binding.layout.config, members: contract.memberValues, slots: contract.slots, breakpoints: [...new Set([...contract.reflow.map(step => step.at), ...(binding.layout.leaf === "layouts.stack" ? ["sm" as const] : [])])], states: selected.states, renderer, inputs: { spans: Object.fromEntries(Object.entries(binding.fills).map(([slot, fills]) => [slot, fills.map(fill => fill.span ?? null)])) } },
    expectedOrder: order,
    render: ({ slots, stageWidth, profile }) => {
      const props: LayoutProps = { slots, stage: planFlowStage(binding.layout.leaf, binding.layout.config, binding.layout.members, stageWidth, measured), config: binding.layout.config, members: binding.layout.members };
      const content = binding.layout.leaf === "layouts.stack" ? <Stack slots={props.slots} stage={props.stage} config={props.config} members={props.members} />
        : binding.layout.leaf === "layouts.split" ? <Split slots={props.slots} stage={props.stage} config={props.config} members={props.members} />
        : binding.layout.leaf === "layouts.sidebar-content" ? <SidebarContent slots={props.slots} stage={props.stage} config={props.config} members={props.members} asideSections={binding.fills.aside?.map(fill => fill.section)} />
        : binding.layout.leaf === "layouts.bento" ? <Bento slots={props.slots} stage={props.stage} config={props.config} members={props.members} spans={binding.fills.tiles?.map(fill => fill.span)} /> : null;
      if (!content) throw new Error("Selected Layout has no registered executable implementation");
      return <div data-layout-stage="flow">{content}</div>;
    },
  };
}

export interface RegisteredFlowRuntimeInputs {
  readonly css: readonly { readonly id: "publisher-flow-stage.css"; readonly contents: string }[];
  readonly layoutRenderer: RuntimeRendererDescriptor;
  /** Description of the explicitly requested authored Layout. The host must
   * deliberately associate it with its consumer library; no adoption is inferred. */
  readonly fill: ConsumerInstanceFill;
}
/** Produce the existing checked flow inputs for exactly binding.layout. No source
 * rule is copied, no library is mutated, and no alternate Layout is chosen. The
 * route binder still checks the host's selected fill and all assembly inputs. */
export function registeredFlowRuntimeInputs(input: { readonly binding: FlowInstanceBinding; readonly engine: CompositeEngineInput; readonly layoutRenderer: RuntimeRendererDescriptor; readonly states: readonly string[] }): RegisteredFlowRuntimeInputs {
  const { binding, engine, layoutRenderer } = input;
  if (binding.body?.kind !== "flow" || !binding.layout || !binding.context.consumer || !input.states.length || input.states.some(state => typeof state !== "string" || !state)) throw new TypeError("Explicit selected flow Layout and states required");
  const profile = resolve(engine);
  if (binding.context.consumer !== profile.consumer) throw new TypeError("Flow Layout consumer differs from the current engine");
  if (runtimeSourceFindings(layoutRenderer).length || !registeredLayoutSourceMatches(binding.layout.leaf, layoutRenderer.source)) throw new TypeError("Current authored Layout source pins required");
  const fill: ConsumerInstanceFill = runtimeSnapshot({ library: binding.context.consumer, leaf: binding.layout.leaf, ...(binding.layout.config !== undefined ? { config: binding.layout.config } : {}), headings: [], states: input.states, renderer: { entry: layoutRenderer.source.entry, files: layoutRenderer.source.files } });
  const library: ConsumerInstanceLibrary = { id: binding.context.consumer, role: "consumer", resolveFill: (leaf, config) => leaf === fill.leaf && config === fill.config ? fill : undefined, resolveContent: () => undefined };
  if (!bindRegisteredFlowLayout(binding, library, layoutRenderer)) throw new TypeError("Exact selected public flow Layout source/configuration or breakpoints unavailable");
  return runtimeSnapshot({ css: [{ id: "publisher-flow-stage.css" as const, contents: flowStageStyleSheet(profile, binding.layout.leaf, binding.layout.config, binding.layout.members) }], layoutRenderer, fill });
}

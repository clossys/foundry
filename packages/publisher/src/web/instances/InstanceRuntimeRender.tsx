"use client";
/**
 * One instance drawn by the real Foundry runtime: the host runs the closed registered-route binder
 * (`prepareRegisteredRoute`), which assembles the selected Frame and Sections through the consumer's
 * runtime ports, and this view renders the chosen cell from that assembly. The binder is supplied by
 * the host rather than imported here because its import closure is not browser-safe (it reaches the
 * controller review CLI and the catalog CSS parser); this client view must bundle for the browser.
 * An instance with no registered route,
 * no host runtime, a refused or pending assembly, or a cell outside the bound matrix shows the
 * Foundry empty state with the actual reason. Nothing is drawn in place of a Frame or Section.
 */
import { Component, type ReactNode } from "react";
import { EmptyState } from "@clossys/designer/blocks";
import type { RuntimeCell } from "@clossys/designer/catalog";
import type { InstanceBinding } from "../../core/instance-binding.js";
import type { RouteRegistration, RouteRegistry } from "../../core/route-registry.js";
import type { PreparedRegisteredRoute } from "../registered-route-binding.js";
import { PreviewViewport } from "../layouts/preview/PreviewViewport.js";

/** The host's authenticated route registry and a hook returning the closed binder's result for one
 * registered route: `prepareRegisteredRoute(registry, route.routeId, useRuntime(route), renderActions)`. */
export interface InstanceRuntimeRoutes {
  readonly registry: RouteRegistry;
  readonly usePreparedRoute: (route: RouteRegistration) => PreparedRegisteredRoute;
}

export interface InstanceRuntimeRenderLabels {
  readonly unavailableTitle: string;
  readonly noRuntime: string;
  readonly notRegistered: (count: number) => string;
  readonly assembly: (status: "pending" | "refused", findings: readonly string[]) => string;
  readonly outsideMatrix: (cell: RuntimeCell, bound: readonly RuntimeCell[]) => string;
  readonly renderFailed: (message: string) => string;
  readonly viewportTitle: (label: string, cell: RuntimeCell) => string;
}
const cellText = (cell: RuntimeCell) => `${cell.width} px ${cell.theme} ${cell.state}`;
export const instanceRuntimeRenderLabels: InstanceRuntimeRenderLabels = {
  unavailableTitle: "Runtime render unavailable",
  noRuntime: "No registered-route runtime supplied by the host.",
  notRegistered: count => count ? `${count} registered routes bind this instance; exactly one is required.` : "This instance is not a registered route.",
  assembly: (status, findings) => `Runtime assembly ${status}: ${findings.join("; ") || "no findings reported"}`,
  outsideMatrix: (cell, bound) => `${cellText(cell)} is outside the bound runtime matrix (${bound.map(cellText).join(", ") || "no cells"}).`,
  renderFailed: message => `Runtime render failed: ${message}`,
  viewportTitle: (label, cell) => `${label} · ${cell.width} px ${cell.theme} runtime render`,
};

export interface InstanceRuntimeRenderProps {
  readonly binding: InstanceBinding;
  readonly routes?: InstanceRuntimeRoutes;
  readonly width: 320 | 768 | 1280;
  readonly theme: "light" | "dark";
  readonly state?: string;
  readonly labels?: InstanceRuntimeRenderLabels;
}

function Unavailable({ labels, reason }: { readonly labels: InstanceRuntimeRenderLabels; readonly reason: string }) {
  return <EmptyState title={labels.unavailableTitle} description={reason} />;
}

export function InstanceRuntimeRender({ binding, routes, labels = instanceRuntimeRenderLabels, ...cell }: InstanceRuntimeRenderProps) {
  if (!routes) return <Unavailable labels={labels} reason={labels.noRuntime} />;
  const matches = routes.registry.routes.filter(route => route.composition.binding.instanceId === binding.instanceId);
  if (matches.length !== 1) return <Unavailable labels={labels} reason={labels.notRegistered(matches.length)} />;
  return <RegisteredInstance key={matches[0]!.routeId} route={matches[0]!} routes={routes} label={binding.label} labels={labels} {...cell} />;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Contains an error thrown while React reconciles the runtime's rendered descendants (the synchronous
 * try/catch only covers `assembly.render`). A new `resetKey` (route, cell, width or theme) clears it. */
class RuntimeRenderBoundary extends Component<{ readonly resetKey: string; readonly labels: InstanceRuntimeRenderLabels; readonly children: ReactNode }, { readonly failure?: string }> {
  override state: { readonly failure?: string } = {};
  static getDerivedStateFromError(error: unknown) { return { failure: message(error) }; }
  override componentDidUpdate(previous: { readonly resetKey: string }) { if (this.state.failure !== undefined && previous.resetKey !== this.props.resetKey) this.setState({ failure: undefined }); }
  override render() { return this.state.failure !== undefined ? <Unavailable labels={this.props.labels} reason={this.props.labels.renderFailed(this.state.failure)} /> : this.props.children; }
}

/** Keyed by route id, so the host hook always runs in the same order for one mount. */
function RegisteredInstance({ route, routes, label, labels, width, theme, state }: { readonly route: RouteRegistration; readonly routes: InstanceRuntimeRoutes; readonly label: string; readonly labels: InstanceRuntimeRenderLabels; readonly width: 320 | 768 | 1280; readonly theme: "light" | "dark"; readonly state?: string }) {
  const prepared = routes.usePreparedRoute(route);
  if (prepared.status !== "ready") return <Unavailable labels={labels} reason={labels.assembly(prepared.status, prepared.findings)} />;
  const wanted: RuntimeCell = { width, theme, state: state ?? "default" };
  const cell = prepared.assembly.snapshot.cells.find(row => row.width === wanted.width && row.theme === wanted.theme && row.state === wanted.state);
  if (!cell) return <Unavailable labels={labels} reason={labels.outsideMatrix(wanted, prepared.assembly.snapshot.cells)} />;
  let node: ReactNode;
  try { node = prepared.assembly.render(cell); } catch (error) { return <Unavailable labels={labels} reason={labels.renderFailed(message(error))} />; }
  return <RuntimeRenderBoundary resetKey={`${route.routeId}\u0000${cell.width}\u0000${cell.theme}\u0000${cell.state}`} labels={labels}>
    <PreviewViewport width={width} theme={theme} mode="instance" title={labels.viewportTitle(label, cell)}>{node}</PreviewViewport>
  </RuntimeRenderBoundary>;
}

"use client";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Banner } from "@clossys/designer/components";
import { ShellCopyProvider, surfaceRuntimeCallbacks, surfaceRendererId } from "@clossys/designer/frames";
import { checkConsumerRuntimePorts, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeContentRef, RuntimeRenderInput } from "@clossys/designer/catalog";
import { checkedDesignerRouteData, routeBreakpointPixels, routeBreakpointsReady } from "@clossys/designer/studio/route/server";
import type { DesignerRouteServerData, DesignerRoutePageProps } from "@clossys/designer/studio/route";
import { PublisherPage } from "./PublisherPage.js";
import type { PublisherPageProps } from "./PublisherPage.js";
import { publisherChannelFromHref } from "./publisher-channels.js";
import type { PublisherChannelId } from "./publisher-channels.js";
import type { ConsumerInstanceFill, ConsumerInstanceLibrary, FlowInstanceBinding, InstanceRegistries } from "../../core/instance-binding.js";
import type { ContentRef } from "../../core/instance-binding.js";

export interface PublisherRouteServerData extends DesignerRouteServerData {
  readonly publisher: {
    readonly instances: readonly FlowInstanceBinding[];
    readonly fills: readonly ConsumerInstanceFill[];
    readonly registries: InstanceRegistries;
    readonly designerHref: string;
    readonly draftPlan?: PublisherPageProps["draftPlan"];
    readonly appInventory?: PublisherPageProps["appInventory"];
    readonly registeredRouteProjection?: PublisherPageProps["registeredRouteProjection"];
    readonly registeredRoutes?: PublisherPageProps["registeredRoutes"];
    readonly appPageBindings?: PublisherPageProps["appPageBindings"];
    readonly appSubrowBindings?: PublisherPageProps["appSubrowBindings"];
    readonly brandAssets?: PublisherPageProps["brandAssets"];
    readonly deploymentSurfaceIds?: readonly string[];
    readonly routeChannels?: PublisherPageProps["routeChannels"];
    readonly activeChannel?: PublisherChannelId;
  };
}
export interface PublisherRoutePageProps {
  readonly serverData: PublisherRouteServerData;
  readonly initialSession: DesignerRoutePageProps["initialSession"];
  /** Live host callback; never part of the serialized server data. */
  readonly copyResolver?: PublisherPageProps["copyResolver"];
}
/** Complete local Publisher workspace. Server facts create local read-only
 * lookup ports; no controller, callback, receipt or publication authority crosses. */
export function PublisherRoutePage({ serverData, initialSession, copyResolver }: PublisherRoutePageProps) {
  const checked = useMemo(() => {
    if (!initialSession) return { status: "pending" as const };
    try {
      const value = checkedDesignerRouteData(serverData, initialSession);
      if (serverData.publisher.fills.some(fill => fill.library !== value.profile.consumer)) throw new TypeError("Publisher fill belongs to a different consumer");
      return { status: "ready" as const, value };
    } catch { return { status: "refused" as const }; }
  }, [serverData, initialSession]);
  if (checked.status === "pending") return <Banner>Loading Publisher session</Banner>;
  if (checked.status === "refused") return <Banner variant="danger">Publisher initial data does not match its session</Banner>;
  return <PublisherRouteSurface serverData={serverData} checked={checked.value} copyResolver={copyResolver} />;
}
function PublisherRouteSurface({ serverData, checked, copyResolver }: { serverData: PublisherRouteServerData; checked: ReturnType<typeof checkedDesignerRouteData>; copyResolver?: PublisherPageProps["copyResolver"] }) {
  const { profile, contracts } = checked, data = checked.data, workspace = serverData.publisher;
  const deterministic = useMemo(() => routeBreakpointPixels(profile, data.rootFontSizeToken), [profile, data.rootFontSizeToken]);
  const [measured, setMeasured] = useState<{ profile: typeof profile; values: Readonly<Record<string, number>> }>();
  const [channel, setChannel] = useState(workspace.activeChannel);
  useEffect(() => {
    if (routeBreakpointsReady(profile, deterministic)) return;
    const measure = () => {
      const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      if (!Number.isFinite(root) || root <= 0) return;
      const pixels: Record<string, number> = {};
      for (const [id, member] of Object.entries(profile.values.members)) {
        const value = member.value.light;
        if (id.startsWith("tokens.breakpoint.") && value && typeof value === "object" && !Array.isArray(value) && "unit" in value && "value" in value && value.unit === "rem" && typeof value.value === "number") pixels[id] = value.value * root;
      }
      const values = routeBreakpointPixels(profile, undefined, pixels);
      setMeasured(previous => previous?.profile === profile && runtimeHash(previous.values) === runtimeHash(values) ? previous : { profile, values });
    };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [profile, deterministic]);
  const values = routeBreakpointsReady(profile, deterministic) ? deterministic : measured?.profile === profile ? measured.values : deterministic;
  const contents = useMemo(() => new Map(data.contents.map(row => [runtimeHash(row.reference), row])), [data.contents]);
  const library = useMemo<ConsumerInstanceLibrary>(() => ({ id: profile.consumer, role: "consumer", resolveFill: (leaf, config) => workspace.fills.find(fill => fill.leaf === leaf && fill.config === config), resolveContent: (ref: ContentRef) => contents.has(runtimeHash(ref)) ? ref : undefined }), [profile.consumer, workspace.fills, contents]);
  const renderers = useMemo(() => surfaceRuntimeCallbacks(data.manifest.fills.map(fill => fill.leaf)), [data.manifest]);
  const ports = useMemo(() => ({ manifest: data.manifest, renderers, resolveContent: (reference: RuntimeContentRef) => contents.get(runtimeHash(reference)), frameHost: { panels: { inspector: null as ReactNode }, navigate(href: string) {
    const selected = publisherChannelFromHref(href);
    if (selected) { setChannel(selected); return; }
    window.location.assign(new URL(href, window.location.href).href);
  } } }), [data.manifest, renderers, contents]);
  if (!routeBreakpointsReady(profile, values)) return <Banner>Measuring Publisher breakpoints</Banner>;
  const frame = data.manifest.fills.find(fill => fill.leaf === data.frame.leaf && fill.fill === data.frame.fill && fill.config === data.frame.config && fill.library === profile.consumer);
  const selected = profile.surfaces?.fills[data.frame.leaf];
  if (!selected || selected.document.$extensions["com.clossys.fill"].id !== data.frame.fill || !frame || frame.kind !== "frame" || frame.renderer.id !== surfaceRendererId(frame.leaf) || data.frame.members.some(member => !frame.members.includes(member)) || checkConsumerRuntimePorts(ports, contracts, { consumer: profile.consumer, libraryHash: data.manifest.libraryHash, selectionHash: profile.selectionHash as `sha256:${string}` }).status !== "valid") return <Banner variant="danger">Selected Publisher frame unavailable</Banner>;
  const content: Record<string, import("@clossys/designer/catalog").RuntimeContent> = {};
  for (const [slot, reference] of Object.entries(data.frame.content)) {
    const row = ports.resolveContent(reference);
    if (!row || row.hash !== runtimeHash(row.value)) return <Banner variant="danger">Selected Publisher frame content unavailable</Banner>;
    content[slot] = row;
  }
  const body = <PublisherPage key="publisher" copyResolver={copyResolver} {...workspace} library={library} breakpointValues={values} activeChannel={channel} />;
  const input: RuntimeRenderInput<ReactNode> = { path: "frame", fill: frame, selection: data.frame, content, slots: { main: [body] }, profile, cell: data.cell, host: ports.frameHost };
  return <ShellCopyProvider resolver={copyResolver}><div data-route-display="publisher" data-route-authentication="unverified" className="absolute inset-0 min-h-0 min-w-0" style={Object.fromEntries(Object.entries(values).map(([id, px]) => [`--breakpoint-${id.slice("tokens.breakpoint.".length)}`, `${px}px`])) as CSSProperties}>{renderers[frame.renderer.id]!(input)}</div></ShellCopyProvider>;
}

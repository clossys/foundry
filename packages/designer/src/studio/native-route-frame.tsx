"use client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Banner } from "../components/Banner.js";
import { checkConsumerRuntimePorts, runtimeHash, runtimeSourceFindings } from "../catalog-core/index.js";
import type { BuildCatalogData, CompositeResolved, RuntimeRenderInput } from "../catalog-core/index.js";
import { surfaceRuntimeCallbacks, surfaceRendererId } from "../runtime/index.js";
import { surfaceRuntimeIdentity } from "../catalog-core/surface-check.js";
import { routeBreakpointPixels, routeBreakpointsReady } from "./route-data.js";
import type { NativeRouteFrameData } from "./route-data.js";

/** Original frame behaviour stays on the client; finite hrefs never carry callbacks. */
export function nativeRouteNavigate(href: string): void {
  const next = new URL(href, window.location.href);
  if (next.origin === window.location.origin && next.pathname === window.location.pathname) {
    window.history.pushState(null, "", next.href);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else window.location.assign(next.href);
}
export function useNativeRouteBreakpoints(profile: CompositeResolved, rootFontSizeToken?: string) {
  const deterministic = useMemo(() => routeBreakpointPixels(profile, rootFontSizeToken), [profile, rootFontSizeToken]);
  const [measurement, setMeasurement] = useState<{ profile: CompositeResolved; rootFontSizeToken?: string; values: Readonly<Record<string, number>> }>();
  useEffect(() => {
    if (routeBreakpointsReady(profile, deterministic)) return;
    const measure = () => {
      const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      if (!Number.isFinite(rootPx) || rootPx <= 0) return;
      const actual: Record<string, number> = {};
      for (const [id, member] of Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint."))) {
        const value = member.value.light;
        if (value && typeof value === "object" && !Array.isArray(value) && "unit" in value && "value" in value && value.unit === "rem" && typeof value.value === "number") actual[id] = value.value * rootPx;
      }
      const values = routeBreakpointPixels(profile, undefined, actual);
      setMeasurement(previous => previous?.profile === profile && runtimeHash(previous.values) === runtimeHash(values) ? previous : { profile, rootFontSizeToken, values });
    };
    measure();
    const observer = typeof MutationObserver === "function" ? new MutationObserver(measure) : undefined;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [profile, rootFontSizeToken, deterministic]);
  const values = routeBreakpointsReady(profile, deterministic) ? deterministic : measurement?.profile === profile && measurement.rootFontSizeToken === rootFontSizeToken ? measurement.values : deterministic;
  return { values, ready: routeBreakpointsReady(profile, values) };
}
/** Native display composition only. No route/source/materialization/lifecycle
 * receipt is created here; the existing registered route validators own those. */
export function NativeRouteFrame({ data, profile, contracts, children, header }: { readonly data: NativeRouteFrameData; readonly profile: CompositeResolved; readonly contracts: BuildCatalogData; readonly children: ReactNode; readonly header?: NativeRouteFrameData["header"] }) {
  const renderers = useMemo(() => surfaceRuntimeCallbacks(data.manifest.fills.map(fill => fill.leaf)), [data.manifest]);
  const content = useMemo(() => new Map(data.contents.map(row => [runtimeHash(row.reference), row])), [data.contents]);
  const ports = useMemo(() => ({ manifest: data.manifest, renderers, resolveContent: (ref: import("../catalog-core/index.js").RuntimeContentRef) => content.get(runtimeHash(ref)), frameHost: { navigate: nativeRouteNavigate } }), [data.manifest, renderers, content]);
  const checked = checkConsumerRuntimePorts(ports, contracts, { consumer: profile.consumer, libraryHash: data.manifest.libraryHash, selectionHash: profile.selectionHash as `sha256:${string}` });
  const selected = profile.surfaces?.fills[data.frame.leaf], descriptor = data.manifest.fills.find(fill => fill.leaf === data.frame.leaf && fill.fill === data.frame.fill && fill.config === data.frame.config && fill.library === profile.consumer);
  if (checked.status !== "valid" || !selected || !descriptor || selected.document.$extensions["com.clossys.fill"].id !== data.frame.fill || descriptor.kind !== "frame" || runtimeHash(descriptor.surface) !== runtimeHash(surfaceRuntimeIdentity(selected)) || descriptor.renderer.id !== surfaceRendererId(descriptor.leaf) || !descriptor.headerModule || runtimeSourceFindings(descriptor.headerModule.renderer).length || data.frame.members.some(member => !descriptor.members.includes(member))) return <Banner variant="danger">Selected route frame unavailable</Banner>;
  const resolved: Record<string, import("../catalog-core/index.js").RuntimeContent> = {};
  for (const [slot, reference] of Object.entries(data.frame.content)) {
    const value = ports.resolveContent(reference);
    if (!value || value.hash !== runtimeHash(value.value)) return <Banner variant="danger">Selected route frame content unavailable</Banner>;
    resolved[slot] = value;
  }
  const lease = header ?? data.header;
  const input: RuntimeRenderInput<ReactNode> = { path: "frame", fill: descriptor, selection: data.frame, content: resolved, slots: { main: [<Fragment key="studio">{children}</Fragment>] }, profile, cell: data.cell, host: ports.frameHost, pageHeader: { ...lease, module: descriptor.headerModule } };
  return <>{renderers[descriptor.renderer.id]!(input)}</>;
}

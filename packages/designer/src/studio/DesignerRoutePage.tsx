"use client";
import { useMemo, type CSSProperties } from "react";
import { Banner } from "../components/Banner.js";
import { surfaceRuntimeCallbacks } from "../runtime/index.js";
import { runtimeHash } from "../catalog-core/index.js";
import { WholeStudioProvider, useWholeStudio } from "./WholeStudioProvider.js";
import { Studio } from "./Studio.js";
import { checkedDesignerRouteData } from "./route-data.js";
import type { DesignerRoutePageProps } from "./route-data.js";
import { NativeRouteFrame, nativeRouteNavigate, useNativeRouteBreakpoints } from "./native-route-frame.js";
import { routeStudioLabels } from "./route-labels.js";

/** Complete original read-only Designer. Only finite data and the original
 * checked initial session enter; the provider, camera and actions stay local.
 * This native browser display grants no registered source/lifecycle clearance. */
export function DesignerRoutePage({ serverData, initialSession, ...agent }: DesignerRoutePageProps) {
  const checked = useMemo(() => {
    if (!initialSession) return { status: "pending" as const };
    try { return { status: "ready" as const, value: checkedDesignerRouteData(serverData, initialSession) }; }
    catch { return { status: "refused" as const }; }
  }, [serverData, initialSession]);
  if (checked.status === "pending") return <Banner>Loading Designer session</Banner>;
  if (checked.status === "refused") return <Banner variant="danger">Designer initial data does not match its session</Banner>;
  return <CheckedDesignerRoute checked={checked.value} initialSession={initialSession!} agent={agent} />;
}
function CheckedDesignerRoute({ checked, initialSession, agent }: { agent: import("./system-canvas/inspector/types.js").DesignerAgentData; checked: ReturnType<typeof checkedDesignerRouteData>; initialSession: NonNullable<DesignerRoutePageProps["initialSession"]> }) {
  const { data, catalog, contracts } = checked;
  const adapter = useMemo(() => {
    const content = new Map(data.contents.map(row => [runtimeHash(row.reference), row]));
    const runtime = { manifest: data.manifest, renderers: surfaceRuntimeCallbacks(data.manifest.fills.map(fill => fill.leaf)), resolveContent: (ref: import("../catalog-core/index.js").RuntimeContentRef) => content.get(runtimeHash(ref)), frameHost: { navigate: nativeRouteNavigate } };
    return { kind: "composite" as const, catalog, contracts, load: async () => ({ ...data.snapshot, runtime }) };
  }, [data, catalog, contracts]);
  return <WholeStudioProvider adapter={adapter} labels={routeStudioLabels} initialSession={initialSession} initialSlotId={data.initialSlotId}><DesignerRouteSurface checked={checked} agent={agent} /></WholeStudioProvider>;
}
function DesignerRouteSurface({ checked, agent }: { agent: import("./system-canvas/inspector/types.js").DesignerAgentData; checked: ReturnType<typeof checkedDesignerRouteData> }) {
  const whole = useWholeStudio()!;
  const pixels = useNativeRouteBreakpoints(checked.profile, checked.data.rootFontSizeToken);
  if (!pixels.ready) return <Banner>Measuring Designer breakpoints</Banner>;
  if (whole.failed) return <Banner variant="danger">Could not load Designer session</Banner>;
  const { nav: _legacyLayerTabs, ...headerData } = checked.data.header.data;
  const header = { ...checked.data.header, data: headerData };
  return <div data-route-display="designer" data-route-authentication="unverified" data-route-session={whole.sessionIdentity} data-route-layer={whole.layer} className="absolute inset-0 min-h-0 min-w-0" style={Object.fromEntries(Object.entries(pixels.values).map(([id, px]) => [`--breakpoint-${id.slice("tokens.breakpoint.".length)}`, `${px}px`])) as CSSProperties}><NativeRouteFrame data={checked.data} profile={checked.profile} contracts={checked.contracts} header={header}><Studio {...agent} /></NativeRouteFrame></div>;
}

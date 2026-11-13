"use client";
import { useMemo } from "react";
import { Alert } from "../components/preview-runtime/components/banner/alert.js";
import { ALERT_TONE } from "../components/surface-tones.js";
import { defaultComponentPreviews } from "./default-component-previews.js";
import { surfaceRuntimeCallbacks } from "../runtime/index.js";
import { runtimeHash } from "../catalog-core/index.js";
import { WholeStudioProvider, useWholeStudio } from "./WholeStudioProvider.js";
import { Studio } from "./Studio.js";
import { checkedDesignerRouteData } from "./route-data.js";
import type { DesignerRoutePageProps } from "./route-data.js";
import { NativeRouteFrame, nativeRouteNavigate } from "./native-route-frame.js";
import { createRouteStudioLabels, readRouteStudioLabel } from "./route-labels.js";
import { studioCopyNeed, type StudioCopyBinding } from "./copy-binding.js";
import { StudioCopyProvider, useStudioCopy } from "./copy-context.js";

/** Complete original read-only Designer. Only finite data and the original
 * checked initial session enter; the provider, camera and actions stay local.
 * This native browser display grants no registered source/lifecycle clearance. */
export function DesignerRoutePage({ serverData, initialSession, copy }: DesignerRoutePageProps) {
  const checked = useMemo(() => {
    if (!initialSession) return { status: "pending" as const };
    try { return { status: "ready" as const, value: checkedDesignerRouteData(serverData, initialSession) }; }
    catch { return { status: "refused" as const }; }
  }, [serverData, initialSession]);
  if (!copy) return studioCopyNeed("designer.route.copy");
  if (checked.status === "pending") return <Alert {...ALERT_TONE.info}>{readRouteStudioLabel(copy, "route.pending")}</Alert>;
  if (checked.status === "refused") return <Alert {...ALERT_TONE.danger}>{readRouteStudioLabel(copy, "route.refused")}</Alert>;
  return <StudioCopyProvider binding={copy}><CheckedDesignerRoute copy={copy} checked={checked.value} initialSession={initialSession!} /></StudioCopyProvider>;
}
function CheckedDesignerRoute({ checked, initialSession, copy }: { copy: StudioCopyBinding; checked: ReturnType<typeof checkedDesignerRouteData>; initialSession: NonNullable<DesignerRoutePageProps["initialSession"]> }) {
  const { data, catalog, contracts } = checked;
  const adapter = useMemo(() => {
    const content = new Map(data.contents.map(row => [runtimeHash(row.reference), row]));
    const runtime = { manifest: data.manifest, renderers: surfaceRuntimeCallbacks(data.manifest.fills.map(fill => fill.leaf)), resolveContent: (ref: import("../catalog-core/index.js").RuntimeContentRef) => content.get(runtimeHash(ref)), frameHost: { navigate: nativeRouteNavigate } };
    return { kind: "composite" as const, catalog, contracts, load: async () => ({ ...data.snapshot, runtime, preview: defaultComponentPreviews.preview }) };
  }, [data, catalog, contracts]);
  const labels = useMemo(() => createRouteStudioLabels(copy), [copy]);
  return <WholeStudioProvider copy={copy} adapter={adapter} labels={labels} initialSession={initialSession} initialSlotId={data.initialSlotId}><DesignerRouteSurface checked={checked} /></WholeStudioProvider>;
}
function DesignerRouteSurface({ checked }: { checked: ReturnType<typeof checkedDesignerRouteData> }) {
  const whole = useWholeStudio()!;
  const copy = useStudioCopy();
  if (whole.failed) return <Alert {...ALERT_TONE.danger}>{readRouteStudioLabel(copy, "route.failed")}</Alert>;
  const { nav: _legacyLayerTabs, ...headerData } = checked.data.header.data;
  const header = { ...checked.data.header, data: headerData };
  return <div data-route-display="designer" data-route-authentication="unverified" data-route-session={whole.sessionIdentity} data-route-layer={whole.layer} className="absolute inset-0 min-h-0 min-w-0"><NativeRouteFrame data={checked.data} profile={checked.profile} contracts={checked.contracts} header={header}><Studio copy={copy} /></NativeRouteFrame></div>;
}

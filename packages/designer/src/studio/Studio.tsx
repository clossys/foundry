"use client";

import { StudioCanvas } from "./StudioCanvas.js";
import { StudioHeader } from "./StudioHeader.js";
import { StudioProvider, useOptionalStudioSession } from "./StudioProvider.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import type { CompositeStudioProps, StudioCanvasProps, StudioProps } from "./types.js";

/** Actual field boundary shared by the Studio surface and consumer-supplied editors. */
export function StudioEditBoundary({ children }: { children: React.ReactNode }) {
  const state = useOptionalStudioSession();
  return <div onBlurCapture={() => { void state?.autosave?.flush(); }} onKeyDownCapture={event => { if (event.key === "Enter") void state?.autosave?.flush(); }} className="isolate flex h-full w-full min-h-0 min-w-0 flex-col">{children}</div>;
}
function StudioSurface({ header = "internal", ...props }: StudioCanvasProps) {
  return <StudioEditBoundary>
    {header === "internal" ? <StudioHeader /> : null}
    <StudioCanvas className={props.className} panelInsets={props.panelInsets} candidateWorkflow={props.candidateWorkflow} />
  </StudioEditBoundary>;
}
export function Studio(props: StudioCanvasProps): React.JSX.Element;
export function Studio(props: StudioProps): React.JSX.Element;
export function Studio(props: CompositeStudioProps): React.JSX.Element;
/** Standalone creates one session; a host provider lets the cohesive header live elsewhere. */
export function Studio(props: StudioProps | CompositeStudioProps | StudioCanvasProps) {
  const session = useOptionalStudioSession();
  if (session) return <StudioSurface header={props.header} panelInsets={props.panelInsets} className={props.className} candidateWorkflow={props.candidateWorkflow} />;
  if (!("adapter" in props)) throw new TypeError("StudioProvider");
  const surface = <StudioSurface header={props.header} panelInsets={props.panelInsets} className={props.className} candidateWorkflow={props.candidateWorkflow} />;
  if ("kind" in props.adapter && props.adapter.kind === "composite") {
    const composite = props as CompositeStudioProps;
    return <WholeStudioProvider sessionRef={composite.sessionRef} adapter={composite.adapter} labels={composite.labels} initialSlotId={composite.initialSlotId} livePreview={composite.livePreview}>{surface}</WholeStudioProvider>;
  }
  const legacy = props as StudioProps;
  return <StudioProvider sessionRef={legacy.sessionRef} adapter={legacy.adapter} labels={legacy.labels} initialSlotId={legacy.initialSlotId} livePreview={legacy.livePreview} catalog={legacy.catalog}>{surface}</StudioProvider>;
}

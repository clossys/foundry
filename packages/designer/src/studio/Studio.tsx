"use client";

import { StudioCanvas } from "./StudioCanvas.js";
import { StudioProvider, useOptionalStudioSession } from "./StudioProvider.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import type { CompositeStudioProps, StudioCanvasProps, StudioProps } from "./types.js";

/** The canvas and its right rail. There are no layer tabs: the rail's Explorer card switches layers. */
function StudioSurface(props: StudioCanvasProps) {
  return <div className="isolate flex h-full w-full min-h-0 min-w-0 flex-col">
    <StudioCanvas className={props.className} panelInsets={props.panelInsets} candidateWorkflow={props.candidateWorkflow} />
  </div>;
}
export function Studio(props: StudioCanvasProps): React.JSX.Element;
export function Studio(props: StudioProps): React.JSX.Element;
export function Studio(props: CompositeStudioProps): React.JSX.Element;
/** Standalone creates one session; inside a host provider it renders that provider's session. */
export function Studio(props: StudioProps | CompositeStudioProps | StudioCanvasProps) {
  const session = useOptionalStudioSession();
  if (session) return <StudioSurface panelInsets={props.panelInsets} className={props.className} candidateWorkflow={props.candidateWorkflow} />;
  if (!("adapter" in props)) throw new TypeError("StudioProvider");
  const surface = <StudioSurface panelInsets={props.panelInsets} className={props.className} candidateWorkflow={props.candidateWorkflow} />;
  if ("kind" in props.adapter && props.adapter.kind === "composite") {
    const composite = props as CompositeStudioProps;
    return <WholeStudioProvider adapter={composite.adapter} labels={composite.labels} initialSlotId={composite.initialSlotId}>{surface}</WholeStudioProvider>;
  }
  const legacy = props as StudioProps;
  return <StudioProvider adapter={legacy.adapter} labels={legacy.labels} initialSlotId={legacy.initialSlotId} catalog={legacy.catalog}>{surface}</StudioProvider>;
}

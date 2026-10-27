"use client";

import { StudioCanvas } from "./StudioCanvas.js";
import { StudioHeader } from "./StudioHeader.js";
import { StudioProvider, useOptionalStudioSession } from "./StudioProvider.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import type { CompositeStudioProps, StudioCanvasProps, StudioProps } from "./types.js";

function StudioSurface({ header = "internal", ...props }: StudioCanvasProps) {
  return <div className="isolate flex h-full w-full min-h-0 min-w-0 flex-col">
    {header === "internal" ? <StudioHeader /> : null}
    <StudioCanvas className={props.className} panelInsets={props.panelInsets} candidateWorkflow={props.candidateWorkflow} />
  </div>;
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
    return <WholeStudioProvider adapter={composite.adapter} labels={composite.labels} initialSlotId={composite.initialSlotId}>{surface}</WholeStudioProvider>;
  }
  const legacy = props as StudioProps;
  return <StudioProvider adapter={legacy.adapter} labels={legacy.labels} initialSlotId={legacy.initialSlotId} catalog={legacy.catalog}>{surface}</StudioProvider>;
}

"use client";

import { DesignerPage } from "./system-canvas/DesignerPage.js";
import { StudioProvider, useOptionalStudioSession } from "./StudioProvider.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import type { CompositeStudioProps, StudioCanvasProps, StudioProps } from "./types.js";
import { StudioCopyProvider } from "./copy-context.js";

/** The canvas and its right rail. There are no layer tabs: the rail's Explorer card switches layers. */
function StudioSurface(props: StudioCanvasProps) {
  const surface = <div className="style-nova isolate flex h-full w-full min-h-0 min-w-0 flex-col">
    <DesignerPage copy={props.copy} className={props.className} changeCommandFor={props.changeCommandFor} writeHistory={props.writeHistory} decisions={props.decisions} renderStaticThumbnail={props.renderStaticThumbnail} />
  </div>;
  return <StudioCopyProvider binding={props.copy}>{surface}</StudioCopyProvider>;
}
export function Studio(props: StudioCanvasProps): React.JSX.Element;
export function Studio(props: StudioProps): React.JSX.Element;
export function Studio(props: CompositeStudioProps): React.JSX.Element;
/** Standalone creates one session; inside a host provider it renders that provider's session. */
export function Studio(props: StudioProps | CompositeStudioProps | StudioCanvasProps) {
  const session = useOptionalStudioSession();
  if (session) return <StudioSurface {...props} />;
  if (!("adapter" in props)) throw new TypeError("StudioProvider");
  const surface = <StudioSurface {...props} />;
  if ("kind" in props.adapter && props.adapter.kind === "composite") {
    const composite = props as CompositeStudioProps;
    return <WholeStudioProvider copy={composite.copy} adapter={composite.adapter} labels={composite.labels} initialSlotId={composite.initialSlotId}>{surface}</WholeStudioProvider>;
  }
  const legacy = props as StudioProps;
  return <StudioProvider copy={legacy.copy} adapter={legacy.adapter} labels={legacy.labels} initialSlotId={legacy.initialSlotId} catalog={legacy.catalog}>{surface}</StudioProvider>;
}

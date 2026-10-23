"use client";

import { StudioCanvas } from "./StudioCanvas.js";
import { StudioHeader } from "./StudioHeader.js";
import { StudioProvider, useOptionalStudioSession } from "./StudioProvider.js";
import type { StudioCanvasProps, StudioProps } from "./types.js";

function StudioSurface({ header = "internal", ...props }: StudioCanvasProps) {
  return <div className="flex min-h-0 min-w-0 flex-col" style={{ blockSize: "100%", inlineSize: "100%" }}>
    {header === "internal" ? <StudioHeader /> : null}
    <StudioCanvas {...props} />
  </div>;
}
export function Studio(props: StudioCanvasProps): React.JSX.Element;
export function Studio(props: StudioProps): React.JSX.Element;
/** Standalone creates one session; a host provider lets the cohesive header live elsewhere. */
export function Studio(props: StudioProps | StudioCanvasProps) {
  const session = useOptionalStudioSession();
  if (session) return <StudioSurface {...props} />;
  if (!("adapter" in props)) throw new TypeError("StudioProvider");
  return <StudioProvider {...props}><StudioSurface {...props} /></StudioProvider>;
}

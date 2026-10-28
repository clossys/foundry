"use client";
import { useMemo } from "react";
import { DesignerRoutePage as NativeDesignerRoutePage } from "@clossys/designer/studio/route";
import type { DesignerRoutePageProps as NativeDesignerRoutePageProps } from "@clossys/designer/studio/route";
import { withCompleteRouteNavigation } from "./complete-route-navigation.js";
import type { CompleteRouteServerData } from "./complete-route-navigation.js";
export type DesignerRouteServerData = CompleteRouteServerData;
export interface DesignerRoutePageProps extends Omit<NativeDesignerRoutePageProps, "serverData"> {
  readonly serverData: DesignerRouteServerData;
}
/** Publisher owns registry data; the original Designer controller and frame render it. */
export function DesignerRoutePage({ serverData, ...props }: DesignerRoutePageProps) {
  const data = useMemo(() => withCompleteRouteNavigation(serverData), [serverData]);
  return <NativeDesignerRoutePage {...props} serverData={data} />;
}

import { LayoutPreview } from "../layouts/preview/LayoutPreview.js";
import type { LayoutPreviewProps } from "../layouts/preview/LayoutPreview.js";
import { PreviewViewport } from "../layouts/preview/PreviewViewport.js";
/** Isolated roots retain the host's actual token binding at the existing controlled viewport sizes. */
export function CompositionSkeletonFrame(props: LayoutPreviewProps) {
  if (props.width !== 320 && props.width !== 768 && props.width !== 1280) throw new TypeError("Unsupported composition preview viewport");
  return <PreviewViewport width={props.width} theme={props.theme} mode="composition" title={`${props.width} px ${props.theme} contract preview`}>
    <LayoutPreview leaf={props.leaf} width={props.width} breakpointValues={props.breakpointValues} theme={props.theme} config={props.config} members={props.members} />
  </PreviewViewport>;
}

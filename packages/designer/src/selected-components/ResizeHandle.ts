/** Selected component facade; original types remain the standalone API. */
export type * from "../components/ResizeHandle.js";
import { selectedComponent } from "#designer-component-selection";
import { ResizeHandle as StandaloneResizeHandle } from "../components/ResizeHandle.js";
export const ResizeHandle = selectedComponent("ResizeHandle", StandaloneResizeHandle);

/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Tooltip.js";
import { selectedComponent } from "#designer-component-selection";
import { Tooltip as StandaloneTooltip } from "../components/Tooltip.js";
export const Tooltip = selectedComponent("Tooltip", StandaloneTooltip);

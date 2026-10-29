/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Popover.js";
import { selectedComponent } from "#designer-component-selection";
import { Popover as StandalonePopover } from "../components/Popover.js";
export const Popover = selectedComponent("Popover", StandalonePopover);

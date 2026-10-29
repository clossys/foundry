/** Selected component facade; original types remain the standalone API. */
export type * from "../components/ToggleButton.js";
import { selectedComponent } from "#designer-component-selection";
import { ToggleButton as StandaloneToggleButton } from "../components/ToggleButton.js";
export const ToggleButton = selectedComponent("ToggleButton", StandaloneToggleButton);

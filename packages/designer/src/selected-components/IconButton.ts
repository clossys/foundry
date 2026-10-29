/** Selected component facade; original types remain the standalone API. */
export type * from "../components/IconButton.js";
import { selectedComponent } from "#designer-component-selection";
import { IconButton as StandaloneIconButton } from "../components/IconButton.js";
export const IconButton = selectedComponent("IconButton", StandaloneIconButton);

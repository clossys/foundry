/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Icon.js";
import { selectedComponent } from "#designer-component-selection";
import { Icon as StandaloneIcon } from "../components/Icon.js";
export const Icon = selectedComponent("Icon", StandaloneIcon);

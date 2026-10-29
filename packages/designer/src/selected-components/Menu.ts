/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Menu.js";
import { selectedComponent } from "#designer-component-selection";
import { Menu as StandaloneMenu } from "../components/Menu.js";
export const Menu = selectedComponent("Menu", StandaloneMenu);

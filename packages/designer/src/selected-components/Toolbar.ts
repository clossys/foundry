/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Toolbar.js";
import { selectedComponent } from "#designer-component-selection";
import { Toolbar as StandaloneToolbar } from "../components/Toolbar.js";
export const Toolbar = selectedComponent("Toolbar", StandaloneToolbar);

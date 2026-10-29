/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Switch.js";
import { selectedComponent } from "#designer-component-selection";
import { Switch as StandaloneSwitch } from "../components/Switch.js";
export const Switch = selectedComponent("Switch", StandaloneSwitch);

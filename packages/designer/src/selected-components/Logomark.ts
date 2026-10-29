/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Logomark.js";
import { selectedComponent } from "#designer-component-selection";
import { Logomark as StandaloneLogomark } from "../components/Logomark.js";
export const Logomark = selectedComponent("Logo", StandaloneLogomark);

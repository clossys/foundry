/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Banner.js";
import { selectedComponent } from "#designer-component-selection";
import { Banner as StandaloneBanner } from "../components/Banner.js";
export const Banner = selectedComponent("Banner", StandaloneBanner);

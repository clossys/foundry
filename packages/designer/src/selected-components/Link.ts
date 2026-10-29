/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Link.js";
import { selectedComponent } from "#designer-component-selection";
import { Link as StandaloneLink } from "../components/Link.js";
export const Link = selectedComponent("Link", StandaloneLink);

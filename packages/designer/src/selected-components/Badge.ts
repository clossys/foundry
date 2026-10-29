/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Badge.js";
import { selectedComponent } from "#designer-component-selection";
import { Badge as StandaloneBadge } from "../components/Badge.js";
export const Badge = selectedComponent("Badge", StandaloneBadge);

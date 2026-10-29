/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Avatar.server.js";
import { selectedComponent } from "#designer-component-selection";
import { Avatar as StandaloneAvatar } from "../components/Avatar.server.js";
export const Avatar = selectedComponent("Avatar", StandaloneAvatar);

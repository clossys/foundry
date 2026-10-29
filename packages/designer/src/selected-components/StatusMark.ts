/** Selected component facade; original types remain the standalone API. */
export type * from "../components/StatusMark.js";
import { selectedComponent } from "#designer-component-selection";
import { StatusMark as StandaloneStatusMark } from "../components/StatusMark.js";
export const StatusMark = selectedComponent("StatusMark", StandaloneStatusMark);

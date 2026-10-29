/** Selected component facade; original types remain the standalone API. */
export type * from "../components/TextField.js";
import { selectedComponent } from "#designer-component-selection";
import { TextField as StandaloneTextField } from "../components/TextField.js";
export const TextField = selectedComponent("TextField", StandaloneTextField);

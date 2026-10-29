/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Button.js";
import { selectedComponent } from "#designer-component-selection";
import { Button as StandaloneButton } from "../components/Button.js";
export const Button = selectedComponent("Button", StandaloneButton);

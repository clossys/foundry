/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Checkbox.js";
import { selectedComponent } from "#designer-component-selection";
import { Checkbox as StandaloneCheckbox } from "../components/Checkbox.js";
export const Checkbox = selectedComponent("Checkbox", StandaloneCheckbox);

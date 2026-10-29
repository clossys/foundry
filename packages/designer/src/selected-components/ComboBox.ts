/** Selected component facade; original types remain the standalone API. */
export type * from "../components/ComboBox.js";
import { selectedComponent } from "#designer-component-selection";
import { ComboBox as StandaloneComboBox } from "../components/ComboBox.js";
export const ComboBox = selectedComponent("ComboBox", StandaloneComboBox);

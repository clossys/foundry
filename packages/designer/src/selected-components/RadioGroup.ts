/** Selected component facade; original types remain the standalone API. */
export type * from "../components/RadioGroup.js";
import { selectedComponent } from "#designer-component-selection";
import { RadioGroup as StandaloneRadioGroup } from "../components/RadioGroup.js";
export const RadioGroup = selectedComponent("RadioGroup", StandaloneRadioGroup);

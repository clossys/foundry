/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Select.js";
import { selectedComponent } from "#designer-component-selection";
import { Select as StandaloneSelect } from "../components/Select.js";
export const Select = selectedComponent("Select", StandaloneSelect);

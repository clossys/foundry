/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Textarea.js";
import { selectedComponent } from "#designer-component-selection";
import { Textarea as StandaloneTextarea } from "../components/Textarea.js";
export const Textarea = selectedComponent("Textarea", StandaloneTextarea);

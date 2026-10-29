/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Dialog.js";
import { selectedComponent } from "#designer-component-selection";
import { Dialog as StandaloneDialog } from "../components/Dialog.js";
export const Dialog = selectedComponent("Dialog", StandaloneDialog);

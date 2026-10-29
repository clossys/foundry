/** Selected component facade; original types remain the standalone API. */
export type * from "../components/ProgressBar.js";
import { selectedComponent } from "#designer-component-selection";
import { ProgressBar as StandaloneProgressBar } from "../components/ProgressBar.js";
export const ProgressBar = selectedComponent("ProgressBar", StandaloneProgressBar);

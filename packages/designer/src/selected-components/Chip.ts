/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Chip.js";
import { selectedComponent } from "#designer-component-selection";
import { Chip as StandaloneChip } from "../components/Chip.js";
export const Chip = selectedComponent("Chip", StandaloneChip);

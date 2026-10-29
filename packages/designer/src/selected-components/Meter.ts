/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Meter.js";
import { selectedComponent } from "#designer-component-selection";
import { Meter as StandaloneMeter } from "../components/Meter.js";
export const Meter = selectedComponent("Meter", StandaloneMeter);

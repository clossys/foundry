/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Skeleton.js";
import { selectedComponent } from "#designer-component-selection";
import { Skeleton as StandaloneSkeleton } from "../components/Skeleton.js";
export const Skeleton = selectedComponent("Skeleton", StandaloneSkeleton);

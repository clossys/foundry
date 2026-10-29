/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Breadcrumb.js";
import { selectedComponent } from "#designer-component-selection";
import { Breadcrumb as StandaloneBreadcrumb } from "../components/Breadcrumb.js";
export const Breadcrumb = selectedComponent("Breadcrumb", StandaloneBreadcrumb);

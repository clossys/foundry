/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Tabs.js";
import { selectedComponent } from "#designer-component-selection";
import { Tabs as StandaloneTabs } from "../components/Tabs.js";
export const Tabs = selectedComponent("Tabs", StandaloneTabs);

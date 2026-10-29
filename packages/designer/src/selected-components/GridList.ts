/** Selected component facade; original types remain the standalone API. */
export type * from "../components/GridList.js";
import { selectedComponent } from "#designer-component-selection";
import { GridList as StandaloneGridList } from "../components/GridList.js";
export const GridList = selectedComponent("GridList", StandaloneGridList);

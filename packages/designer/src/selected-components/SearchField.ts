/** Selected component facade; original types remain the standalone API. */
export type * from "../components/SearchField.js";
import { selectedComponent } from "#designer-component-selection";
import { SearchField as StandaloneSearchField } from "../components/SearchField.js";
export const SearchField = selectedComponent("SearchField", StandaloneSearchField);

/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Table.js";
import { selectedComponent } from "#designer-component-selection";
import { Table as StandaloneTable } from "../components/Table.js";
export const Table = selectedComponent("Table", StandaloneTable);

/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Disclosure.js";
import { selectedComponent } from "#designer-component-selection";
import { Disclosure as StandaloneDisclosure } from "../components/Disclosure.js";
export const Disclosure = selectedComponent("Disclosure", StandaloneDisclosure);

/** Selected server-safe component facades; no interactive package barrel. */
export type * from "../components/server.js";
export { buttonLinkClassName, iconButtonLinkClassName, mergeUiClasses } from "../components/server.js";
import { selectedComponent } from "#designer-component-selection";
import { Meter as StandaloneMeter, Icon as StandaloneIcon, SemanticContent as StandaloneSemanticContent, NativeAction as StandaloneNativeAction } from "../components/server.js";
export const Meter = selectedComponent("Meter", StandaloneMeter);
export const Icon = selectedComponent("Icon", StandaloneIcon);
export const SemanticContent = selectedComponent("SemanticContent", StandaloneSemanticContent);
export const NativeAction = selectedComponent("NativeAction", StandaloneNativeAction);

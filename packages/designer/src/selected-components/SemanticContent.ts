/** Selected component facade; original types remain the standalone API. */
export type * from "../components/SemanticContent.js";
import { selectedComponent } from "#designer-component-selection";
import { SemanticContent as StandaloneSemanticContent } from "../components/SemanticContent.js";
export const SemanticContent = selectedComponent("SemanticContent", StandaloneSemanticContent);

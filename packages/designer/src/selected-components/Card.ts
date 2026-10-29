/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Card.js";
import { selectedComponent } from "#designer-component-selection";
import { Card as StandaloneCard } from "../components/Card.js";
export const Card = selectedComponent("Card", StandaloneCard);

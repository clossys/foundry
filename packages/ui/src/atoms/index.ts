/**
 * @vespeneventures/ui/atoms — the first rung of a three-layer component
 * ladder (atoms → blocks → views; atoms and blocks both ship so far). An
 * atom is single-purpose: it either composes no other atom (`Button`,
 * `TextField`, `Badge`, `Card`), or its parts are homogeneous repeats
 * rather than named regions (`Breadcrumb` — a trail of interchangeable
 * crumbs, not a set of distinct slots). See this package's README,
 * "Placement rules", for the block/atom test this ladder is built on.
 * Anything that owns MULTIPLE NAMED regions (a title region, a description
 * region, an actions region — each different in kind, not just repeated)
 * belongs one layer up, in `@vespeneventures/ui/blocks`, not here.
 */

export { Button } from "./Button.js";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button.js";

export { TextField } from "./TextField.js";
export type { TextFieldProps } from "./TextField.js";

export { Badge } from "./Badge.js";
export type { BadgeProps, BadgeVariant } from "./Badge.js";

export { Card } from "./Card.js";
export type { CardProps } from "./Card.js";

export { Breadcrumb } from "./Breadcrumb.js";
export type { BreadcrumbProps, BreadcrumbItemProps } from "./Breadcrumb.js";

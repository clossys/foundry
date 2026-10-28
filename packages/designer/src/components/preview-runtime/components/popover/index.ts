import { createElement, forwardRef, type ComponentType } from "react";
import { Popover as Impl0 } from "./popover.js";
const stamp = {"data-ds-layer":"components","data-ds-leaf":"components.popover","data-ds-fill":"shadcn@aria/components.popover"} as const;
const reactKeys = new Set(["$$typeof", "render", "type", "compare", "displayName", "propTypes", "defaultProps", "contextType", "contextTypes", "childContextTypes", "getDefaultProps", "getDerivedStateFromProps", "getDerivedStateFromError", "mixins", "length", "name", "prototype", "arguments", "caller"]);
function statics(impl: unknown): Record<string, unknown> {
  const hoisted: Record<string, unknown> = {};
  if (typeof impl === "function" || (typeof impl === "object" && impl !== null)) for (const key of Object.getOwnPropertyNames(impl)) if (!reactKeys.has(key)) hoisted[key] = (impl as Record<string, unknown>)[key];
  return hoisted;
}
const target = Impl0 satisfies ((props: never) => unknown) | (new (props: never) => unknown);
const Stamped = forwardRef<unknown, Record<string, unknown>>(function Popover(props, ref) {
  return createElement(target as unknown as ComponentType<Record<string, unknown>>, { ...props, ...stamp, ref });
});
export const Popover = Object.assign(Stamped, statics(Impl0)) as unknown as typeof Impl0;

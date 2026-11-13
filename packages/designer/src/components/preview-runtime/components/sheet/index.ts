import { createElement, forwardRef, type ComponentType } from "react";
import { Sheet as Impl0 } from "./sheet.js";
export { SheetClose } from "./sheet.js";
export { SheetContent } from "./sheet.js";
export { SheetDescription } from "./sheet.js";
export { SheetFooter } from "./sheet.js";
export { SheetHeader } from "./sheet.js";
export { SheetTitle } from "./sheet.js";
export { SheetTrigger } from "./sheet.js";
const stamp = {"data-ds-layer":"components","data-ds-leaf":"components.sheet","data-ds-fill":"shadcn@aria/components.sheet"} as const;
const reactKeys = new Set(["$$typeof", "render", "type", "compare", "displayName", "propTypes", "defaultProps", "contextType", "contextTypes", "childContextTypes", "getDefaultProps", "getDerivedStateFromProps", "getDerivedStateFromError", "mixins", "length", "name", "prototype", "arguments", "caller"]);
function statics(impl: unknown): Record<string, unknown> {
  const hoisted: Record<string, unknown> = {};
  if (typeof impl === "function" || (typeof impl === "object" && impl !== null)) for (const key of Object.getOwnPropertyNames(impl)) if (!reactKeys.has(key)) hoisted[key] = (impl as Record<string, unknown>)[key];
  return hoisted;
}
const target = Impl0 satisfies ((props: never) => unknown) | (new (props: never) => unknown);
const Stamped = forwardRef<unknown, Record<string, unknown>>(function Sheet(props, ref) {
  return createElement(target as unknown as ComponentType<Record<string, unknown>>, { ...props, ...stamp, ref });
});
export const Sheet = Object.assign(Stamped, statics(Impl0)) as unknown as typeof Impl0;

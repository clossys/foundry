import { createElement, forwardRef, type ComponentType } from "react";
import { Calendar as Impl0 } from "./calendar.js";
import { RangeCalendar as Impl1 } from "./calendar.js";
const stamp = {"data-ds-layer":"components","data-ds-leaf":"components.calendar","data-ds-fill":"shadcn@aria/components.calendar"} as const;
const reactKeys = new Set(["$$typeof", "render", "type", "compare", "displayName", "propTypes", "defaultProps", "contextType", "contextTypes", "childContextTypes", "getDefaultProps", "getDerivedStateFromProps", "getDerivedStateFromError", "mixins", "length", "name", "prototype", "arguments", "caller"]);
function statics(impl: unknown): Record<string, unknown> {
  const hoisted: Record<string, unknown> = {};
  if (typeof impl === "function" || (typeof impl === "object" && impl !== null)) for (const key of Object.getOwnPropertyNames(impl)) if (!reactKeys.has(key)) hoisted[key] = (impl as Record<string, unknown>)[key];
  return hoisted;
}
const targets = { Impl0, Impl1 } satisfies Record<string, ((props: never) => unknown) | (new (props: never) => unknown)>;
const mappings: Record<string, Record<string, {target: string; property?: string; value?: unknown}>> = {
  "selection": {
    "range": {
      "target": "Impl1"
    },
    "single": {
      "target": "Impl0"
    }
  }
};
type Statics<T> = Omit<T, "$$typeof" | "render" | "type" | "compare" | "displayName" | "propTypes" | "defaultProps">;
const Dispatch = forwardRef<unknown, Record<string, unknown>>(function Calendar(props, ref) {
  const next = { ...props }; let target = "Impl0";
  for (const [axis, choices] of Object.entries(mappings)) {
    if (!(axis in props)) continue;
    const key = String(props[axis]); if (!Object.hasOwn(choices, key)) throw new Error("Unsupported component member");
    const mapping = choices[key]!;
    delete next[axis];
    if (mapping.target !== "Impl0") target = mapping.target;
    if (mapping.property) next[mapping.property] = mapping.value;
  }
  return createElement((targets as Record<string, unknown>)[target] as ComponentType<Record<string, unknown>>, { ...next, ...stamp, ref });
});
export const Calendar = Object.assign(Dispatch, statics(Impl0)) as unknown as typeof Dispatch & Statics<typeof Impl0>;

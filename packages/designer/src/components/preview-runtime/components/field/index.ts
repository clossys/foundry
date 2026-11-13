import { createElement, forwardRef, type ComponentType } from "react";
import { Field as Impl0 } from "./field.js";
import { FieldDescription as Impl1 } from "./field.js";
import { FieldError as Impl2 } from "./field.js";
import { FieldLabel as Impl3 } from "./field.js";
export { FieldContent } from "./field.js";
export { FieldDescription } from "./field.js";
export { FieldError } from "./field.js";
export { FieldGroup } from "./field.js";
export { FieldLabel } from "./field.js";
export { FieldLegend } from "./field.js";
export { FieldSeparator } from "./field.js";
export { FieldSet } from "./field.js";
export { FieldTitle } from "./field.js";
const stamp = {"data-ds-layer":"components","data-ds-leaf":"components.field","data-ds-fill":"defaults-consumer/components.field"} as const;
const reactKeys = new Set(["$$typeof", "render", "type", "compare", "displayName", "propTypes", "defaultProps", "contextType", "contextTypes", "childContextTypes", "getDefaultProps", "getDerivedStateFromProps", "getDerivedStateFromError", "mixins", "length", "name", "prototype", "arguments", "caller"]);
function statics(impl: unknown): Record<string, unknown> {
  const hoisted: Record<string, unknown> = {};
  if (typeof impl === "function" || (typeof impl === "object" && impl !== null)) for (const key of Object.getOwnPropertyNames(impl)) if (!reactKeys.has(key)) hoisted[key] = (impl as Record<string, unknown>)[key];
  return hoisted;
}
const targets = { Impl0, Impl1, Impl2, Impl3 } satisfies Record<string, ((props: never) => unknown) | (new (props: never) => unknown)>;
const mappings: Record<string, Record<string, {target: string; property?: string; value?: unknown}>> = {
  "part": {
    "description": {
      "target": "Impl1"
    },
    "error": {
      "target": "Impl2"
    },
    "label": {
      "target": "Impl3"
    }
  },
  "state": {
    "disabled": {
      "target": "Impl0",
      "property": "isDisabled",
      "value": true
    },
    "invalid": {
      "target": "Impl0",
      "property": "isInvalid",
      "value": true
    },
    "required": {
      "target": "Impl0",
      "property": "isRequired",
      "value": true
    }
  }
};
type Statics<T> = Omit<T, "$$typeof" | "render" | "type" | "compare" | "displayName" | "propTypes" | "defaultProps">;
const Dispatch = forwardRef<unknown, Record<string, unknown>>(function Field(props, ref) {
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
export const Field = Object.assign(Dispatch, statics(Impl0)) as unknown as typeof Dispatch & Statics<typeof Impl0>;

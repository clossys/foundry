import { createElement, forwardRef, type ComponentType } from "react";
import { Button as Impl0 } from "./button.js";
export { LinkButton } from "./button.js";
const stamp = {"data-ds-layer":"components","data-ds-leaf":"components.button","data-ds-fill":"shadcn@aria/components.button"} as const;
const reactKeys = new Set(["$$typeof", "render", "type", "compare", "displayName", "propTypes", "defaultProps", "contextType", "contextTypes", "childContextTypes", "getDefaultProps", "getDerivedStateFromProps", "getDerivedStateFromError", "mixins", "length", "name", "prototype", "arguments", "caller"]);
function statics(impl: unknown): Record<string, unknown> {
  const hoisted: Record<string, unknown> = {};
  if (typeof impl === "function" || (typeof impl === "object" && impl !== null)) for (const key of Object.getOwnPropertyNames(impl)) if (!reactKeys.has(key)) hoisted[key] = (impl as Record<string, unknown>)[key];
  return hoisted;
}
const targets = { Impl0 } satisfies Record<string, ((props: never) => unknown) | (new (props: never) => unknown)>;
const mappings: Record<string, Record<string, {target: string; property?: string; value?: unknown}>> = {
  "ground": {
    "base": {
      "target": "Impl0"
    }
  },
  "shape": {
    "icon-only": {
      "target": "Impl0",
      "property": "size",
      "value": "icon"
    },
    "text": {
      "target": "Impl0"
    }
  },
  "size": {
    "lg": {
      "target": "Impl0",
      "property": "size",
      "value": "lg"
    },
    "md": {
      "target": "Impl0",
      "property": "size",
      "value": "default"
    },
    "sm": {
      "target": "Impl0",
      "property": "size",
      "value": "sm"
    }
  },
  "state": {
    "disabled": {
      "target": "Impl0",
      "property": "isDisabled",
      "value": true
    }
  },
  "variant": {
    "danger": {
      "target": "Impl0",
      "property": "variant",
      "value": "destructive"
    },
    "ghost": {
      "target": "Impl0",
      "property": "variant",
      "value": "ghost"
    },
    "outline": {
      "target": "Impl0",
      "property": "variant",
      "value": "outline"
    },
    "primary": {
      "target": "Impl0",
      "property": "variant",
      "value": "default"
    },
    "secondary": {
      "target": "Impl0",
      "property": "variant",
      "value": "secondary"
    }
  }
};
type Statics<T> = Omit<T, "$$typeof" | "render" | "type" | "compare" | "displayName" | "propTypes" | "defaultProps">;
const Dispatch = forwardRef<unknown, Record<string, unknown>>(function Button(props, ref) {
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
export const Button = Object.assign(Dispatch, statics(Impl0)) as unknown as typeof Dispatch & Statics<typeof Impl0>;

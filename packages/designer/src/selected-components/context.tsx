"use client";

import * as React from "react";
import type { RuntimeComponentIndex, RuntimeRenderInput } from "../catalog-core/runtime-ports.js";

// Static server entrypoints must remain importable under react-server. Interactive
// consumer rendering enters this client boundary, where context is available.
const Selection = React.createContext?.<RuntimeComponentIndex | null>(null);
import { requireComponentIndex } from "./validate.js";
export { requireComponentIndex } from "./validate.js";
export function SelectedComponents({ components, children }: { readonly components: RuntimeComponentIndex; readonly children?: React.ReactNode }): React.ReactNode {
  requireComponentIndex(components);
  if (!Selection) throw new TypeError("runtime: selected components require the client runtime boundary");
  const Provider = components.LibraryProvider as React.ComponentType<{ children?: React.ReactNode }> | undefined;
  return <Selection.Provider value={components}>{Provider ? <Provider>{children}</Provider> : children}</Selection.Provider>;
}
/** A typed facade with standalone compatibility, never a fallback inside a selected runtime. */
export function selectedComponent<T>(name: string, standalone: T, members: readonly string[] = []): T {
  const nested = new Map<PropertyKey, unknown>();
  function Selected(props: Record<string, unknown>): React.ReactNode {
    const index = Selection ? React.useContext(Selection) : null;
    let component: unknown = index === null ? standalone : index[name];
    if (index !== null) for (const member of members) component = component && (component as Record<string, unknown>)[member];
    if (!component || typeof component !== "function" && typeof component !== "object") throw new TypeError(`runtime: selected component ${[name, ...members].join(".")} is missing from the consumer index`);
    return React.createElement(component as React.ElementType, props);
  }
  // React 18 forwards refs separately; React 19 also supports them in props.
  const target = React.forwardRef ? React.forwardRef((props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) => <Selected {...props} {...(ref === null ? {} : { ref })} />) : Selected;
  return new Proxy(target, {
    get(target, key, receiver) {
      if (Reflect.has(target, key) || typeof key !== "string") return Reflect.get(target, key, receiver);
      const part = standalone && (standalone as Record<string, unknown>)[key];
      if (typeof part !== "function" && (!part || typeof part !== "object" || !("$$typeof" in part))) return part;
      if (!nested.has(key)) nested.set(key, selectedComponent(name, part, [...members, key]));
      return nested.get(key);
    },
  }) as T;
}

/** Native server frames use the same selected boundary during ordinary SSR. */
export function renderWithSelectedComponents(leaf: string, input: RuntimeRenderInput<React.ReactNode>, render: (input: RuntimeRenderInput<React.ReactNode>) => React.ReactNode): React.ReactNode {
  return input.components === undefined ? render(input) : <SelectedComponents components={input.components}>{render(input)}</SelectedComponents>;
}

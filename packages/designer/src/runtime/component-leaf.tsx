import * as React from "react";
const SelectedComponentLeaf = React.lazy(async () => ({ default: (await import("./component-leaf.client.js")).SelectedComponentLeaf }));
export type { ConsumerComponentBinding, ConsumerComponentSelection } from "./component-leaf.client.js";

/** Server-safe facade: its client boundary resolves only the consumer's selected component leaf. */
export function componentLeaf<T>(leaf: `components.${string}`, part?: string): T {
  if (!/^components\.[a-z][a-z0-9-]*$/.test(leaf)) throw new TypeError("A registered component leaf id is required");
  const facade = (parts: readonly string[]): unknown => {
    const render = (props: Record<string, unknown>, ref?: React.Ref<unknown>): React.ReactNode => React.createElement(SelectedComponentLeaf, { leaf, parts, componentProps: ref ? { ...props, ref } : props });
    // React's server condition intentionally omits forwardRef. The facade may be
    // imported there, while ref attachment is owned by the client component.
    const Component = typeof React.forwardRef === "function" ? React.forwardRef<unknown, Record<string, unknown>>(render) : (props: Record<string, unknown>) => render(props);
    Object.defineProperty(Component, "displayName", { value: `${leaf}${parts.length ? `.${parts.join(".")}` : ""}` });
    return new Proxy(Component, { get(target, key, receiver) {
      if (typeof key !== "string" || Reflect.has(target, key)) return Reflect.get(target, key, receiver);
      if (!/^[A-Z][A-Za-z0-9]*$/.test(key)) return undefined;
      return facade([...parts, key]);
    } });
  };
  return facade(part ? [part] : []) as T;
}

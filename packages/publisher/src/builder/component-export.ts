/**
 * The export a mount takes when its record declares none, as source for a generated module:
 * `default`, else the first component export, a capitalised name whose value is a function
 * component or a memo, forwardRef or lazy wrapper. Never a hook (the flow canvas once mounted
 * `useReactFlow`), a context, its Provider or Consumer, or a plain object such as an enum.
 * `mod` is the generated module's name for the item's module namespace.
 */
export function firstComponentSource(mod: string): string {
  return `${mod}.default ?? Object.entries(${mod}).find(([name, value]) => /^[A-Z]/.test(name) && (typeof value === "function" || (!!value && typeof value === "object" && [Symbol.for("react.memo"), Symbol.for("react.forward_ref"), Symbol.for("react.lazy")].includes(value.$$typeof))))?.[1]`;
}

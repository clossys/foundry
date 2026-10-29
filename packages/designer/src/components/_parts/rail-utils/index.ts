import { cx } from "../../internal/cx.js"
import type { ClassValue, CopyResolver, CopyRef } from "./types.js"
export { type ClassValue, type VariantProps, type CopyResolver } from "./types.js"
export { RAIL_COPY_REFS } from "./copy.js"
function flatten(value: ClassValue): string {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.filter(Boolean).map(flatten).filter(Boolean).join(" ")
  if (value && typeof value === "object") {
    const keys: string[] = []
    for (const key in value) if ((value as { [key: string]: unknown })[key]) keys.push(key)
    return keys.join(" ")
  }
  return ""
}
export function classNames(...values: ClassValue[]): string { return values.filter(Boolean).map(flatten).filter(Boolean).join(" ") }
export function cn(...values: ClassValue[]): string { return cx(classNames(...values)) }
export function resolveRailCopy(resolver: CopyResolver | undefined, ref: CopyRef): string {
  if (!resolver) throw new TypeError("Designer component copy requires a host resolver")
  const result = resolver(ref)
  if (!result || result.ref.id !== ref.id || result.ref.locale !== ref.locale || typeof result.text !== "string" || !result.text.trim()) throw new TypeError(`Designer component copy unresolved: ${ref.id}`)
  return result.text
}

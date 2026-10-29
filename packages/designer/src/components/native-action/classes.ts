import type { ClassValue } from "./types.js"
export type { ClassValue } from "./types.js"
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

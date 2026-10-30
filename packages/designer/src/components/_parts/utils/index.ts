import { clsx, type ClassValue } from "clsx"

// Resolve the optional peer once, before any caller receives this module.
// Keep the default merge configuration: cn is distinct from token-aware cx.
const twMerge = await (async () => {
  try {
    return (await import("tailwind-merge")).twMerge
  } catch {
    return undefined
  }
})()

let warnedAbsent = false

export function cn(...inputs: ClassValue[]) {
  const joined = clsx(inputs)
  if (twMerge) return twMerge(joined)
  if (!warnedAbsent) {
    warnedAbsent = true
    console.warn(
      "[@clossys/designer] tailwind-merge (an optional peer) is unavailable, so cn() cannot resolve " +
      "conflicting Tailwind utilities. It is falling back to clsx-normalized, unmerged classes in " +
      "argument order; visual precedence depends on stylesheet order. Install tailwind-merge to " +
      "restore class-conflict resolution. This warning is logged once per process, not once per call.",
    )
  }
  return joined
}

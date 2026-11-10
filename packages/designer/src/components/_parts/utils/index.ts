import { clsx, type ClassValue } from "clsx"
import { MERGE_THEME_SCALE } from "../../../tokens/merge-scale.js"

// Resolve the optional peer once, before any caller receives this module.
// Extend the default merge configuration with the theme's spacing and radius scale only:
// cn stays distinct from token-aware cx, but a consumer's `gap-sm` must replace a default `gap-lg`.
// Only an absent peer degrades; an installed peer that fails to configure or merge propagates.
const twMerge = await (async () => {
  let peer: typeof import("tailwind-merge")
  try {
    peer = await import("tailwind-merge")
  } catch {
    return undefined
  }
  return peer.extendTailwindMerge({ extend: { theme: { spacing: [...MERGE_THEME_SCALE.spacing], radius: [...MERGE_THEME_SCALE.radius] } } })
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

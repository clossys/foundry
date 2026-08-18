import type { CompositionScope } from "./types.js";

/** Stable, delimiter-safe identity for one caller-owned scope. */
export function scopeKey(scope: CompositionScope): string {
  return `${scope.plane}\u0000${scope.id}`;
}

/** Stable, delimiter-safe identity for one capability within one exact scope. */
export function groupKey(capability: string, scope: CompositionScope): string {
  return `${scopeKey(scope)}\u0000${capability}`;
}

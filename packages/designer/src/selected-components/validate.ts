import type { RuntimeComponentIndex } from "../catalog-core/runtime-ports.js";

export function requireComponentIndex(value: unknown): asserts value is RuntimeComponentIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("runtime: consumer component index is required");
}

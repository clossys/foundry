import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";

/**
 * A dataset record read as plain RuntimeJson: the same values, with absent optional fields (`undefined`) left
 * out, so a block-typed `specimenDataset.sections` record can be handed to runtime assembly as is. A function,
 * React node or non-finite number is not content and throws instead of being dropped silently.
 */
export function plainJson(value: unknown, path = "dataset"): RuntimeJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => plainJson(item, `${path}.${index}`));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, plainJson(item, `${path}.${key}`)]));
  }
  throw new TypeError(`${path} is not plain dataset content`);
}

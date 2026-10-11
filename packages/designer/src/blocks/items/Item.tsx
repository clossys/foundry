import { assertItemAxes, assertItemData } from "./policies.js";
import { ItemRenderer } from "./render.js";
import type { ItemProps } from "./types.js";

/** A token-bound, server-safe item. Supplied native controls are refused when linked; opaque component output is not inspected. */
export function Item({ treatment, size, ground, ...item }: ItemProps) {
  assertItemAxes(treatment, size, ground);
  assertItemData(item);
  return <ItemRenderer item={item} treatment={treatment} size={size} ground={ground} />;
}

import { nativeDisclosureRow } from "../internal/disclosure-row.server.js";
import { itemDisclosureOptions } from "./reveal-policy.js";
import type { ItemData, ItemsProps } from "./types.js";

export function revealItem(item: ItemData, props: ItemsProps) {
  return nativeDisclosureRow(itemDisclosureOptions(item, props));
}

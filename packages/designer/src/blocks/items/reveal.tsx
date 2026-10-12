import { disclosureRow } from "../internal/disclosure-row.js";
import { itemDisclosureOptions } from "./reveal-policy.js";
import type { ItemData, ItemsProps } from "./types.js";

export function revealItem(item: ItemData, props: ItemsProps) {
  return disclosureRow(itemDisclosureOptions(item, props));
}

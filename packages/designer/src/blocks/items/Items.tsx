import { ItemsStatic } from "./ItemsStatic.js";
import { revealItem } from "./reveal.js";
import type { ItemsProps } from "./types.js";

/** Canonical items with React Aria disclosure rows when requested. */
export function Items(props: ItemsProps) { return ItemsStatic(props, revealItem); }

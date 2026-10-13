import { ItemsStatic } from "./ItemsStatic.js";
import { revealItem } from "./reveal.server.js";
import type { ItemsProps } from "./types.js";

/** Native disclosure rows keep the complete server graph React-server safe. */
export function Items(props: ItemsProps) { return ItemsStatic(props, revealItem); }

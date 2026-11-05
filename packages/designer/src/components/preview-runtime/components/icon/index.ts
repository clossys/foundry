import { createElement, type ComponentProps } from "react";
import { glyphs } from "../../adapters/glyphs.js";
import { Icon as Impl0 } from "../../../index.js";
type WithAsset<Props> = Props extends unknown ? Omit<Props, "glyph" | "children"> & { asset: keyof typeof glyphs } : never;
const stamp = {"data-ds-layer":"components","data-ds-leaf":"components.icon","data-ds-fill":"foundry/components.icon"} as const;
export function Icon({ asset, ...props }: WithAsset<ComponentProps<typeof Impl0>>) {
  const glyph = glyphs[asset]; if (!glyph) throw new Error("Missing consumer glyph");
  return createElement(Impl0, { ...props, ...stamp, glyph });
}

import { createElement, type ComponentProps } from "react";
import { Icon as Primitive } from "../Icon.js";
import { glyphs } from "../preview-runtime/adapters/glyphs.js";
import { LoaderCircle } from "../../icons/LoaderCircle.js";
import { PanelLeft } from "../../icons/PanelLeft.js";
const adoptedGlyphs = { ...glyphs, "assets.icon-panel-left": PanelLeft, "assets.icon-loader": LoaderCircle };
type WithAsset<Props> = Props extends unknown ? Omit<Props, "glyph" | "children"> & { asset: keyof typeof adoptedGlyphs } : never;
export function Icon({ asset, ...props }: WithAsset<ComponentProps<typeof Primitive>>) {
  const glyph = adoptedGlyphs[asset];
  if (!glyph) throw new Error("Missing consumer glyph");
  return createElement(Primitive, { ...props, glyph });
}

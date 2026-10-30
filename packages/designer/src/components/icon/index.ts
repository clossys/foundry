import { featureGlyphs } from "../../icons/feature-glyphs.js";
import { createElement, type ComponentProps } from "react";
import { Icon as Primitive } from "../Icon.js";
import { glyphs } from "../preview-runtime/adapters/glyphs.js";
import { PanelLeft } from "../../icons/PanelLeft.js";
const adoptedGlyphs = { ...glyphs, ...featureGlyphs, "assets.icon-panel-left": PanelLeft };
type WithAsset<Props> = Props extends unknown ? Omit<Props, "glyph" | "children"> & { asset: keyof typeof adoptedGlyphs } : never;
export function Icon({ asset, ...props }: WithAsset<ComponentProps<typeof Primitive>>) {
  const glyph = adoptedGlyphs[asset];
  if (!glyph) throw new Error("Missing consumer glyph");
  if (asset.startsWith("assets.icon-set.glyph.")) return createElement(Primitive, { ...props, glyph, decorative: true, label: undefined });
  return createElement(Primitive, { ...props, glyph });
}

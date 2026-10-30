import type { FeatureGridProps } from "../FeatureGrid.js";
import { CompatFeatureGrid } from "../items/compat-features.js";
import type { SectionGround } from "../section-ground.js";
import { FeatureLayouts } from "./FeatureLayouts.js";
import type { FeatureLayoutProps, FeatureSectionLayout } from "./types.js";

type FeatureSurfaceInput = { readonly mode: "public"; readonly props: FeatureGridProps & { ground: SectionGround } }
  | { readonly mode: "runtime"; readonly props: Omit<FeatureLayoutProps, "layout"> & { layout?: FeatureSectionLayout } };

/** One implementation graph; the published adapter retains its three-layout policy. */
export function FeatureSurface({ mode, props }: FeatureSurfaceInput) {
  const layout = props.layout;
  if (mode === "runtime" && (layout === "bento" || layout === "tabs" || layout === "alternating" || layout === "scroll")) {
    return <FeatureLayouts {...props} layout={layout} />;
  }
  return <CompatFeatureGrid {...props as FeatureGridProps & { ground: SectionGround }} />;
}

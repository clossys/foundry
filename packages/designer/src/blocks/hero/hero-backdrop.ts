import type { Mode, Resolved } from "../../catalog-core/types.js";
import { backdropGraphicFromResolved, isBackdropGraphicRecipe, type BackdropGraphicArtifact } from "../../catalog-assets/backdrop-graphic.js";
import { a276BackdropGraphicReference } from "../../catalog-assets/a276-backdrop-graphic.contribution.js";
import { checkConsumerArtContract, type StillBackdropArt } from "../../backdrop/consumer-art.js";
import { isVideoResource, type VideoResource } from "../../catalog-assets/media.js";

export type HeroBackdropKind = "none" | "image" | "video" | "graphic";
export interface HeroImageBackdrop { readonly kind: "image"; readonly image: StillBackdropArt }
export interface HeroVideoBackdrop {
  readonly kind: "video";
  readonly video: VideoResource;
  readonly poster: StillBackdropArt;
  readonly muted: true;
  readonly autoplay: true;
  readonly loop: true;
  readonly playsInline: true;
}
/** The Assets producer owns the reference and geometry; Hero never synthesizes artwork. */
export interface HeroGraphicBackdrop { readonly kind: "graphic"; readonly asset: string }
/** Existing checked still declarations remain valid callers. */
export type HeroBackdrop = StillBackdropArt | { readonly kind: "none" } | HeroImageBackdrop | HeroVideoBackdrop | HeroGraphicBackdrop;
export interface ResolvedHeroBackdrop { readonly kind: HeroBackdropKind; readonly art?: StillBackdropArt; readonly need?: string; readonly video?: HeroVideoBackdrop; readonly graphic?: BackdropGraphicArtifact }
function still(value: unknown): value is StillBackdropArt {
  return checkConsumerArtContract(value).ok && (value as StillBackdropArt).slot === "backdrop" && (value as StillBackdropArt).loading === "lazy";
}
export function resolveHeroBackdrop(value: unknown, resolved?: Resolved, mode: Mode = "light"): ResolvedHeroBackdrop {
  if (value === undefined) return { kind: "none" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Hero backdrop must be a declared kind or checked static art");
  const row = value as Record<string, unknown>;
  if (!("kind" in row)) {
    if (!still(value)) throw new TypeError("Hero backdrop must be checked static art");
    return { kind: "image", art: value };
  }
  if (row.kind === "none") return { kind: "none" };
  if (row.kind === "image") {
    if (!still(row.image)) throw new TypeError("Hero image backdrop must be checked static art");
    return { kind: "image", art: row.image };
  }
  if (row.kind === "video") {
    if (!isVideoResource(row.video) || row.video.reducedMotion !== "poster" || !row.video.poster || !still(row.poster) || row.muted !== true || row.autoplay !== true || row.loop !== true || row.playsInline !== true) throw new TypeError("Hero video requires src, poster, muted autoplay loop playsInline and reduced-motion poster policy");
    return { kind: "video", art: row.poster, video: value as HeroVideoBackdrop };
  }
  if (row.kind === "graphic") {
    if (typeof row.asset !== "string" || !row.asset.trim()) throw new TypeError("Hero graphic requires an Assets leaf reference");
    const reference = a276BackdropGraphicReference;
    if (row.asset === reference.reference || row.asset === reference.slot) {
      const recipe = resolved?.members[`${reference.slot}.${reference.defaultMember}`]?.value.light;
      if (isBackdropGraphicRecipe(recipe)) return { kind: "graphic", graphic: backdropGraphicFromResolved(recipe.pattern, resolved!, mode) };
    }
    return { kind: "graphic", need: `NEED Assets leaf: ${row.asset}` };
  }
  throw new TypeError("Hero backdrop kind must be none, image, video or graphic");
}

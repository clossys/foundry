import type { Mode, Resolved } from "../../catalog-core/types.js";
import { patternBackdropFromResolved, type BackdropGraphicArtifact } from "../../catalog-assets/pattern-backdrop.js";
import { checkConsumerArtContract, type StillBackdropArt } from "../../backdrop/consumer-art.js";
import { interactiveBackdropDescriptorIssues, type InteractiveBackdropDescriptor } from "../../tokens/interactive-backdrops.js";

export type HeroBackdropKind = "none" | "image" | "video" | "graphic" | "interactive";
export interface HeroImageBackdrop { readonly kind: "image"; readonly image: StillBackdropArt }
/**
 * The owner retired components.media-player on 2026-11-20 (foundry-build-0048 BR-RETIRE3), so a hero
 * never plays video: the video kind is the poster with resolved host copy, and video bytes are refused.
 */
export interface HeroVideoBackdrop {
  readonly kind: "video";
  /** Resolved host copy shown with the poster; video playback is not offered. */
  readonly missingVideoMessage: string;
  readonly poster: StillBackdropArt;
  readonly muted: true;
  readonly autoplay: true;
  readonly loop: true;
  readonly playsInline: true;
}
/** The Assets producer owns the reference and geometry; Hero never synthesizes artwork. */
export interface HeroGraphicBackdrop { readonly kind: "graphic"; readonly asset: string }
/** A descriptor over one adopted interactive backdrop component (catalog/rules/backdrop-components.json, foundry-build-0048 U23): data, never code. */
export interface HeroInteractiveBackdrop { readonly kind: "interactive"; readonly backdrop: InteractiveBackdropDescriptor }
/** Existing checked still declarations remain valid callers. */
export type HeroBackdrop = StillBackdropArt | { readonly kind: "none" } | HeroImageBackdrop | HeroVideoBackdrop | HeroGraphicBackdrop | HeroInteractiveBackdrop;
export interface ResolvedHeroBackdrop { readonly kind: HeroBackdropKind; readonly art?: StillBackdropArt; readonly need?: string; readonly graphic?: BackdropGraphicArtifact; readonly interactive?: InteractiveBackdropDescriptor }
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
    // D3: no player leaf is offered (components.media-player retired), so supplied video bytes are refused, never dropped silently.
    if (row.video !== undefined) throw new TypeError("Hero video playback is retired (components.media-player); declare the poster with resolved host copy, or an image backdrop");
    if (!still(row.poster) || row.muted !== true || row.autoplay !== true || row.loop !== true || row.playsInline !== true) throw new TypeError("Hero video requires a checked poster and the muted autoplay loop playsInline declaration");
    if (typeof row.missingVideoMessage !== "string" || !row.missingVideoMessage.trim()) throw new TypeError("Hero missing-video state requires resolved host copy");
    return { kind: "video", art: row.poster, need: row.missingVideoMessage };
  }
  if (row.kind === "graphic") {
    if (typeof row.asset !== "string" || !row.asset.trim()) throw new TypeError("Hero graphic requires an Assets leaf reference");
    // Owner 2026-11-02: graphic backdrops paint the owner-signed assets.pattern slot.
    const graphic = patternBackdropFromResolved(row.asset, resolved);
    if (graphic) return { kind: "graphic", graphic };
    return { kind: "graphic", need: `NEED Assets leaf: ${row.asset}` };
  }
  if (row.kind === "interactive") {
    // Decorative only: an invalid descriptor (refused upstream at submit, pin and compile) drops the
    // backdrop and the hero renders without one, rather than taking the page down.
    if (interactiveBackdropDescriptorIssues(row.backdrop).length) return { kind: "none" };
    return { kind: "interactive", interactive: row.backdrop as InteractiveBackdropDescriptor };
  }
  throw new TypeError("Hero backdrop kind must be none, image, video, graphic or interactive");
}

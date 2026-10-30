"use client";
import type { ReactElement, ReactNode } from "react";
import { Card } from "../components/Card.js";
import { Icon, type IconNode, type IconSize } from "../components/Icon.js";
import { Logomark } from "../components/Logomark.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { RatioFixture } from "./ratio-fixture.js";
import { useOptionalTheme } from "../theme/ThemeProvider.js";
import { specimenDataset } from "./specimen-dataset.js";
import { specimenOverride } from "../tokens/preview/specimens.js";
import { MediaFigure } from "../blocks/MediaFigure.js";
import { isImageResource, isVideoResource, mediaLeafOf, type ImageResource, type VideoResource } from "../catalog-assets/media.js";
import { isPatternRecipe, patternBackground, type PatternRecipe } from "../tokens/pattern.js";

/**
 * One specimen type per assets leaf; every member and candidate of a leaf shares it. Every specimen root
 * carries `data-layer="assets"`; its sizes and captions come from the shared specimen dataset, and a member's
 * own value (a ratio, a pattern tile) reaches CSS only as an `asset-under-review` override.
 */
export type AssetSpecimenKind = "logo" | "favicon" | "app-icon" | "icon" | "ratio" | "image" | "video" | "pattern";

/**
 * The ground a variant was drawn for, fixed by its role and never by the theme: positive and
 * mono on the light ground, reversed on the dark one. The grounds are neutral references, which
 * do not flip with the theme, so a reversed mark is judged on dark in a light studio and a
 * positive one on light in a dark studio.
 */
type SpecimenGround = "light" | "dark";
const GROUND_CLASSES: Readonly<Record<SpecimenGround, string>> = { light: "bg-neutral-50", dark: "bg-neutral-900" };
const LOGO_GROUND: Readonly<Record<string, SpecimenGround>> = { positive: "light", reversed: "dark", mono: "light" };
const CAPTION = "text-caption text-ink-secondary";
const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** The share of a maskable icon's side that the platform guarantees to keep: the circle the identity badge keeps its symbol inside. */
const APP_ICON = specimenDataset.assets.appIcon;
/** The CSS sizes a favicon is drawn at: the tab strip, a high-density tab or bookmark, and a shortcut tile. */
const FAVICON = specimenDataset.assets.favicon;
/** The icon size tokens, smallest first. */
const ICON_SIZES: readonly IconSize[] = ["sm", "md", "lg"];

/** A plate in a fixed-polarity ground, outlined so the ground that matches the page still reads as a plate. */
function Ground({ ground, children, className, ...rest }: { ground: SpecimenGround; children: ReactNode; className?: string; "data-layer"?: string; "data-asset-specimen"?: string; "data-app-icon"?: string }): ReactElement {
  return <div {...rest} data-ground={ground} className={`flex w-max max-w-full flex-wrap items-center gap-sm rounded-panel border border-line-panel p-sm ${GROUND_CLASSES[ground]} ${className ?? ""}`}>{children}</div>;
}

/** The maskable safe zone drawn over its artwork: a dashed circle in the secondary ink, in a box that fills the mark it sits on. */
function SafeZone(): ReactElement {
  const half = APP_ICON.viewBox / 2;
  return <svg data-safe-zone="" aria-hidden="true" focusable="false" viewBox={`0 0 ${APP_ICON.viewBox} ${APP_ICON.viewBox}`} className="pointer-events-none absolute inset-0 h-full w-full text-ink-secondary">
    <circle cx={half} cy={half} r={half * APP_ICON.safeZoneShare} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray={APP_ICON.dash} vectorEffect="non-scaling-stroke" />
  </svg>;
}

/** A checked SVG member: logo variants on their ground, a favicon in browser-tab chrome at its real sizes, an app icon on its plate. */
export function SvgSpecimen({ id, slot, svg }: { id: string; slot: string; svg: string }): ReactElement {
  const role = id.slice(slot.length + 1), src = dataUri(svg);
  if (slot === "assets.favicon") return <div data-layer="assets" data-asset-specimen="favicon" className="flex w-max flex-col items-start gap-xs">
    {(["light", "dark"] as const).map(ground => <Ground key={ground} ground={ground}>
      {FAVICON.sizes.map(side => <img key={side} src={src} alt="" width={side} height={side} title={[id, side, FAVICON.unit].join(" ")} />)}
    </Ground>)}
    <SemanticContent as="span" className={CAPTION}>{[FAVICON.sizes.join(", "), FAVICON.unit].join(" ")}</SemanticContent>
  </div>;
  if (slot === "assets.app-icon") return <Ground ground="light" data-layer="assets" data-asset-specimen="app-icon" data-app-icon={role} className="max-w-full overflow-auto">
    {APP_ICON.sizes.map(side => <span key={side} className="relative flex shrink-0">
      <img src={src} alt="" width={side} height={side} title={[id, side, FAVICON.unit].join(" ")} />
      {role === "maskable" ? <SafeZone /> : null}
    </span>)}
  </Ground>;
  return <Ground ground={LOGO_GROUND[role] ?? "light"} data-layer="assets" data-asset-specimen="logo">
    <Logomark src={src} size="lg" title={id} />
  </Ground>;
}

/** A checked glyph drawn as the icon it is at every icon size token, labelled with its name. */
export function IconSpecimen({ glyph, name }: { glyph: IconNode; name: string }): ReactElement {
  return <div data-layer="assets" data-asset-specimen="icon" className="flex w-max flex-col items-center gap-xs">
    <span className="flex items-end gap-sm">{ICON_SIZES.map(size => <Icon key={size} glyph={glyph} decorative size={size} />)}</span>
    <SemanticContent as="span" className={CAPTION}>{name}</SemanticContent>
  </div>;
}

/** An image ratio as the crop it makes of one generated fixture image, with the ratio as its label. */
export function RatioSpecimen({ width, height }: { width: number; height: number }): ReactElement {
  return <div data-layer="assets" data-asset-specimen="ratio" className="flex w-max flex-col items-start gap-xs" {...specimenOverride("asset-under-review", { "--studio-specimen-value": `${width} / ${height}` })}>
    <Card variant="outline" aria-hidden data-ratio-frame="" className="h-3xl aspect-(--studio-specimen-value) overflow-hidden p-0"><RatioFixture /></Card>
    <SemanticContent as="span" className={CAPTION}>{width}:{height}</SemanticContent>
  </div>;
}

/** The ratio a rules member carries, or undefined when it is not a pair of positive finite numbers. */
export function ratioOf(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { width, height } = value as { width?: unknown; height?: unknown };
  return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

/** The media classes every image and video specimen shares: one framed figure, the media at one height and its own aspect. */
const MEDIA = "block h-4xl max-w-full w-auto";
/** A checked image resource as the image it is, framed, at its intrinsic aspect, with its alt policy and kind facet. */
export function ImageSpecimen({ image }: { image: ImageResource }): ReactElement {
  return <MediaFigure data-layer="assets" data-asset-specimen="image" framed className="w-max max-w-full" caption={<SemanticContent as="span" className={CAPTION}>{image.kind}</SemanticContent>}>
    <img src={image.src} alt={image.decorative === true ? "" : image.alt} width={image.width} height={image.height} className={MEDIA} />
  </MediaFigure>;
}
/** A checked video resource as a player the viewer starts: controls, metadata only, never autoplay, captions attached. */
export function VideoSpecimen({ video }: { video: VideoResource }): ReactElement {
  return <MediaFigure data-layer="assets" data-asset-specimen="video" framed className="w-max max-w-full" caption={<SemanticContent as="span" className={CAPTION}>{video.width}×{video.height}</SemanticContent>}>
    <video controls preload="metadata" poster={video.poster} width={video.width} height={video.height} className={MEDIA}>
      <source src={video.src} type={video.mediaType} />
      {video.captions ? <track kind="captions" src={video.captions.src} srcLang={video.captions.srclang} label={video.captions.label} default /> : null}
    </video>
  </MediaFigure>;
}
/** A pattern recipe painted at its real tile size on the theme reference ground, named by its shape. */
export function PatternSpecimen({ recipe }: { recipe: PatternRecipe }): ReactElement {
  const theme = useOptionalTheme()?.resolvedTheme ?? "light";
  const { backgroundImage, backgroundSize } = patternBackground(recipe);
  return <div data-layer="assets" data-asset-specimen="pattern" data-specimen-theme={theme} className="flex w-max flex-col items-start gap-xs"
    {...specimenOverride("asset-under-review", { "--studio-pattern-image": backgroundImage, "--studio-pattern-size": backgroundSize })}>
    <Ground ground={theme}><span aria-hidden data-pattern-tile="" className="block size-3xl bg-(image:--studio-pattern-image) bg-size-(--studio-pattern-size)" /></Ground>
    <SemanticContent as="span" className={CAPTION}>{recipe.shape}</SemanticContent>
  </div>;
}
/**
 * The specimen of a Media rules member by its leaf: the specimen, `null` when the value fails that
 * leaf's check (never drawn as artwork), or undefined when the slot is not a Media resource or pattern leaf.
 */
export function mediaSpecimen(slot: string, id: string, value: unknown): ReactElement | null | undefined {
  const leaf = mediaLeafOf(slot);
  if (!leaf) return undefined;
  if (leaf === "image") return isImageResource(value) ? <ImageSpecimen image={value} /> : null;
  if (leaf === "video") return isVideoResource(value) ? <VideoSpecimen video={value} /> : null;
  return isPatternRecipe(value, id.slice(slot.length + 1)) ? <PatternSpecimen recipe={value} /> : null;
}

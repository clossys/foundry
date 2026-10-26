"use client";
import type { ReactElement, ReactNode } from "react";
import { Card } from "../components/Card.js";
import { Icon, type IconNode, type IconSize } from "../components/Icon.js";
import { Logomark } from "../components/Logomark.js";
import { UI_BRANDMARK_HEIGHT_LG } from "../internal/brandmark.js";
import { RatioFixture } from "./ratio-fixture.js";

/** One specimen type per assets leaf; every member and candidate of a leaf shares it. */
export type AssetSpecimenKind = "logo" | "favicon" | "app-icon" | "icon" | "ratio";

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

/** The share of a maskable icon's side that the platform guarantees to keep: a circle of 80 percent, the circle the identity badge keeps its symbol inside. */
const SAFE_ZONE_SHARE = 0.8;
/** The CSS sizes a favicon is drawn at: the tab strip, a high-density tab or bookmark, and a shortcut tile. */
const FAVICON_PX = [16, 32, 48] as const;
/** The icon size tokens, smallest first. */
const ICON_SIZES: readonly IconSize[] = ["sm", "md", "lg"];

/** A plate in a fixed-polarity ground, outlined so the ground that matches the page still reads as a plate. */
function Ground({ ground, children, ...rest }: { ground: SpecimenGround; children: ReactNode; className?: string; "data-asset-specimen"?: string; "data-app-icon"?: string }): ReactElement {
  return <div {...rest} data-ground={ground} className={`flex w-max items-center gap-sm rounded-panel border border-line-panel p-sm ${GROUND_CLASSES[ground]}`}>{children}</div>;
}

/** The maskable safe zone drawn over its artwork: a dashed circle in the secondary ink, in a box that fills the mark it sits on. */
function SafeZone(): ReactElement {
  return <svg data-safe-zone="" aria-hidden="true" focusable="false" viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full text-ink-secondary">
    <circle cx={50} cy={50} r={50 * SAFE_ZONE_SHARE} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/** A checked SVG member: logo variants on their ground, a favicon in browser-tab chrome at its real sizes, an app icon on its plate. */
export function SvgSpecimen({ id, slot, svg }: { id: string; slot: string; svg: string }): ReactElement {
  const role = id.slice(slot.length + 1), src = dataUri(svg);
  if (slot === "assets.favicon") return <div data-asset-specimen="favicon" className="flex w-max flex-col items-start gap-xs">
    {(["light", "dark"] as const).map(ground => <Ground key={ground} ground={ground}>
      {FAVICON_PX.map(side => <img key={side} src={src} alt="" width={side} height={side} title={`${id} ${side} px`} />)}
    </Ground>)}
    <span className={CAPTION}>{FAVICON_PX.join(", ")} px</span>
  </div>;
  if (slot === "assets.app-icon") return <Ground ground="light" data-asset-specimen="app-icon" data-app-icon={role}>
    <span className="relative flex">
      <Logomark src={src} size="lg" title={id} />
      {role === "maskable" ? <SafeZone /> : null}
    </span>
  </Ground>;
  return <Ground ground={LOGO_GROUND[role] ?? "light"} data-asset-specimen="logo">
    <Logomark src={src} size="lg" title={id} />
  </Ground>;
}

/** A checked glyph drawn as the icon it is at every icon size token, labelled with its name. */
export function IconSpecimen({ glyph, name }: { glyph: IconNode; name: string }): ReactElement {
  return <div data-asset-specimen="icon" className="flex w-max flex-col items-center gap-xs">
    <span className="flex items-end gap-sm">{ICON_SIZES.map(size => <Icon key={size} glyph={glyph} decorative size={size} />)}</span>
    <span className={CAPTION}>{name}</span>
  </div>;
}

/** An image ratio as the crop it makes of one generated fixture image, with the ratio as its label. */
export function RatioSpecimen({ width, height }: { width: number; height: number }): ReactElement {
  return <div data-asset-specimen="ratio" className="flex w-max flex-col items-start gap-xs">
    <Card variant="outline" aria-hidden className="overflow-hidden p-0" style={{ height: UI_BRANDMARK_HEIGHT_LG, aspectRatio: `${width} / ${height}` }}><RatioFixture /></Card>
    <span className={CAPTION}>{width}:{height}</span>
  </div>;
}

/** The ratio a rules member carries, or undefined when it is not a pair of positive finite numbers. */
export function ratioOf(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { width, height } = value as { width?: unknown; height?: unknown };
  return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

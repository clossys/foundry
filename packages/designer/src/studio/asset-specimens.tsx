"use client";
import type { ReactElement } from "react";
import { Card, type CardGround } from "../components/Card.js";
import { Icon, type IconNode } from "../components/Icon.js";
import { Logomark } from "../components/Logomark.js";
import { UI_BRANDMARK_HEIGHT_LG } from "../internal/brandmark.js";

/** One specimen type per assets leaf; every member and candidate of a leaf shares it. */
export type AssetSpecimenKind = "logo" | "favicon" | "app-icon" | "icon" | "ratio";

// A logo variant sits on the ground it was drawn for: positive on the light plate,
// reversed on the inverse plate, mono on the neutral plate.
const LOGO_GROUND: Readonly<Record<string, CardGround>> = { positive: "sunken", reversed: "inverse", mono: "base" };
const CAPTION = "text-caption text-ink-secondary";
const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** A checked SVG member: logo variants on their ground, a favicon at its small sizes, an app icon on its plate. */
export function SvgSpecimen({ id, slot, svg }: { id: string; slot: string; svg: string }): ReactElement {
  const role = id.slice(slot.length + 1), src = dataUri(svg);
  if (slot === "assets.favicon") return <Card variant="outline" data-asset-specimen="favicon" className="flex w-max items-end gap-sm p-sm">
    <Logomark src={src} size="sm" title={id} /><Logomark src={src} size="md" title={id} />
  </Card>;
  if (slot === "assets.app-icon") return <Card variant="plate" data-asset-specimen="app-icon" data-app-icon={role} className="flex w-max items-center p-sm">
    <Logomark src={src} size="lg" title={id} />
  </Card>;
  const ground = LOGO_GROUND[role] ?? "base";
  return <Card variant="plate" ground={ground} data-asset-specimen="logo" data-ground={ground} className="flex w-max items-center p-sm">
    <Logomark src={src} size="lg" title={id} />
  </Card>;
}

/** A checked glyph drawn as the icon it is, labelled with its name. */
export function IconSpecimen({ glyph, name }: { glyph: IconNode; name: string }): ReactElement {
  return <div data-asset-specimen="icon" className="flex w-max flex-col items-center gap-xs">
    <Icon glyph={glyph} decorative size="lg" />
    <span className={CAPTION}>{name}</span>
  </div>;
}

/** An image ratio as an empty frame of that ratio, with the ratio as its label. */
export function RatioSpecimen({ width, height }: { width: number; height: number }): ReactElement {
  return <div data-asset-specimen="ratio" className="flex w-max flex-col items-start gap-xs">
    <Card variant="outline" aria-hidden className="p-0" style={{ height: UI_BRANDMARK_HEIGHT_LG, aspectRatio: `${width} / ${height}` }} />
    <span className={CAPTION}>{width}:{height}</span>
  </div>;
}

/** The ratio a rules member carries, or undefined when it is not a pair of positive finite numbers. */
export function ratioOf(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { width, height } = value as { width?: unknown; height?: unknown };
  return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

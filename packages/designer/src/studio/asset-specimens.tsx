"use client";
import type { ReactElement } from "react";
import { Card, type CardGround } from "../components/Card.js";
import { Icon, type IconNode } from "../components/Icon.js";
import { Logomark } from "../components/Logomark.js";
import { Tabs } from "../components/Tabs.js";
import { UI_BRANDMARK_HEIGHT_LG } from "../internal/brandmark.js";

/** One specimen type per assets leaf; every member and candidate of a leaf shares it. */
export type AssetSpecimenKind = "logo" | "favicon" | "app-icon" | "icon" | "ratio";

// A logo variant sits on the ground it was drawn for: positive on the light plate,
// reversed on the inverse plate, mono on the neutral plate.
const LOGO_GROUND: Readonly<Record<string, CardGround>> = { positive: "sunken", reversed: "inverse", mono: "base" };
const CAPTION = "text-caption text-ink-secondary";
const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** The share of a maskable icon's side that the platform guarantees to keep: a circle of 80 percent, the circle the identity badge keeps its symbol inside. */
const SAFE_ZONE_SHARE = 0.8;
/** The two CSS sizes a browser draws a favicon at: the tab strip, and a high-density tab or shortcut. */
const FAVICON_TAB_PX = 16, FAVICON_SHORTCUT_PX = 32;

/** The maskable safe zone drawn over its artwork: a dashed circle in the secondary ink, in a box that fills the mark it sits on. */
function SafeZone(): ReactElement {
  return <svg data-safe-zone="" aria-hidden="true" focusable="false" viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full text-ink-secondary">
    <circle cx={50} cy={50} r={50 * SAFE_ZONE_SHARE} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/** A checked SVG member: logo variants on their ground, a favicon in browser-tab chrome at its real sizes, an app icon on its plate. */
export function SvgSpecimen({ id, slot, svg }: { id: string; slot: string; svg: string }): ReactElement {
  const role = id.slice(slot.length + 1), src = dataUri(svg);
  if (slot === "assets.favicon") return <Card variant="outline" data-asset-specimen="favicon" className="w-max p-sm">
    <Tabs>
      <Tabs.List aria-label={id}>
        <Tabs.Tab id="tab"><span className="flex items-center gap-xs">
          <img src={src} alt="" width={FAVICON_TAB_PX} height={FAVICON_TAB_PX} title={id} />
          <span className={CAPTION}>{FAVICON_TAB_PX} px</span>
        </span></Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id="tab" className="flex items-center gap-xs">
        <img src={src} alt="" width={FAVICON_SHORTCUT_PX} height={FAVICON_SHORTCUT_PX} title={id} />
        <span className={CAPTION}>{FAVICON_SHORTCUT_PX} px</span>
      </Tabs.Panel>
    </Tabs>
  </Card>;
  if (slot === "assets.app-icon") return <Card variant="plate" data-asset-specimen="app-icon" data-app-icon={role} className="flex w-max items-center p-sm">
    <span className="relative flex">
      <Logomark src={src} size="lg" title={id} />
      {role === "maskable" ? <SafeZone /> : null}
    </span>
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

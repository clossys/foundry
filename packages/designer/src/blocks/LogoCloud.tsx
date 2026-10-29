import { Link } from "../components/Link.server.js";
import { SemanticContent } from "../components/SemanticContent.js";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { LogoCloudMarquee, type LogoCloudMotionLabels } from "./LogoCloud/Marquee.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.logo-cloud", "foundry/sections.logo-cloud");

export interface LogoCloudItem {
  id: string;
  /** Accessible name, separate from the decorative supplied artwork. */
  name: string;
  logo: ReactNode;
  /** Host-owned destination, passed directly to the anchor. */
  href?: string;
}

export interface LogoCloudProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  /** Three, four, six, eight or twelve marks. */
  items: readonly LogoCloudItem[];
  tone?: "original" | "monochrome";
  /** Inverse sections require host-supplied light marks. */
  ground?: SectionGround;
  /** Motion is opt-in; reduced motion retains the ordinary static grid. */
  motion?: "static" | "marquee";
  /** Authored control copy, required for marquee motion. */
  motionLabels?: LogoCloudMotionLabels;
}

const COLUMN_CLASSES: Readonly<Record<number, string>> = {
  3: "grid-cols-3 tablet:grid-cols-3 desktop:grid-cols-3",
  4: "grid-cols-2 tablet:grid-cols-4 desktop:grid-cols-4",
  6: "grid-cols-2 tablet:grid-cols-3 desktop:grid-cols-6",
  8: "grid-cols-2 tablet:grid-cols-4 desktop:grid-cols-4",
  12: "grid-cols-2 tablet:grid-cols-4 desktop:grid-cols-6",
};

const FOCUS_CLASSES: Readonly<Record<SectionGround, string>> = {
  base: "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  sunken: "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  inverse: "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-on-inverse",
};

/** Decorative marks with authored accessible names and optional destinations. */
export function LogoCloud({ items, tone = "monochrome", ground = "base", motion = "static", motionLabels, className, style, ...rest }: LogoCloudProps) {
  if (!Array.isArray(items) || !Object.hasOwn(COLUMN_CLASSES, items.length)) throw new TypeError("LogoCloud: requires three, four, six, eight or twelve items.");
  if (ground !== "base" && ground !== "sunken" && ground !== "inverse") throw new TypeError("LogoCloud: unknown ground.");
  if (tone !== "original" && tone !== "monochrome") throw new TypeError("LogoCloud: unknown tone.");
  if (motion !== "static" && motion !== "marquee") throw new TypeError("LogoCloud: unknown motion.");
  if (motion === "marquee" && (!motionLabels?.pause?.trim() || !motionLabels.resume?.trim())) throw new TypeError("LogoCloud: marquee requires authored control labels.");
  const monochrome = tone === "monochrome";
  const monochromeClasses = monochrome ? "grayscale" : undefined;
  const anchorToneClasses = monochrome ? "grayscale hover:grayscale-0 focus-visible:grayscale-0" : undefined;
  const list = (moving = false, duplicate = false) => (
    <SemanticContent as="ul" {...SECTION_STAMP} {...rest} role="list" aria-hidden={duplicate || undefined} inert={duplicate || undefined} data-logo-cloud-duplicate={duplicate ? "" : undefined}
      className={cx(moving ? "m-0 flex shrink-0 list-none gap-xl p-0 pe-xl" : "m-0 grid list-none gap-x-xl gap-y-lg p-0", !moving && COLUMN_CLASSES[items.length], SECTION_GROUND_CLASSES[ground].primary, className)} style={style}>
      {items.map(item => {
        const markToneClasses = item.href === undefined ? monochromeClasses : undefined;
        const mark = <><SemanticContent as="span" aria-hidden="true" className={cx("inline-flex h-8 w-full max-w-40 overflow-hidden tablet:h-10", markToneClasses)}>{item.logo}</SemanticContent><SemanticContent as="span" className="sr-only">{item.name}</SemanticContent></>;
        return <SemanticContent as="li" key={item.id} className={cx("flex min-h-[3rem] min-w-0 items-center justify-center", moving && "w-40 shrink-0")}>
          {item.href === undefined || duplicate ? mark : <Link variant="standalone" href={item.href} className={cx("inline-flex w-full max-w-40 items-center rounded-control", FOCUS_CLASSES[ground], anchorToneClasses)} style={{ minBlockSize: UI_LAYOUT_TAP_TARGET }}>{mark}</Link>}
        </SemanticContent>;
      })}
    </SemanticContent>
  );
  return motion === "marquee" ? <LogoCloudMarquee grid={list()} track={list(true)} duplicate={list(true, true)} labels={motionLabels!} /> : list();
}

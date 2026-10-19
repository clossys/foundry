import { BADGE_INSET_SHARE, BADGE_RADIUS_SHARE } from "../internal/brandmark.js";
import { UI_BRANDMARK_HEIGHT_SM, UI_BRANDMARK_HEIGHT_MD, UI_BRANDMARK_HEIGHT_LG } from "../internal/brandmark.js";
import { cx } from "./internal/cx.js";

export type LogomarkSize = "sm" | "md" | "lg";
export type LogomarkTone = "auto" | "inverse";
export type LogomarkPlate = "shared" | "self";

export interface LogomarkProps {
  /** Caller-selected glyph image URL; rendered only as an image source. */
  src: string;
  /** The closed mark-height scale. */
  size: LogomarkSize;
  /** Shared plate ink; supply artwork that contrasts with the selected plate. */
  tone?: LogomarkTone;
  /** Whether the artwork supplies its own plate. @default "self" */
  plate?: LogomarkPlate;
  /** Optional native image title. The glyph remains decorative. */
  title?: string;
}

const HEIGHTS = { sm: UI_BRANDMARK_HEIGHT_SM, md: UI_BRANDMARK_HEIGHT_MD, lg: UI_BRANDMARK_HEIGHT_LG };

/** One decorative mark: caller artwork, optionally inset in a shared plate. */
export function Logomark({ src, size, tone = "auto", plate = "self", title }: LogomarkProps) {
  const height = HEIGHTS[size];
  const inverse = tone === "inverse";
  if (plate !== "shared") return <img src={src} alt="" style={{ height, width: "auto" }} title={title} />;
  const imageSide = `calc(${height} * ${1 - 2 * BADGE_INSET_SHARE})`;
  return (
    <span
      aria-hidden
      className={cx(inverse
        ? "inline-flex shrink-0 items-center justify-center bg-ink-on-inverse"
        : "inline-flex shrink-0 items-center justify-center bg-ink-primary")}
      style={{ height, width: height, borderRadius: `calc(${height} * ${BADGE_RADIUS_SHARE})` }}
    >
      <img src={src} alt="" style={{ height: imageSide, width: imageSide, objectFit: "contain" }} title={title} />
    </span>
  );
}

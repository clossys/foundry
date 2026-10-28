import type { CSSProperties } from "react";
import { cx } from "./internal/cx.js";
import { UI_WIDTH_NOTICE_MAX } from "./internal/ui-vars.js";
import { Icon } from "./Icon.js";
import { X } from "../icons/X.js";
import type { BannerDensity, BannerProps, BannerVariant } from "./Banner.js";
import { resolveShellCopy, SHELL_COPY_REFS } from "./Banner.copy.js";

export const VARIANT_CLASSES: Record<BannerVariant, string> = {
  info: "border-status-info bg-status-info-tint text-status-info-text",
  success: "border-status-success bg-status-success-tint text-status-success-text",
  warning: "border-status-warning bg-status-warning-tint text-status-warning-text",
  danger: "border-status-danger bg-status-danger-tint text-status-danger-text",
};

/** The dismiss control's classes, shared by the server and client `Banner`. */
export const BANNER_DISMISS_CLASSES =
  "shrink-0 rounded-default px-xs py-xs text-body-s hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const DENSITY_CLASSES: Record<BannerDensity, string> = {
  default: "gap-sm p-md",
  compact: "gap-xs px-sm py-xs",
};

/** The outer region's classes, shared by the server and client `Banner`. */
export function bannerClassName(variant: BannerVariant, className: string | undefined, density: BannerDensity = "default"): string {
  return cx(
    "flex items-start rounded-control border text-body-s font-body",
    DENSITY_CLASSES[density],
    VARIANT_CLASSES[variant],
    className,
  );
}

/** The outer region's inline style, shared by the server and client `Banner`: compact caps the inline size at the notice measure token. */
export function bannerStyle(density: BannerDensity, style: CSSProperties | undefined): CSSProperties | undefined {
  return density === "compact" ? { maxInlineSize: UI_WIDTH_NOTICE_MAX, ...style } : style;
}

/** The client props, with an explicit resolver for server-safe dismissal copy. */
interface ServerBannerProps extends BannerProps {
  /** Omitted means use copyResolver to resolve the shell's Writer reference. */
  dismissLabel?: string;
}

/**
 * The server-safe `Banner`, re-exported as `Banner` from
 * `@clossys/designer/components/server`. Same props, region, `role`/`aria-live`
 * and classes as the client `Banner`, but the optional dismiss control is a
 * plain native `<button>` calling `onDismiss` on click, because
 * react-aria-components (which the client `Banner` uses for it) cannot load
 * under React's `react-server` condition. A function prop cannot cross from
 * a Server Component anyway, so a dismissable banner is a client concern.
 * A parity test pins the two variants to the same markup apart from the
 * attributes react-aria-components adds.
 */
export function Banner({
  variant = "info",
  children,
  onDismiss,
  dismissLabel,
  copyResolver,
  density = "default",
  className,
  style,
  ...rest
}: ServerBannerProps) {
  const isAssertive = variant === "danger";
  return (
    <div
      {...rest}
      role={isAssertive ? "alert" : "status"}
      aria-live={isAssertive ? "assertive" : "polite"}
      className={bannerClassName(variant, className, density)}
      style={bannerStyle(density, style)}
    >
      <div className="flex-1">{children}</div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel ?? resolveShellCopy(copyResolver, SHELL_COPY_REFS.banner.dismiss)} className={BANNER_DISMISS_CLASSES}>
          <Icon glyph={X} decorative size="sm" />
        </button>
      ) : null}
    </div>
  );
}

import { cx } from "./internal/cx.js";
import type { BannerProps, BannerVariant } from "./Banner.js";

export const VARIANT_CLASSES: Record<BannerVariant, string> = {
  info: "border-status-info bg-status-info-tint text-status-info-text",
  success: "border-status-success bg-status-success-tint text-status-success-text",
  warning: "border-status-warning bg-status-warning-tint text-status-warning-text",
  danger: "border-status-danger bg-status-danger-tint text-status-danger-text",
};

/** The dismiss control's classes, shared by the server and client `Banner`. */
export const BANNER_DISMISS_CLASSES =
  "shrink-0 rounded-default px-xs py-xs text-body-s hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The outer region's classes, shared by the server and client `Banner`. */
export function bannerClassName(variant: BannerVariant, className: string | undefined): string {
  return cx(
    "flex items-start gap-sm rounded-control border p-md text-body-s font-body",
    VARIANT_CLASSES[variant],
    className,
  );
}

/**
 * The server-safe `Banner`, re-exported as `Banner` from
 * `@clossys/designer/atoms/server`. Same props, region, `role`/`aria-live`
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
  dismissLabel = "Dismiss",
  className,
  style,
  ...rest
}: BannerProps) {
  const isAssertive = variant === "danger";
  return (
    <div
      {...rest}
      role={isAssertive ? "alert" : "status"}
      aria-live={isAssertive ? "assertive" : "polite"}
      className={bannerClassName(variant, className)}
      style={style}
    >
      <div className="flex-1">{children}</div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel} className={BANNER_DISMISS_CLASSES}>
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

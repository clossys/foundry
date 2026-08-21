import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "./internal/cx.js";

export type BannerVariant = "info" | "success" | "warning" | "danger";

const VARIANT_CLASSES: Record<BannerVariant, string> = {
  info: "border-status-info bg-status-info-tint text-status-info-text",
  success: "border-status-success bg-status-success-tint text-status-success-text",
  warning: "border-status-warning bg-status-warning-tint text-status-warning-text",
  danger: "border-status-danger bg-status-danger-tint text-status-danger-text",
};

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, "role" | "children"> {
  /** @default "info" */
  variant?: BannerVariant;
  /** The message content. */
  children: ReactNode;
  /**
   * Shows a dismiss control, calling this when it's pressed. This component
   * never removes itself from the tree on its own — the CALLER decides
   * whether/when a `Banner` stops rendering, the same controlled shape
   * react-aria-components' own overlay `onOpenChange` callbacks already use
   * elsewhere in this package: a consumer with no need to remember past this
   * render can just stop rendering `Banner`; one that needs to persist "the
   * user already dismissed this" across a reload can do that however fits
   * its own storage, none of which this component needs an opinion on.
   * Omit this prop entirely for a banner with no dismiss control at all.
   */
  onDismiss?: () => void;
  /** Accessible label for the dismiss button. @default "Dismiss" */
  dismissLabel?: string;
  /** Merged onto the outer region's inline style. */
  style?: CSSProperties;
}

/**
 * A persistent inline message region — not a toast (see `@vespeneventures/designer/shell`'s
 * `Toaster`): this renders exactly where it sits in the page's normal render
 * tree (a page banner above a form, a persistent warning inside a card), not
 * through a portal, not queued, not auto-dismissing on a timer. Plain
 * markup, styled over this package's status tokens, the same four this
 * package's `toast(...)` variants and `Badge`'s status variants already
 * share (`success`/`warning`/`danger`/`info` — no separate `neutral`, since
 * a banner without a real severity to communicate is better expressed as a
 * plain `Card` than as this component with a meaningless variant).
 *
 * `role`/`aria-live` follow severity, not a fixed default, the same
 * reasoning `Toaster`'s own `ToasterContent` already documents: a `danger`
 * banner is an assertive live region (`role="alert"`, `aria-live="assertive"`) —
 * it should interrupt a screen reader user the way a real alert does — while
 * every other variant is polite (`role="status"`, `aria-live="polite"`), so
 * an informational or success banner doesn't interrupt whatever the user was
 * already doing.
 *
 * The optional dismiss control is a plain native `<button>`, not this
 * package's own `Button` atom: `Banner` is itself an atom, and an atom
 * composing another atom is the layering violation `ladder.test.ts` and this
 * package's README both call out — `Table` composing `Checkbox` is the one
 * explicitly-permitted exception, not a precedent for every atom that
 * happens to need a small interactive affordance (see `Table.tsx`'s own doc
 * comment on why that one case is different).
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
      className={cx(
        "flex items-start gap-sm rounded-control border p-md text-body-s font-body",
        VARIANT_CLASSES[variant],
        className,
      )}
      style={style}
    >
      <div className="flex-1">{children}</div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="shrink-0 rounded-default px-xs py-xs text-body-s outline-none hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

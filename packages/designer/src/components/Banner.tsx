import { Icon } from "./Icon.js";
import { useGlyph } from "./glyph-context.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Button } from "react-aria-components";
import { BANNER_DISMISS_CLASSES, bannerClassName, bannerStyle } from "./Banner.server.js";

export type BannerVariant = "info" | "success" | "warning" | "danger";
/** `compact` tightens the padding and gap and caps the inline size at the notice measure token (`--ui-width-notice-max`). */
export type BannerDensity = "default" | "compact";

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
  /** `compact` is a bounded notice: tighter spacing tokens and a notice-measure inline-size cap. @default "default" */
  density?: BannerDensity;
  /** Merged onto the outer region's inline style. */
  style?: CSSProperties;
}

/**
 * A persistent inline message region — not a toast (see `@clossys/designer/shell`'s
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
 * The optional dismiss control is react-aria-components' own `Button`, not
 * this package's `Button` component: `Banner` is itself an component, and an component
 * composing another component is the layering violation `ladder.test.ts` (a repository-only test that does not ship) and this
 * package's README both call out — `Table` composing `Checkbox` is the one
 * explicitly-permitted exception, not a precedent for every component that
 * happens to need a small interactive affordance (see `Table.tsx`'s own doc
 * comment on why that one case is different). It keeps its classes and its
 * accessible name; `onDismiss` is wired to the button's `onPress`, which
 * fires on mouse, touch and keyboard activation as `onClick` did.
 *
 * Imports react-aria-components, so it is not server-safe. The server-safe
 * `Banner` from `@clossys/designer/components/server` is `Banner.server.tsx`: the
 * same region with a plain native `<button>` for the dismiss control.
 */
export function Banner({
  variant = "info",
  children,
  onDismiss,
  dismissLabel = "Dismiss",
  density = "default",
  className,
  style,
  ...rest
}: BannerProps) {
  const closeGlyph = useGlyph("assets.icon-close");
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
        <Button onPress={onDismiss} aria-label={dismissLabel} className={BANNER_DISMISS_CLASSES}>
          <Icon glyph={closeGlyph} decorative size="sm" />
        </Button>
      ) : null}
    </div>
  );
}

import type { ComponentPropsWithRef, CSSProperties } from "react";
import {
  Separator as AriaSeparator,
  type SeparatorProps as AriaSeparatorProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";

export interface SeparatorProps extends Omit<AriaSeparatorProps, "className" | "style"> {
  /** @default "horizontal" */
  orientation?: "horizontal" | "vertical";
  /**
   * Marks this separator as purely visual, with no semantic meaning for
   * assistive tech (a hairline rule between two icons in a toolbar, say, as
   * opposed to a real content boundary between two sections). Sets
   * `aria-hidden`, which removes the whole element from the accessibility
   * tree regardless of whatever `role` react-aria-components' own
   * `Separator` already assigned it — there's no need to also suppress that
   * role, since a hidden subtree is never reached by a screen reader in the
   * first place.
   * @default false
   */
  decorative?: boolean;
  /** Merged onto the separator element. */
  className?: string;
  /** Merged onto the separator element's inline style. */
  style?: CSSProperties;
}

const ORIENTATION_CLASSES: Record<"horizontal" | "vertical", string> = {
  horizontal: "h-px w-full",
  vertical: "h-full w-px",
};

/**
 * A visual divider between two groups of content. Built on react-aria-
 * components' own `Separator`, which renders a real `<hr>` for the default
 * horizontal orientation (an implicit `role="separator"` for free, from the
 * element itself) and a `<div role="separator" aria-orientation="vertical">`
 * for the vertical one, since `<hr>` has no vertical rendering in HTML.
 * `Menu.Separator` (see `Menu.tsx`) builds on this same primitive for the
 * menu-specific case of a divider between item groups; this is the general
 * one, for anywhere else a horizontal or vertical rule is needed.
 */
export function Separator({
  orientation = "horizontal",
  decorative = false,
  className,
  style,
  ...rest
}: SeparatorProps) {
  // react-aria-components' own `useSeparator`/`filterDOMProps` never forward
  // an `aria-hidden` prop onto the rendered element — it isn't in either's
  // allowlist (confirmed against the real hooks: `filterDOMProps`'s
  // `{ global: true }` set is `dir`/`lang`/`hidden`/`inert`/`translate` only,
  // and `useSeparator`'s own `{ labelable: true }` adds just the
  // `aria-label`/`aria-labelledby`/`aria-describedby`/`aria-details`
  // foursome) — so passing it as a prop here would silently never reach the
  // DOM, the identical kind of gap `Select`'s own doc comment documents for
  // `aria-invalid`. react-aria-components' own `render` escape hatch is the
  // supported way around that: it hands back the exact props (ref included)
  // the library would otherwise apply, to render however this component
  // chooses — used here ONLY for the decorative case, to add the one
  // attribute that's otherwise unreachable; the non-decorative path renders
  // through react-aria-components entirely undisturbed.
  return (
    <AriaSeparator
      {...rest}
      orientation={orientation}
      className={cx("shrink-0 bg-line-base", ORIENTATION_CLASSES[orientation], className)}
      style={style}
      render={
        decorative
          ? (domProps) =>
              orientation === "vertical" ? (
                <div {...(domProps as ComponentPropsWithRef<"div">)} role={undefined} aria-hidden="true" />
              ) : (
                <hr {...(domProps as ComponentPropsWithRef<"hr">)} role={undefined} aria-hidden="true" />
              )
          : undefined
      }
    />
  );
}

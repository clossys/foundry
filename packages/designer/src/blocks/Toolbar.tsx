import type { CSSProperties, ReactNode } from "react";
import { Toolbar as AriaToolbar, type ToolbarProps as AriaToolbarProps } from "react-aria-components";
import { cx } from "../atoms/internal/cx.js";

export interface ToolbarProps
  extends Omit<AriaToolbarProps, "children" | "className" | "style"> {
  /** Slot for the toolbar's leading actions — typically one or more `Button` atoms (bulk actions, view toggles). */
  leading?: ReactNode;
  /** Slot for a search/filter control — typically a `TextField` or `Select` atom. Grows to fill the space between `leading` and `trailing`. */
  search?: ReactNode;
  /** Slot for the toolbar's trailing actions — typically one or more `Button`/`Menu` atoms. Pinned to the trailing edge when there's room. */
  trailing?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * An action bar above content — typically above a `DataTable` (via its own
 * `toolbar` slot) or any other list/grid region. Three regions that differ
 * in kind (leading actions, a search/filter control, trailing actions), and
 * a page can hold two `Toolbar`s (two independent lists, each with its own
 * toolbar, side by side), which is what makes this a block rather than a
 * view.
 *
 * **Built on react-aria-components' own `Toolbar` primitive**, which this
 * package's installed version (`react-aria-components@1.20.0`) ships —
 * so this uses it rather than hand-rolling `role="toolbar"` and arrow-key
 * handling from scratch. Its underlying `useToolbar` hook (from `react-aria`)
 * supplies real roving focus via a focus manager that walks every focusable
 * descendant in DOM order — Left/Right (or Up/Down when `orientation` is
 * `"vertical"`) move focus between them, respecting RTL automatically, and
 * Tab moves focus OUT of the whole toolbar in one step (to the first/last
 * focusable child, then lets the browser continue Tab as normal from
 * there) rather than tabbing through every control one at a time — the
 * same "one Tab stop for the whole control, arrow keys move within it"
 * shape `Tabs`' own `TabList`/`Tab` and `RadioGroup`'s own roving-tabindex
 * already establish elsewhere in this package. None of that is
 * reimplemented here: any real focusable element placed in `leading`,
 * `search`, or `trailing` (this package's own `Button`, `TextField`,
 * `Select`, `Menu`, or anything else) is automatically part of that
 * navigation with no per-child wiring required.
 *
 * `role="toolbar"` requires its own accessible name; `aria-label` defaults
 * to `"Toolbar"` and should be overridden by a consumer with more than one
 * `Toolbar` on a page (the same `aria-label` pattern `Pagination`'s own
 * `"Pagination"` default and `Breadcrumb`'s own `"Breadcrumb"` default
 * already follow).
 *
 * **Wraps at narrow widths**: the outer region is `flex flex-wrap`, and
 * `search` grows (`flex-1`) to fill the space between `leading` and
 * `trailing` at full width, falling onto its own row rather than
 * overflowing once the three regions no longer fit on one line.
 */
export function Toolbar({
  leading,
  search,
  trailing,
  orientation = "horizontal",
  "aria-label": ariaLabel = "Toolbar",
  className,
  style,
  ...rest
}: ToolbarProps) {
  return (
    <AriaToolbar
      {...rest}
      orientation={orientation}
      aria-label={ariaLabel}
      className={cx("flex flex-wrap items-center gap-md", className)}
      style={style}
    >
      {leading ? <div className="flex flex-wrap items-center gap-sm">{leading}</div> : null}
      {search ? <div className="min-w-[12rem] flex-1">{search}</div> : null}
      {trailing ? (
        <div className="ml-auto flex flex-wrap items-center gap-sm">{trailing}</div>
      ) : null}
    </AriaToolbar>
  );
}

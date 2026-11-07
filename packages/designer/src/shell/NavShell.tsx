import type { ReactNode } from "react";
import { Button } from "../components/preview-runtime/components/button/button.js";
import { Sheet, SheetClose, SheetTitle, SheetTrigger } from "../components/preview-runtime/components/sheet/sheet.js";
import type { OverlayTriggerProps } from "../components/internal/overlay-context.js";
import { Icon } from "../components/Icon.js";
import { cx } from "../components/internal/cx.js";
import { X } from "../icons/index.js";

/** The drawer's open-state props: every stock `SheetTrigger` prop, none of its surface props (the drawer owns those). */
type NavShellDialogProps = Omit<OverlayTriggerProps, "trigger" | "role" | "className" | "style">;

export interface NavShellProps extends NavShellDialogProps {
  /**
   * The site's primary navigation links — typically one or more `Link`
   * components. Rendered TWICE: once inside a plain inline `<nav>` visible from
   * the `tablet` breakpoint up, and once inside the mobile drawer's own
   * `<nav>`, visible below it. See this component's own doc comment for
   * why duplication, rather than a single relocated subtree, is the
   * correct trade-off here.
   */
  children: ReactNode;
  /**
   * Accessible name shared by both `<nav>` landmarks this component
   * renders (the always-present desktop row and the drawer's own) — never
   * both visible at once (see below), so one label serves either.
   * @default "Primary"
   */
  "aria-label"?: string;
  /**
   * The drawer trigger's own visible text, shown only below the `tablet`
   * breakpoint. A real word rather than an icon-only glyph: this package's
   * 32-glyph icon set (see `@clossys/designer/icons`) ships no
   * three-line "hamburger" mark, and this component's scope is site
   * chrome, not a new icon (see this package's README, "What's
   * deliberately not here" — icons are a closed, final rung).
   * @default "Menu"
   */
  triggerLabel?: string;
  /** Accessible name for the drawer's own close control. @default "Close menu" */
  closeLabel?: string;
  /** Merged onto the desktop-visible `<nav>`'s own root element. */
  className?: string;
}

/**
 * The responsive half of a public site's navigation: an ordinary inline
 * `<nav>` from the `tablet` breakpoint up, and a trigger-plus-drawer below
 * it — CSS-only breakpoint switching, no JS media-query state (see this
 * package's README, "Responsive behaviour must not depend on JS for
 * layout" — a nav that only works after hydration is broken on first
 * paint). Composes into `SiteHeader`'s own `nav` slot, or stands alone.
 *
 * **Why `children` renders twice rather than once, relocated.** The
 * drawer's content is portalled to `document.body` by react-aria-
 * components' own `Modal` (the same primitive this package's `Dialog`
 * component uses — see there for the full mechanism), which cannot be
 * conditionally skipped by a breakpoint at RENDER time without reading
 * `matchMedia` — exactly the SSR-unsafe, JS-dependent-layout shape this
 * package's README warns against. Rendering the SAME `children` into both
 * the desktop row (hidden via `hidden tablet:flex` below `tablet`) and the
 * drawer (mounted only while open, and only reachable via a trigger that
 * is itself `tablet:hidden`) means exactly one is ever visible AND
 * reachable by keyboard/AT at a time, at the cost of one real edge case: a
 * consumer who hardcodes an `id` on an individual nav link would see that
 * `id` duplicated in the DOM for as long as the drawer is open on a
 * narrow viewport (the desktop row stays present, just `display:none`).
 * Ordinary nav content — `Link`s keyed by React, not by a hand-authored
 * DOM `id` — never hits this; documented here rather than silently
 * accepted.
 *
 * **The drawer's accessibility contract** comes from composing this
 * stock `Sheet` (react-aria-components' `useModalOverlay`/`useOverlayTrigger`
 * underneath); the drawer only sizes its surface and names it with a visually
 * hidden `SheetTitle`. None of
 * it is reimplemented here:
 *
 *   - **Focus moves into the drawer on open, and is trapped there while
 *     open** — `useDialog`'s own `FocusScope`, `contain`ed for as long as
 *     the overlay is mounted.
 *   - **Escape closes it, always** — never gated behind a prop, the same
 *     `Dialog` guarantee.
 *   - **Focus returns to the trigger on close** — `useOverlayTrigger`'s own
 *     restoration, keyed to the same trigger ref the press behavior below
 *     already uses.
 *   - **The trigger exposes its expanded state to assistive technology** —
 *     `useOverlayTrigger` (the hook `DialogTrigger` is built on) sets
 *     `aria-expanded`/`aria-haspopup="dialog"` on the trigger automatically;
 *     nothing here sets either by hand.
 *   - **Background content is inert to screen readers while open** —
 *     `useModalOverlay`'s own `ariaHideOutside`, which `aria-hide`s every
 *     DOM subtree outside the active overlay for as long as it's mounted,
 *     the same mechanism `Menu`'s and `Select`'s own popovers already rely
 *     on (deliberately not opted out of via `isNonModal` — see `Popover`'s
 *     own doc comment for why a general-purpose overlay stays modal).
 *   - **Usable with the keyboard alone, start to finish** — a real
 *     `<button>` (this package's own `Button` component) opens it on Enter/
 *     Space, Tab/Shift+Tab move within the trap, Escape or the close
 *     button's own Enter/Space closes it.
 */
export function NavShell({
  children,
  "aria-label": ariaLabel = "Primary",
  triggerLabel = "Menu",
  closeLabel = "Close menu",
  className,
  ...rest
}: NavShellProps) {
  return (
    <>
      <nav aria-label={ariaLabel} className={cx("hidden items-center nav-shell-row tablet:flex", className)}>
        {children}
      </nav>
      <SheetTrigger {...rest}>
        <Button variant="ghost" size="sm" className="tablet:hidden">
          {triggerLabel}
        </Button>
        <Sheet side="left" showCloseButton={false} className="w-nav-drawer gap-nav-drawer">
          <SheetTitle className="sr-only">{ariaLabel}</SheetTitle>
          <div className="flex items-center justify-end">
            <SheetClose variant="ghost" size="sm" aria-label={closeLabel}>
              <Icon glyph={X} decorative />
            </SheetClose>
          </div>
          <nav aria-label={ariaLabel} className="flex flex-col nav-shell-list">
            {children}
          </nav>
        </Sheet>
      </SheetTrigger>
    </>
  );
}

import type { ReactNode } from "react";
import {
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger,
  Popover,
  Separator,
  type MenuItemProps as AriaMenuItemProps,
  type MenuTriggerProps as AriaMenuTriggerProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ELEVATION_FLOATING, UI_Z_POPOVER } from "./internal/ui-vars.js";

export interface MenuProps extends Omit<AriaMenuTriggerProps, "children" | "trigger"> {
  /**
   * The element that opens the menu when pressed — typically a plain
   * react-aria-components `Button` (or this package's own `Button` atom;
   * see the note on that below). Rendered exactly as given, with menu
   * open/close behavior wired onto it by react-aria-components'
   * `MenuTrigger` via context, the same way `Select`'s trigger works.
   */
  trigger: ReactNode;
  /** One or more `Menu.Item`s and, optionally, `Menu.Separator`s. */
  children: ReactNode;
  /**
   * How the menu is opened — a left click (`"press"`, the default), a
   * long press, or a right click (`"contextMenu"`). react-aria-components'
   * own `MenuTrigger` prop for this is itself named `trigger`, which this
   * component's own `trigger` prop (the ReactNode element above) already
   * uses for something else entirely; renamed here to avoid that
   * collision.
   * @default "press"
   */
  triggerAction?: AriaMenuTriggerProps["trigger"];
  /** Merged onto the menu's own list element (inside the popover). */
  className?: string;
  /** Merged onto the popover panel that holds the menu. */
  popoverClassName?: string;
}

/**
 * A dropdown menu of actions, opened from a trigger element. Built on
 * react-aria-components' `MenuTrigger` + `Menu` + `MenuItem` + `Popover` —
 * the most involved composition in this package, and for that reason the
 * one where hand-rolling would be riskiest to get right. Between them these
 * primitives supply: opening on click AND on ArrowUp/ArrowDown/Enter/Space
 * when the trigger is focused (ArrowUp opens with the LAST item focused,
 * ArrowDown with the first — ordinary `<button onClick>` gives you neither
 * for free); closing on Escape, an outside click, selecting an item, or the
 * trigger losing focus; moving the active item with the arrow keys, wrapping
 * at the ends; Home/End jumping to the first/last enabled item; skipping
 * disabled items during arrow navigation entirely (they're never focusable,
 * not just visually dimmed); typeahead-by-first-letter; and the
 * `role="menu"`/`role="menuitem"`/`aria-expanded`/`aria-haspopup` wiring a
 * screen reader needs to announce all of it. None of that is reimplemented
 * here — this component only supplies the token-derived visual styling on
 * top.
 *
 * Composes no other atom of its own, even though its `trigger` prop is
 * commonly filled with this package's `Button` atom by a CONSUMER: that's
 * the consumer's own composition, in their code, the same way a `Button`
 * can be passed into `PageHeader`'s `actions` slot without `PageHeader`
 * importing `Button` itself. This file never imports `Button.js`.
 *
 * There's deliberately no `aria-label` prop here for the menu itself.
 * react-aria-components' `MenuTrigger` always wires the menu's
 * `aria-labelledby` to point at the trigger element, and per the ARIA
 * accessible-name computation, `aria-labelledby` on an element always wins
 * over an `aria-label` on that SAME element — so a hypothetical `aria-label`
 * prop here would render into the DOM but never actually be announced,
 * which is worse than not offering it at all. Give the TRIGGER its own
 * accessible name instead — visible text for a text button, `aria-label`
 * for an icon-only one (`<Button aria-label="More actions">⋯</Button>`) —
 * and the menu inherits that name automatically, correctly, through the
 * same `aria-labelledby` link.
 */
function MenuRoot({
  trigger,
  triggerAction,
  children,
  className,
  popoverClassName,
  ...rest
}: MenuProps) {
  return (
    <MenuTrigger {...rest} trigger={triggerAction}>
      {trigger}
      <Popover
        className={cx(
          "rounded-control border border-overlay-border bg-overlay-surface p-xs outline-none",
          popoverClassName,
        )}
        style={{ boxShadow: UI_ELEVATION_FLOATING, zIndex: UI_Z_POPOVER }}
      >
        <AriaMenu className={cx("flex flex-col outline-none", className)}>{children}</AriaMenu>
      </Popover>
    </MenuTrigger>
  );
}

export interface MenuItemProps extends Omit<AriaMenuItemProps, "className"> {
  children: ReactNode;
  /**
   * Marks this item as a destructive action (e.g. "Delete", "Remove
   * member") — styled with the danger status color instead of the default
   * ink color. Purely visual emphasis; it doesn't change keyboard/selection
   * behavior, so it stays a boolean prop rather than a structural variant.
   * @default false
   */
  isDestructive?: boolean;
  /** Merged onto this item's own rendered element. */
  className?: string;
}

function MenuItem({ children, isDestructive = false, className, ...rest }: MenuItemProps) {
  return (
    <AriaMenuItem
      {...rest}
      className={(renderProps) =>
        cx(
          "flex cursor-default items-center gap-sm rounded-default px-sm py-xs text-body-s font-body outline-none",
          renderProps.isDisabled
            ? "text-ink-muted"
            : isDestructive
              ? "text-status-danger-text"
              : "text-ink-primary",
          renderProps.isFocused && !renderProps.isDisabled
            ? isDestructive
              ? "bg-status-danger-tint"
              : "bg-surface-selected"
            : "",
          className,
        )
      }
    >
      {children}
    </AriaMenuItem>
  );
}

export interface MenuSeparatorProps {
  className?: string;
}

/** A visual divider between two groups of menu items. */
function MenuSeparator({ className }: MenuSeparatorProps) {
  // `border` (all four sides), not a directional `border-t`/`border-b`
  // utility: react-aria-components' `Separator` renders a zero-height
  // `<hr>`, so all four sides collapse onto the same visible line anyway,
  // and a directional class here would false-positive this package's
  // token-parity test — it reads `border-t`/`border-b` as `border-<COLOR
  // token>` (there's no "t"/"b" color token) rather than as a border-width
  // direction, since Tailwind overloads the same `border-` prefix for both.
  return <Separator className={cx("my-xs border border-line-base", className)} />;
}

export const Menu = Object.assign(MenuRoot, { Item: MenuItem, Separator: MenuSeparator });

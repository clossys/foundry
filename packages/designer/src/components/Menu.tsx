import { Fragment, isValidElement, type ReactNode, type HTMLAttributes } from "react";
import {
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger,
  MenuSection as AriaMenuSection,
  Header,
  Popover,
  Separator,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  type MenuTriggerProps as AriaMenuTriggerProps,
  type MenuSectionProps as AriaMenuSectionProps,
} from "react-aria-components";
import { Popover as ControlPopover } from "./Popover.js";
import { Icon } from "./Icon.js";
import { useGlyph } from "./glyph-context.js";
import { controlStateStyle } from "./button-classes.js";
import { cx } from "./internal/cx.js";
import { UI_ELEVATION_FLOATING, UI_Z_POPOVER } from "./internal/ui-vars.js";

export interface MenuProps extends Omit<AriaMenuTriggerProps, "children" | "trigger"> {
  /**
   * The element that opens the menu when pressed — typically a plain
   * react-aria-components `Button` (or this package's own `Button` component;
   * see the note on that below). Rendered exactly as given, with menu
   * open/close behavior wired onto it by react-aria-components'
   * `MenuTrigger` via context, the same way `Select`'s trigger works.
   */
  trigger: ReactNode;
  /** Host controls beside the action list in a named account-style popup. */
  controls?: ReactNode;
  /** Required accessible dialog name when controls are supplied. */
  controlsLabel?: string;
  /** Menu.Item entries, optionally grouped with Menu.Section and Menu.Separator. */
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
  /**
   * Root selection: `"single"` makes every item a radio item, `"multiple"` a
   * checkbox item; selected items show a leading check. Sections keep their
   * own `selectionMode` for mixed menus.
   * @default "none"
   */
  selectionMode?: MenuSelectionMode;
  selectedKeys?: AriaMenuProps<object>["selectedKeys"];
  defaultSelectedKeys?: AriaMenuProps<object>["defaultSelectedKeys"];
  onSelectionChange?: AriaMenuProps<object>["onSelectionChange"];
  /** Called with the activated item's id. */
  onAction?: AriaMenuProps<object>["onAction"];
}

export type MenuSelectionMode = "none" | "single" | "multiple";

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
 * The optional controls slot uses the shared dialog Popover so custom controls
 * can receive normal Tab focus alongside the action menu. The trigger remains
 * host-owned; this file never imports Button.js.
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
  controls,
  controlsLabel,
  children,
  className,
  popoverClassName,
  selectionMode,
  selectedKeys,
  defaultSelectedKeys,
  onSelectionChange,
  onAction,
  ...rest
}: MenuProps) {
  if (controls != null) {
    if (!controlsLabel?.trim()) throw new TypeError("Menu: controls require a non-empty controlsLabel.");
    return <ControlPopover {...rest} trigger={trigger} aria-label={controlsLabel} className={popoverClassName}>
      {({ close }) => <><AriaMenu className={cx("flex flex-col outline-none", className)}
        selectionMode={selectionMode} selectedKeys={selectedKeys} defaultSelectedKeys={defaultSelectedKeys}
        onSelectionChange={onSelectionChange} onAction={onAction} onClose={close} aria-label={controlsLabel}>
        {children}
      </AriaMenu>{controls}</>}
    </ControlPopover>;
  }
  return (
    <MenuTrigger {...rest} trigger={triggerAction}>
      {trigger}
      <Popover
        className={cx(
          "overlay-motion-pop rounded-control border border-overlay-border bg-overlay-surface p-xs outline-none",
          popoverClassName,
        )}
        style={{ boxShadow: UI_ELEVATION_FLOATING, zIndex: UI_Z_POPOVER }}
      >
        <AriaMenu
          className={cx("flex flex-col outline-none", className)}
          selectionMode={selectionMode}
          selectedKeys={selectedKeys}
          defaultSelectedKeys={defaultSelectedKeys}
          onSelectionChange={onSelectionChange}
          onAction={onAction}
        >
          {children}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
  );
}

export interface MenuInlineProps extends Omit<AriaMenuProps<object>, "className" | "children" | "selectionMode"> {
  children: ReactNode;
  selectionMode?: MenuSelectionMode;
  /** Merged onto the menu surface. */
  className?: string;
}

/**
 * The same menu presented inline: always visible in the page, with no
 * trigger or popover, on the overlay surface without its floating
 * elevation. Name it with `aria-label` or `aria-labelledby`. Arrow keys,
 * Home/End, typeahead, actions and root or section selection behave as in
 * the popup menu; Tab moves focus into it and on past it.
 */
function MenuInline({ children, className, ...rest }: MenuInlineProps) {
  return (
    <AriaMenu
      {...rest}
      className={cx(
        "flex flex-col rounded-control border border-overlay-border bg-overlay-surface p-xs outline-none",
        className,
      )}
    >
      {children}
    </AriaMenu>
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

function MenuItem({ children, isDestructive = false, className, textValue, style, ...rest }: MenuItemProps) {
  const checkGlyph = useGlyph("assets.icon-check");
  return (
    <AriaMenuItem
      {...rest}
      // The render function below hides string children from the collection,
      // so typeahead keeps its text explicitly.
      style={state => ({ ...controlStateStyle(state), ...(typeof style === "function" ? style(state) : style) })}
      textValue={textValue ?? (typeof children === "string" ? children : undefined)}
      className={(renderProps) =>
        cx(
          "flex cursor-default items-center gap-sm rounded-default px-sm py-xs text-body-s font-body outline-none",
          renderProps.isFocused && !renderProps.isDisabled ? "forced-colors:outline forced-colors:outline-solid" : "",
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
      {(renderProps) => (
        <>
          {renderProps.selectionMode !== "none" ? (
            <span data-menu-check="" className={cx("inline-flex shrink-0", renderProps.isSelected ? "" : "invisible")}>
              <Icon glyph={checkGlyph} decorative size="sm" className={renderProps.isDisabled ? "" : "text-accent-text"} />
            </span>
          ) : null}
          {children}
        </>
      )}
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

type MenuSectionBaseProps = Pick<AriaMenuSectionProps<object>,
  "selectedKeys" | "onSelectionChange" | "shouldCloseOnSelect"
> & { children: ReactNode; selectionMode?: "none" | "single" | "multiple" };

/** A section needs an accessible name: a visible `heading`, an `aria-label`, or both. */
type MenuSectionProps = MenuSectionBaseProps & (
  | { heading: ReactNode; "aria-label"?: string }
  | { heading?: ReactNode; "aria-label": string }
);

const isBlank = (value: unknown): boolean =>
  value == null || typeof value === "boolean" || (typeof value === "string" && !value.trim());

// Only inspect intrinsic content and fragments; a component's output cannot
// be verified here. Such headings need the section's explicit aria-label.
function hasHeadingText(value: ReactNode): boolean {
  if (typeof value === "string") return !!value.trim();
  if (typeof value === "number" || typeof value === "bigint") return true;
  if (Array.isArray(value)) return value.some(hasHeadingText);
  if (!isValidElement<HTMLAttributes<HTMLElement>>(value)) return false;
  if (value.type === Fragment) return hasHeadingText(value.props.children);
  if (typeof value.type !== "string") return false;
  const props = value.props;
  if (props.hidden || props["aria-hidden"] === true || props["aria-hidden"] === "true"
    || props.style?.display === "none" || props.style?.visibility === "hidden"
    || props["aria-labelledby"]
    || ["script", "style", "template"].includes(value.type)) return false;
  if (props["aria-label"] !== undefined) return !isBlank(props["aria-label"]);
  return hasHeadingText(props.children);
}

/**
 * A named group with optional controlled radio or checkbox selection, owned by the
 * menu peer. Throws if neither `heading` nor `aria-label` carries a
 * non-empty name, since that would render an unnamed menu group.
 */
function MenuSection({ heading, children, ...rest }: MenuSectionProps) {
  const hasHeading = hasHeadingText(heading);
  if (!hasHeading && isBlank(rest["aria-label"])) {
    throw new TypeError("Menu.Section: a non-empty heading or aria-label is required.");
  }
  return <AriaMenuSection {...rest} className="flex flex-col">
    {!isBlank(heading) && <Header aria-label={hasHeading ? undefined : rest["aria-label"]}
      className="px-sm py-xs text-caption font-body text-ink-muted">{heading}</Header>}
    {children}
  </AriaMenuSection>;
}

export const Menu = Object.assign(MenuRoot, { Inline: MenuInline, Item: MenuItem, Separator: MenuSeparator, Section: MenuSection });

import type { CSSProperties, ReactNode } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Popover as AriaPopover,
  type DialogRenderProps,
  type DialogTriggerProps as AriaDialogTriggerProps,
  type Placement,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ELEVATION_FLOATING, UI_Z_POPOVER } from "./internal/ui-vars.js";

export interface PopoverProps extends Omit<AriaDialogTriggerProps, "children"> {
  /**
   * The element that opens the popover when pressed — the same `trigger`
   * slot shape `Menu`/`Dialog` already use in this package. Rendered
   * exactly as given, with open/close behavior and anchor positioning wired
   * onto it by react-aria-components' `DialogTrigger` via context.
   */
  trigger: ReactNode;
  /**
   * The popover's own content. A function may be provided to reach an
   * imperative `close()`, the same shape this package's own `Dialog`
   * accepts — useful for a footer control that closes the popover without
   * threading `isOpen` state back out to wherever the trigger is rendered.
   */
  children: ReactNode | ((opts: DialogRenderProps) => ReactNode);
  /**
   * The popover's placement relative to `trigger`.
   * @default "bottom"
   */
  placement?: Placement;
  /**
   * Additional offset (px) along the main axis between the popover and
   * `trigger`.
   * @default 8
   */
  offset?: number;
  /** Merged onto the popover surface element itself. */
  className?: string;
  /** Merged onto the popover surface element's inline style. */
  style?: CSSProperties;
}

/**
 * The general anchored-overlay primitive: an arbitrary panel of content,
 * positioned relative to a trigger, for anything this package doesn't
 * already ship a purpose-built overlay atom for. `Menu`, `Select`, and
 * `Tooltip` each use react-aria-components' own `Popover` internally for
 * their own specific content shape (a list of actions, a listbox, a short
 * description) — reach for THIS component only when none of those specific
 * shapes fit (a filter panel with several controls, a rich preview, a
 * small inline form), the same "don't reach for the general primitive when
 * a purpose-built one already exists" reasoning `Table`'s own primitives
 * vs. the planned `DataTable` block follow one rung up this package's
 * ladder.
 *
 * Built on react-aria-components' `DialogTrigger` + `Popover` + `Dialog` —
 * the same trigger/overlay/content composition this package's own `Dialog`
 * atom uses, with `Popover` (anchored, no scrim, positioned relative to
 * `trigger`) standing in for `Dialog`'s `ModalOverlay`+`Modal` (centered,
 * with a scrim, detached from any anchor). Between them these primitives
 * supply: a focus trap and automatic focus-move into the content on open,
 * focus restoration to `trigger` on close, Escape to dismiss, dismissal on
 * an outside click (always — there's no `isDismissable` gate here the way
 * `Dialog`'s modal scrim needs one, since an anchored popover with no scrim
 * has no OTHER way to signal "click away to close"), and `placement`/
 * `offset`-aware positioning that reflows when the viewport doesn't have
 * room for the requested placement — none of it reimplemented here.
 *
 * While open, everything outside the popover is hidden from assistive tech
 * (`aria-hidden`) — react-aria-components' own default, deliberately not
 * overridden with its `isNonModal` escape hatch: that option exists for a
 * narrow set of components "designed to handle this situation carefully"
 * (its own doc comment's words — a combobox, mid-typing, where the input
 * outside the popover still needs to stay live), which a general-purpose
 * overlay primitive like this one is not. `Menu`'s and `Select`'s own
 * popovers make the identical choice.
 *
 * The inner `Dialog` (react-aria-components' own, NOT this package's own
 * `Dialog` atom) is what supplies the focus trap and Escape/`aria-modal`
 * wiring described above; it's unstyled here (`outline-none` only) since
 * the visual surface — border, background, elevation — belongs on the
 * `Popover` panel around it, the same division `Menu`'s own `Popover` +
 * `Menu` list already draws in this package.
 */
export function Popover({
  trigger,
  children,
  placement = "bottom",
  offset = 8,
  className,
  style,
  ...rest
}: PopoverProps) {
  return (
    <DialogTrigger {...rest}>
      {trigger}
      <AriaPopover
        placement={placement}
        offset={offset}
        className={cx(
          "rounded-control border border-overlay-border bg-overlay-surface p-md outline-none",
          className,
        )}
        style={{ boxShadow: UI_ELEVATION_FLOATING, zIndex: UI_Z_POPOVER, ...style }}
      >
        <AriaDialog className="outline-none">{children}</AriaDialog>
      </AriaPopover>
    </DialogTrigger>
  );
}

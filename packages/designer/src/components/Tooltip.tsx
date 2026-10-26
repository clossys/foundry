import type { ReactNode } from "react";
import {
  Tooltip as AriaTooltip,
  TooltipTrigger,
  type TooltipTriggerComponentProps,
  type Placement,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ELEVATION_FLOATING, UI_Z_TOOLTIP } from "./internal/ui-vars.js";

export interface TooltipProps extends Omit<TooltipTriggerComponentProps, "children" | "trigger"> {
  /**
   * The element the tooltip describes — typically an icon-only `Button` or
   * any other control whose accessible name alone doesn't say enough.
   * Rendered exactly as given, with hover/focus open behavior and the
   * `aria-describedby` link back to the tooltip's own generated id wired
   * onto it by react-aria-components' `TooltipTrigger` via context, the
   * same trigger-context shape `Menu`/`Select`/`Dialog` already use in this
   * package.
   */
  trigger: ReactNode;
  /** The tooltip's own content. */
  children: ReactNode;
  /**
   * Which interaction opens the tooltip — both hover AND keyboard focus
   * (the default, `undefined`), or focus only. Renamed from
   * react-aria-components' own `TooltipTrigger` prop of the same name
   * (there, `"hover" | "focus"`) to avoid colliding with this component's
   * OWN `trigger` prop above (the element), the identical collision `Menu`
   * already resolves the identical way with its own `triggerAction` prop —
   * see that component's own doc comment.
   */
  triggerAction?: TooltipTriggerComponentProps["trigger"];
  /**
   * The tooltip's placement relative to `trigger`.
   * @default "top"
   */
  placement?: Placement;
  /** Merged onto the tooltip's own surface element. */
  className?: string;
}

/**
 * A short description of another element, shown on hover or keyboard focus.
 * Built on react-aria-components' `TooltipTrigger` + `Tooltip`, which supply
 * everything that's easy to get subtly wrong hand-rolling a "hover to show a
 * div" component: opening on BOTH mouse hover and keyboard focus by default
 * (a hover-only implementation is invisible to a keyboard user — the entire
 * reason a tooltip needs a dedicated component rather than a CSS
 * `:hover { display: block }` rule), Escape dismissing it, a shared
 * "warm up"/"cool down" delay (moving between several tooltipped controls in
 * quick succession skips the opening delay for the second one onward,
 * matching the platform convention react-aria-components' own
 * `useTooltipTriggerState` documents), and the `aria-describedby` link from
 * the trigger to the tooltip's own generated id — none of it reimplemented
 * here.
 *
 * `delay` (default 1500ms) and `closeDelay` (default 500ms) pass straight
 * through react-aria-components' own `TooltipTrigger` (part of `...rest` on
 * this component's props) — this component doesn't override either default,
 * since 1500ms before a first tooltip appears and 500ms of grace before it
 * disappears are themselves the "correct delay behavior" a tooltip needs to
 * avoid flashing open on every incidental mouse pass. Pass
 * `triggerAction="focus"` to open only on keyboard focus, never on hover,
 * for a tooltip whose content is redundant with something already visible
 * on-screen for a mouse user (rare — omit it unless you have a specific
 * reason).
 */
export function Tooltip({
  trigger,
  children,
  triggerAction,
  placement = "top",
  className,
  ...rest
}: TooltipProps) {
  return (
    <TooltipTrigger {...rest} trigger={triggerAction}>
      {trigger}
      <AriaTooltip
        placement={placement}
        className={cx(
          "rounded-control border border-overlay-border bg-overlay-surface px-sm py-xs text-caption text-ink-primary outline-none",
          className,
        )}
        style={{ boxShadow: UI_ELEVATION_FLOATING, zIndex: UI_Z_TOOLTIP }}
      >
        {children}
      </AriaTooltip>
    </TooltipTrigger>
  );
}

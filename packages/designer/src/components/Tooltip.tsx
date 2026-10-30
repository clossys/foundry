import { cloneElement, isValidElement, useId, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import {
  Focusable,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  TooltipTriggerStateContext,
  type TooltipTriggerComponentProps,
  type Placement,
  type TooltipProps as AriaTooltipProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ELEVATION_FLOATING, UI_Z_TOOLTIP } from "./internal/ui-vars.js";

/** Interactive roles a disabled trigger's focus target can expose. */
export type DisabledTriggerRole = "button" | "link" | "menuitem" | "tab";

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
  /**
   * Describe a natively disabled control. A disabled element takes neither hover nor focus,
   * so the component owns the focus target instead (react-aria's `Focusable`): one element
   * with `disabledTriggerRole`, `aria-disabled="true"`, the control's own accessible name
   * (its `aria-labelledby`, else `aria-label`, else its text) and the tooltip's `aria-describedby`. The disabled
   * control inside it stays rendered but is hidden from assistive tech, so the tree holds one
   * control, not two. The consumer passes the disabled control unchanged and adds no wrapper.
   * Requires one trigger element.
   * @default false
   */
  disabledTrigger?: boolean;
  /** The role the disabled control exposes through its focus target. @default "button" */
  disabledTriggerRole?: DisabledTriggerRole;
  /** Controlled opening without hover/focus listeners or a document Escape handler. Requires `isOpen`. */
  manual?: boolean;
  /**
   * A custom tooltip surface for manual mode. The component still owns its trigger's description,
   * anchor and state; the renderer draws the supplied surface in the provided portal container.
   */
  renderSurface?: (props: {
    readonly id: string;
    readonly triggerRef: RefObject<Element | null>;
    readonly portalContainer: Element;
    readonly placement: Placement;
    readonly children: ReactNode;
    readonly className?: string;
  }) => ReactNode;
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
  manual = false,
  renderSurface,
  disabledTrigger = false,
  disabledTriggerRole = "button",
  ...rest
}: TooltipProps) {
  if (manual) {
    if (typeof rest.isOpen !== "boolean") throw new TypeError("Manual Tooltip requires controlled isOpen.");
    if (!isValidElement(trigger)) throw new TypeError("Manual Tooltip requires one trigger element.");
    return <ManualTooltip trigger={trigger} children={children} placement={placement} className={className}
      isOpen={rest.isOpen} onOpenChange={rest.onOpenChange} renderSurface={renderSurface} />;
  }
  if (renderSurface) throw new TypeError("Tooltip renderSurface requires manual mode.");
  if (disabledTrigger && !isValidElement(trigger)) throw new TypeError("Tooltip disabledTrigger requires one trigger element.");
  return (
    <TooltipTrigger {...rest} trigger={triggerAction}>
      {disabledTrigger ? (
        <DisabledTrigger role={disabledTriggerRole} trigger={trigger as ReactElement<DisabledTriggerNaming>} />
      ) : trigger}
      <AriaTooltip
        placement={placement}
        className={cx(
          "overlay-motion-fade rounded-control border border-overlay-border bg-overlay-surface px-sm py-xs text-caption text-ink-primary outline-none",
          className,
        )}
        style={{ boxShadow: UI_ELEVATION_FLOATING, zIndex: UI_Z_TOOLTIP }}
      >
        {children}
      </AriaTooltip>
    </TooltipTrigger>
  );
}

/** The naming props a disabled trigger forwards onto its focus target. */
interface DisabledTriggerNaming {
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/**
 * The focus target for a natively disabled control: an interactive role, `aria-disabled`, the
 * control's own naming forwarded (its `aria-labelledby`, else `aria-label`, else its text by id), and react-aria's hover/focus/description wiring
 * from `Focusable`. The control itself is presentational content of this target.
 */
function DisabledTrigger({ role, trigger }: { role: DisabledTriggerRole; trigger: ReactElement<DisabledTriggerNaming> }) {
  const generated = useId();
  const controlId = trigger.props.id ?? generated;
  // Accessible-name computation follows one aria-labelledby hop only, so the control's own
  // naming is forwarded as-is: its labelledby ids, else its aria-label, else its text by id.
  const { "aria-labelledby": labelledBy, "aria-label": label } = trigger.props;
  const naming = labelledBy ? { "aria-labelledby": labelledBy } : label ? { "aria-label": label } : { "aria-labelledby": controlId };
  return (
    <Focusable>
      <span role={role} tabIndex={0} aria-disabled="true" {...naming} className="inline-flex" data-tooltip-disabled-trigger="">
        <span aria-hidden="true" className="inline-flex">{cloneElement(trigger, { id: controlId })}</span>
      </span>
    </Focusable>
  );
}

/** An externally controlled tooltip must not install the interactive trigger's global key listener. */
function ManualTooltip({ trigger, children, placement = "top", className, isOpen, onOpenChange, renderSurface }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const describedBy = isValidElement<{ "aria-describedby"?: string }>(trigger)
    ? [trigger.props["aria-describedby"], isOpen ? id : undefined].filter(Boolean).join(" ") || undefined : undefined;
  // RAC forwards id to the DOM, but its Tooltip declaration omits DOMProps.
  // Keep that runtime id in a typed spread so description links retain their target.
  const surfaceProps: AriaTooltipProps & { id: string } = {
    id, triggerRef, UNSTABLE_portalContainer: container ?? undefined, placement,
  };
  return <div ref={setContainer} data-tooltip-host="">
    <TooltipTriggerStateContext.Provider value={{ isOpen: isOpen === true, shouldSkipAnimation: true,
      open: () => onOpenChange?.(true), close: () => onOpenChange?.(false) }}>
      <div ref={triggerRef} className="inline-flex" data-tooltip-anchor="">
        {isValidElement<{ "aria-describedby"?: string }>(trigger) ? cloneElement(trigger, { "aria-describedby": describedBy }) : trigger}
      </div>
      {container && isOpen ? renderSurface
        ? renderSurface({ id, triggerRef, portalContainer: container, placement, children, className })
        : <AriaTooltip {...surfaceProps}
          className={cx("overlay-motion-fade rounded-control border border-overlay-border bg-overlay-surface px-sm py-xs text-caption text-ink-primary outline-none", className)}
          style={{ boxShadow: UI_ELEVATION_FLOATING, zIndex: UI_Z_TOOLTIP }}>{children}</AriaTooltip> : null}
    </TooltipTriggerStateContext.Provider>
  </div>;
}

import { useRef, type HTMLAttributes, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET } from "./internal/ui-vars.js";

export interface ResizeHandleProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onChange" | "defaultValue" | "role" | "aria-label" | "dir" | "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture" | "onKeyDown" | "onFocus" | "onBlur"> {
  value: number;
  min: number;
  max: number;
  resetValue: number;
  label: string;
  onChange: (value: number) => void;
  /** A vertical separator changes inline width; a horizontal separator changes block height. @default "vertical" */
  orientation?: "vertical" | "horizontal";
  /** Positive keyboard increment, in the same units as value. @default 1 */
  step?: number;
  /** Omitted direction follows computed/inherited direction at interaction time. */
  dir?: "ltr" | "rtl";
}

/** Focusable separator with bounded pointer/keyboard resizing; Enter resets, Escape cancels a drag. */
export function ResizeHandle({
  value, min, max, resetValue, label, onChange,
  orientation = "vertical", step = 1, dir, className, style, ...rest
}: ResizeHandleProps) {
  const drag = useRef<{ pointer: number; coordinate: number; value: number } | null>(null);
  if (![value, min, max, resetValue, step].every(Number.isFinite) || min > max || step <= 0 || typeof label !== "string" || !label.trim() || (orientation !== "vertical" && orientation !== "horizontal")) {
    throw new TypeError("ResizeHandle: finite ordered bounds, a positive step, a name and a supported orientation are required.");
  }
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const current = clamp(value);
  const horizontalMovement = orientation === "vertical";
  const sign = (element: HTMLElement) => {
    const inherited = getComputedStyle(element).direction || element.closest("[dir]")?.getAttribute("dir");
    return horizontalMovement && (dir ?? inherited) === "rtl" ? -1 : 1;
  };
  const coordinate = (event: PointerEvent<HTMLDivElement>) => horizontalMovement ? event.clientX : event.clientY;
  const finish = (element: HTMLDivElement, cancel: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (element.hasPointerCapture?.(active.pointer)) element.releasePointerCapture(active.pointer);
    if (cancel) onChange(clamp(active.value));
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      event.stopPropagation();
      finish(event.currentTarget, true);
      return;
    }
    let next: number;
    if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === "Enter") next = resetValue;
    else if (event.key === (horizontalMovement ? "ArrowRight" : "ArrowDown")) next = current + step * sign(event.currentTarget);
    else if (event.key === (horizontalMovement ? "ArrowLeft" : "ArrowUp")) next = current - step * sign(event.currentTarget);
    else return;
    event.preventDefault();
    onChange(clamp(next));
  };
  return (
    <div
      {...rest}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={current} aria-valuemin={min} aria-valuemax={max}
      dir={dir}
      className={cx(
        "flex shrink-0 items-center justify-center focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        horizontalMovement ? "cursor-col-resize" : "cursor-row-resize", className,
      )}
      style={{
        ...style,
        minWidth: UI_LAYOUT_TAP_TARGET, minHeight: UI_LAYOUT_TAP_TARGET,
        touchAction: "none", userSelect: "none",
      }}
      onKeyDown={keyDown}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current || !Number.isFinite(coordinate(event))) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { pointer: event.pointerId, coordinate: coordinate(event), value: current };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || active.pointer !== event.pointerId || !Number.isFinite(coordinate(event))) return;
        onChange(clamp(active.value + (coordinate(event) - active.coordinate) * sign(event.currentTarget)));
      }}
      onPointerUp={event => { if (drag.current?.pointer === event.pointerId) finish(event.currentTarget, false); }}
      onPointerCancel={event => { if (drag.current?.pointer === event.pointerId) finish(event.currentTarget, true); }}
      onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) finish(event.currentTarget, true); }}
    >
      <span
        aria-hidden="true"
        style={{ borderWidth: UI_BORDER_HAIRLINE }}
        className={horizontalMovement ? "self-stretch border-s border-line-base" : "w-full border-t border-line-base"}
      />
    </div>
  );
}

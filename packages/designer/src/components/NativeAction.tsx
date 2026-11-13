import { forwardRef, type ComponentPropsWithRef } from "react";
import { buttonClassName } from "./button-classes.js";
import { cx } from "./internal/cx.js";

/** A native action with explicit form behavior and the fixed primary/md/base appearance. */
export type NativeActionProps = Omit<ComponentPropsWithRef<"button">, "type" | "role" | "dangerouslySetInnerHTML"> & {
  type: "button" | "submit" | "reset";
  role?: never;
  dangerouslySetInnerHTML?: never;
};

/**
 * One native button. Browser activation and disabled behavior remain native;
 * aria-disabled alone annotates the control and does not suppress activation.
 * Caller content owns its name; caller classes and inline styles apply last.
 */
export const NativeAction = forwardRef<HTMLButtonElement, NativeActionProps>(function NativeAction({ type, className, style, children, ...props }, ref) {
  if (type !== "button" && type !== "submit" && type !== "reset") throw new TypeError("NativeAction requires an explicit native button type");
  for (const name of ["role", "dangerouslySetInnerHTML", "as", "href", "onPress", "isDisabled", "isPending", "variant", "size", "ground", "render"]) {
    if ((props as Record<string, unknown>)[name] !== undefined) throw new TypeError(`NativeAction does not accept ${name}`);
  }
  if (typeof children === "function" || typeof className === "function" || typeof style === "function") throw new TypeError("NativeAction does not accept render functions");
  return <button {...props} type={type} ref={ref}
    className={cx(buttonClassName("primary", "md", "base"), "active:bg-action-pressed focus-visible:[outline:var(--ui-border-focus,2px)_solid_var(--color-focus-ring)] focus-visible:[outline-offset:var(--ui-focus-offset,2px)] disabled:opacity-[var(--ui-alpha-disabled,0.5)]", className)}
    style={style}>{children}</button>;
});

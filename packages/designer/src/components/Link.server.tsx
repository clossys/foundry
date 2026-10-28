import { createElement, type ComponentPropsWithoutRef } from "react";
import type { LinkRenderProps } from "react-aria-components";
import type { LinkProps } from "./Link.client.js";
import { buttonClassName, controlSizeStyle, controlStateStyle } from "./button-classes.js";
import { cx } from "./internal/cx.js";
import { LINK_BASE, LINK_VARIANT_CLASSES } from "./Link.styles.js";

export type { LinkProps, LinkVariant } from "./Link.types.js";

/**
 * The static entry of Link. Native navigation, naming and disabled semantics
 * render without loading interaction hooks. The client entry owns press,
 * focus and hover behavior after the component's client boundary hydrates.
 */
export function Link({ variant = "default", buttonVariant, buttonSize, ground = "base",
  className, style, children, render, isDisabled = false, href, ...rest }: LinkProps) {
  const state: LinkRenderProps = { isCurrent: Boolean((rest as Record<string, unknown>)["aria-current"]), isDisabled,
    isHovered: false, isPressed: false, isFocused: false, isFocusVisible: false };
  const button = buttonVariant !== undefined || buttonSize !== undefined;
  const native: Record<string, unknown> = {};
  // Interaction/router options belong to the client entry, never DOM attributes.
  for (const [name, value] of Object.entries(rest)) {
    if (name.startsWith("aria-") || name.startsWith("data-")
      || ["id", "slot", "title", "lang", "dir", "tabIndex", "target", "rel", "download", "ping", "referrerPolicy", "hrefLang", "type", "accessKey", "hidden", "inert", "draggable", "spellCheck", "translate", "role"].includes(name)) native[name] = value;
  }
  const props = {
    ...native,
    href,
    role: !href || isDisabled ? "link" : native.role,
    tabIndex: isDisabled ? undefined : (native.tabIndex ?? 0),
    "aria-disabled": isDisabled || undefined,
    "data-rac": "",
    "data-react-aria-pressable": true,
    "data-current": state.isCurrent || undefined,
    "data-disabled": isDisabled || undefined,
    className: cx(button ? buttonClassName(buttonVariant ?? "primary", buttonSize ?? "md", ground)
      : [LINK_BASE, LINK_VARIANT_CLASSES[variant]].join(" "),
    typeof className === "function" ? className({ ...state, defaultClassName: "react-aria-Link" }) : className),
    style: { ...(button ? controlSizeStyle(buttonSize) : {}),
      ...controlStateStyle(state, { ground: button ? ground : "base", dimDisabled: button }),
      ...(typeof style === "function" ? style({ ...state, defaultStyle: {} }) : style) },
    children: typeof children === "function" ? children({ ...state, defaultChildren: undefined }) : children,
  };
  if (render) return render(props as ComponentPropsWithoutRef<"a"> & { href: string }, state);
  return createElement(href && !isDisabled ? "a" : "span", props);
}

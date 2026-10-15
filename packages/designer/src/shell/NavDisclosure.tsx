"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { buttonLinkClassName } from "../atoms/button-classes.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "./internal/shell-vars.js";

export interface NavDisclosureProps {
  /** Navigation links, rendered once in the responsive panel. */
  children: ReactNode;
  /** The navigation landmark's name. @default "Primary" */
  "aria-label"?: string;
  /** The toggle's visible and accessible name. @default "Menu" */
  triggerLabel?: string;
  /** Additional classes on the navigation landmark. */
  className?: string;
}

// Borrow the small ghost button's look and focus outline, without its colour
// transition: this disclosure changes state without animation.
const TOGGLE_CLASSES = buttonLinkClassName("ghost", "sm")
  .split(" ")
  .filter(token => !token.includes("transition-"))
  .join(" ");

/**
 * SiteHeader navigation that becomes a sheet below tablet and an inline row
 * above it. CSS keeps the same links inline when scripting is unavailable.
 * Unlike NavShell, this is a disclosure, without a modal drawer or focus trap.
 */
export function NavDisclosure({ children, "aria-label": ariaLabel = "Primary", triggerLabel = "Menu", className }: NavDisclosureProps) {
  const panelId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <nav
      aria-label={ariaLabel}
      className={className}
      onKeyDown={event => {
        if (event.key !== "Escape" || !expanded) return;
        event.preventDefault();
        setExpanded(false);
        toggle.current?.focus();
      }}
    >
      <button
        ref={toggle}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cx(TOGGLE_CLASSES, "nav-disclosure-toggle")}
        style={{ minHeight: UI_LAYOUT_TAP_TARGET, minWidth: UI_LAYOUT_TAP_TARGET }}
        onClick={() => setExpanded(value => !value)}
      >
        {triggerLabel}
      </button>
      <div
        id={panelId}
        className="nav-disclosure-panel"
        data-expanded={expanded ? "" : undefined}
        onClick={event => {
          if (event.target instanceof Element && event.target.closest("a[href]")) setExpanded(false);
        }}
      >
        {children}
      </div>
    </nav>
  );
}

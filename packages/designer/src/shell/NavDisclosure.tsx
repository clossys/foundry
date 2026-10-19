"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TOKENS } from "../tokens/tokens.js";
import { buttonLinkClassName } from "../atoms/button-classes.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "./internal/shell-vars.js";

export interface NavDisclosureProps {
  /** Navigation links, rendered once in the responsive panel. */
  children: ReactNode;
  /** The navigation landmark's name. @default "Primary" */
  "aria-label"?: string;
  /** The toggle's accessible name; also visible with the label trigger. @default "Menu" */
  triggerLabel?: string;
  /** Toggle content; the icon keeps triggerLabel as its accessible name. @default "label" */
  trigger?: "label" | "icon";
  /** Trigger ink; omitted follows an inverse overlay header. @default "auto" */
  tone?: "auto" | "inverse";
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
export function NavDisclosure({ children, "aria-label": ariaLabel = "Primary", triggerLabel = "Menu", trigger = "label", tone, className }: NavDisclosureProps) {
  // Select a complete look before cx: tailwind-merge is an optional peer.
  const inverse = tone === "inverse";
  const look = inverse
    ? TOGGLE_CLASSES.split(" ").filter(token => !["text-ink-primary", "hover:bg-surface-sunken", "focus-visible:outline-accent"].includes(token)).join(" ")
    : TOGGLE_CLASSES;
  const panelId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(true);
  const open = useRef(false);
  open.current = expanded;
  const close = (restore = true) => {
    if (!open.current) return;
    setExpanded(false);
    if (restore) toggle.current?.focus();
  };
  useEffect(() => {
    const media = window.matchMedia?.(`(min-width: ${TOKENS["--breakpoint-tablet"]!.value})`);
    const header = nav.current?.closest<HTMLElement>("[data-header-root]");
    const frame = header?.parentElement;
    const priorClearance = frame?.style.getPropertyValue("--site-header-clearance");
    let disposed = false;
    let wasMobile = true;
    // Child rectangles measure occupied content, never an allocated equal grid track.
    const extent = (element: HTMLElement | null) => {
      const boxes = [...(element?.children ?? [])].map(child => child.getBoundingClientRect()).filter(box => box.width > 0);
      return boxes.length ? Math.max(...boxes.map(box => box.right)) - Math.min(...boxes.map(box => box.left)) : 0;
    };
    const measure = () => {
      if (disposed) return;
      let narrow = !media?.matches;
      if (header) {
        header.removeAttribute("data-collapsed");
        const row = header.firstElementChild as HTMLElement;
        const brand = row.querySelector<HTMLElement>(".site-header-brand");
        const actions = row.querySelector<HTMLElement>(".site-header-desktop-actions") ?? row.querySelector<HTMLElement>(".site-header-actions");
        const links = panel.current?.querySelector<HTMLElement>(".site-header-nav-links") ?? panel.current?.firstElementChild as HTMLElement | null;
        const spacing = getComputedStyle(row);
        const width = row.getBoundingClientRect().width - parseFloat(spacing.paddingInlineStart || "0") - parseFloat(spacing.paddingInlineEnd || "0");
        const gap = parseFloat(spacing.columnGap || "0");
        narrow ||= width < 2 * Math.max(extent(brand), extent(actions)) + extent(links) + 2 * gap;
        header.toggleAttribute("data-collapsed", narrow);
        const height = header.getBoundingClientRect().height;
        if (height > 0) frame?.style.setProperty("--site-header-clearance", `${height}px`);
      }
      const active = document.activeElement;
      if (!narrow) {
        if (active === toggle.current || active?.closest(".site-header-actions")) {
          const anchors = [...(nav.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])];
          const target = anchors.find(link => active instanceof HTMLAnchorElement && link.href === active.href) ?? anchors[0] ?? header?.querySelector<HTMLElement>(".site-header-brand a");
          target?.focus();
        }
        setExpanded(false);
      } else if (!wasMobile && active instanceof Node && panel.current?.contains(active)) {
        close();
        toggle.current?.focus();
      }
      wasMobile = narrow;
      setMobile(narrow);
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    const observe = () => {
      observer?.disconnect();
      if (header) { observer?.observe(header); header.querySelectorAll(".site-header-brand > *, .site-header-desktop-actions a, .site-header-nav-links a").forEach(node => observer?.observe(node)); }
    };
    const signature = () => JSON.stringify([...(nav.current?.querySelectorAll("a[href]") ?? [])].map(link => [link.getAttribute("href"), link.getAttribute("aria-current"), link.textContent]));
    let content = signature();
    const mutations = new MutationObserver(() => {
      const next = signature();
      if (next !== content) { content = next; close(); }
      measure(); observe();
    });
    if (nav.current) mutations.observe(nav.current, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "aria-current"] });
    measure(); observe();
    media?.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      disposed = true; observer?.disconnect(); mutations.disconnect();
      media?.removeEventListener("change", measure); window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
      if (priorClearance) frame?.style.setProperty("--site-header-clearance", priorClearance); else frame?.style.removeProperty("--site-header-clearance");
    };
  }, []);
  // Imperative boolean attributes support React 18 as well as React 19, with
  // no inert server markup to break the no-scripting fallback.
  useEffect(() => { panel.current?.toggleAttribute("inert", mobile && !expanded && Boolean(nav.current?.closest("header"))); }, [mobile, expanded]);
  useEffect(() => {
    const reset = () => close();
    const leave = (event: FocusEvent) => {
      // A host notice may have captured this menu item as its return target.
      // Keep that target live until the notice has returned focus.
      if (document.querySelector("[data-consent-banner]")) return;
      if (event.target instanceof Node && !(nav.current?.closest("header") ?? nav.current)?.contains(event.target)) close(false);
    };
    window.addEventListener("popstate", reset); window.addEventListener("hashchange", reset);
    document.addEventListener("focusin", leave);
    return () => { window.removeEventListener("popstate", reset); window.removeEventListener("hashchange", reset); document.removeEventListener("focusin", leave); };
  }, []);


  return (
    <nav
      ref={nav}
      aria-label={ariaLabel}
      className={className}
      onKeyDown={event => {
        if (event.key !== "Escape" || !expanded) return;
        event.preventDefault();
        close();
      }}
    >
      {trigger === "icon" ? (
        <button
          ref={toggle}
          type="button"
          aria-label={triggerLabel}
          aria-expanded={expanded}
          aria-controls={panelId}
          data-tone={tone}
          className={cx(look, "nav-disclosure-toggle", inverse ? "text-ink-on-inverse hover:text-ink-on-inverse aria-expanded:text-ink-on-inverse focus-visible:text-ink-on-inverse hover:bg-control-tonal-inverse-hover focus-visible:outline-ink-on-inverse" : undefined)}
          style={{ minHeight: UI_LAYOUT_TAP_TARGET, minWidth: UI_LAYOUT_TAP_TARGET }}
          onClick={() => setExpanded(value => !value)}
        >
          <><span className="nav-disclosure-icon" data-open={expanded ? "" : undefined} aria-hidden="true"><span /><span /></span></>
        </button>
      ) : (
        <button
          ref={toggle}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          data-tone={tone}
          className={cx(look, "nav-disclosure-toggle", inverse ? "text-ink-on-inverse hover:text-ink-on-inverse aria-expanded:text-ink-on-inverse focus-visible:text-ink-on-inverse hover:bg-control-tonal-inverse-hover focus-visible:outline-ink-on-inverse" : undefined)}
          style={{ minHeight: UI_LAYOUT_TAP_TARGET, minWidth: UI_LAYOUT_TAP_TARGET }}
          onClick={() => setExpanded(value => !value)}
        >
          {triggerLabel}
        </button>
      )}
      <div
        ref={panel}
        id={panelId}
        className="nav-disclosure-panel"
        data-expanded={expanded ? "" : undefined}
        onClick={event => {
          if (event.target instanceof Element && event.target.closest("a[href]")) close();
        }}
      >
        {children}
      </div>
    </nav>
  );
}

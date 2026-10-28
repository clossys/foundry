"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NativeAction, SemanticContent } from "@clossys/designer/components/server";
import { FrameRegion } from "./FrameRegion.js";
import { TOKENS } from "../../tokens/tokens.js";
import { buttonLinkClassName } from "../../components/button-classes.js";
import { cx } from "../../components/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../../shell/internal/shell-vars.js";

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
// transition: only the panel and the decorative bars move, through CSS tokens.
const TOGGLE_CLASSES = buttonLinkClassName("ghost", "sm")
  .split(" ")
  .filter(token => !token.includes("transition-"))
  .join(" ") + " bg-transparent active:bg-surface-sunken transition-none";

// A collapsed header expands only with this much width to spare.
const HYSTERESIS = parseFloat(TOKENS["--spacing-sm"]!.value);

// Panel motion must land before paint, but a server render has no layout.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A CSS time such as `240ms` or `.24s`, in milliseconds; 0 when absent or unparseable. */
function milliseconds(time: string): number {
  const value = parseFloat(time);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return time.trim().endsWith("ms") ? value : value * 1000;
}

/**
 * Frame-local composition of the existing shell NavDisclosure behavior with
 * Designer native/semantic primitives; measurement, focus and motion stay shared
 * with that established contract.
 *
 * SiteHeader navigation that becomes a sheet below tablet and an inline row
 * above it. CSS keeps the same links inline when scripting is unavailable.
 * Unlike NavShell, this is a disclosure, without a modal drawer or focus trap.
 */
export function FrameNavDisclosure({ children, "aria-label": ariaLabel = "Primary", triggerLabel = "Menu", trigger = "label", tone, className }: NavDisclosureProps) {
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
    if (restore) toggle.current?.focus();
    // Inert at once, while a closing panel may still be painted.
    if (nav.current?.closest("header")) panel.current?.setAttribute("inert", "");
    setExpanded(false);
  };
  useEffect(() => {
    const media = window.matchMedia?.(`(min-width: ${TOKENS["--breakpoint-tablet"]!.value})`);
    const header = nav.current?.closest<HTMLElement>("[data-header-root]");
    const frame = header?.parentElement;
    const priorClearance = frame?.style.getPropertyValue("--site-header-clearance");
    let disposed = false;
    let pending = 0;
    let wasMobile = true;
    // The first measurement has no layout to hold, so it takes no hysteresis.
    let settled = false;
    // Child rectangles measure occupied content, never an allocated equal grid
    // track. data-measuring lays each region out at its natural, unwrapped width.
    const extent = (element: HTMLElement | null) => {
      const boxes = [...(element?.children ?? [])].map(child => child.getBoundingClientRect()).filter(box => box.width > 0);
      return boxes.length ? Math.max(...boxes.map(box => box.right)) - Math.min(...boxes.map(box => box.left)) : 0;
    };
    const measure = () => {
      pending = 0;
      if (disposed) return;
      let narrow = !media?.matches;
      if (header) {
        header.removeAttribute("data-collapsed");
        header.setAttribute("data-measuring", "");
        const row = header.firstElementChild as HTMLElement;
        const brand = row.querySelector<HTMLElement>(".site-header-brand");
        const actions = row.querySelector<HTMLElement>(".site-header-desktop-actions") ?? row.querySelector<HTMLElement>(".site-header-actions");
        const links = panel.current?.querySelector<HTMLElement>(".site-header-nav-links") ?? panel.current;
        const spacing = getComputedStyle(row);
        const width = row.getBoundingClientRect().width - parseFloat(spacing.paddingInlineStart || "0") - parseFloat(spacing.paddingInlineEnd || "0");
        const gap = parseFloat(spacing.columnGap || "0");
        const required = 2 * Math.max(extent(brand), extent(actions)) + extent(links) + 2 * gap;
        // Hysteresis: a collapsed header expands only with one small spacing
        // step to spare, so widths at the fit edge cannot flap between layouts.
        const slack = settled && wasMobile ? HYSTERESIS : 0;
        settled = true;
        narrow ||= width < required + slack;
        header.removeAttribute("data-measuring");
        header.toggleAttribute("data-collapsed", narrow);
        const height = header.getBoundingClientRect().height;
        if (height > 0) frame?.style.setProperty("--site-header-clearance", `${height}px`);
      }
      const active = document.activeElement;
      const activeActions = active?.closest(".site-header-actions");
      if (!narrow) {
        panel.current?.removeAttribute("inert");
        if (active === toggle.current || (activeActions && getComputedStyle(activeActions).display === "none")) {
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
    // Every trigger in one frame shares one measurement.
    const schedule = () => {
      if (disposed || pending) return;
      if (typeof window.requestAnimationFrame !== "function") { measure(); return; }
      pending = window.requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    const observe = () => {
      observer?.disconnect();
      if (header) { observer?.observe(header); header.querySelectorAll(".site-header-brand > *, .site-header-desktop-actions a, .site-header-actions > *, nav a, img").forEach(node => observer?.observe(node)); }
    };
    const signature = () => JSON.stringify([...(nav.current?.querySelectorAll("a[href]") ?? [])].map(link => [link.getAttribute("href"), link.getAttribute("aria-current"), link.textContent]));
    let content = signature();
    const mutations = new MutationObserver(() => {
      const next = signature();
      if (next !== content) { content = next; close(); }
      schedule(); observe();
    });
    if (nav.current) mutations.observe(nav.current, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "aria-current", "class", "style"] });
    // A late brand image or a direction change also alters natural widths.
    const direction = new MutationObserver(schedule);
    for (let node: HTMLElement | null = header ?? null; node; node = node.parentElement) direction.observe(node, { attributes: true, attributeFilter: ["dir", "lang"] });
    measure(); observe();
    media?.addEventListener("change", schedule);
    window.addEventListener("resize", schedule);
    header?.addEventListener("load", schedule, true);
    document.fonts?.ready.then(schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    return () => {
      disposed = true;
      if (pending) window.cancelAnimationFrame?.(pending);
      observer?.disconnect(); mutations.disconnect(); direction.disconnect();
      media?.removeEventListener("change", schedule); window.removeEventListener("resize", schedule);
      header?.removeEventListener("load", schedule, true);
      document.fonts?.removeEventListener("loadingdone", schedule);
      header?.removeAttribute("data-measuring");
      if (priorClearance) frame?.style.setProperty("--site-header-clearance", priorClearance); else frame?.style.removeProperty("--site-header-clearance");
    };
  }, []);
  // Imperative boolean attributes support React 18 as well as React 19, with
  // no inert server markup to break the no-scripting fallback.
  const motion = useRef<Animation | null>(null);
  const shown = useRef(false);
  useBeforePaint(() => {
    const element = panel.current;
    if (!element) return;
    element.toggleAttribute("inert", mobile && !expanded && Boolean(nav.current?.closest("header")));
    const running = motion.current;
    const changed = shown.current !== expanded;
    shown.current = expanded;
    if (!changed && (mobile || !running)) return;
    motion.current = null;
    // The sheet slides from just under the header and fades, on the panel's
    // motion tokens. data-present keeps a closing sheet painted (but inert)
    // until it has left; reduced motion, a zero duration, an inline desktop
    // row or an engine without element.animate switch at once.
    const style = getComputedStyle(element);
    const duration = milliseconds(style.getPropertyValue("--site-header-panel-duration"));
    const shift = style.getPropertyValue("--site-header-panel-shift").trim();
    const easing = style.getPropertyValue("--site-header-panel-ease").trim();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!changed || !mobile || still || !duration || !shift || typeof element.animate !== "function") {
      running?.cancel();
      element.removeAttribute("data-present");
      return;
    }
    const away = { opacity: "0", transform: `translateY(${shift})` };
    const here = { opacity: "1", transform: "none" };
    // Reverse from where an interrupted animation had reached.
    const from = running ? { opacity: style.opacity, transform: style.transform } : expanded ? away : here;
    running?.cancel();
    element.setAttribute("data-present", "");
    const animation = element.animate([from, expanded ? here : away], { duration, easing: easing || undefined, fill: "both" });
    motion.current = animation;
    const settle = () => {
      if (motion.current !== animation) return;
      motion.current = null;
      element.removeAttribute("data-present");
      animation.cancel();
    };
    animation.finished.then(settle, settle);
  }, [mobile, expanded]);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const stop = () => {
      const animation = motion.current;
      motion.current = null;
      animation?.cancel();
      panel.current?.removeAttribute("data-present");
    };
    const change = () => { if (reduced?.matches) stop(); };
    reduced?.addEventListener?.("change", change);
    return () => { reduced?.removeEventListener?.("change", change); stop(); };
  }, []);
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
    <FrameRegion
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
        <NativeAction
          ref={toggle}
          type="button"
          aria-label={triggerLabel}
          aria-expanded={expanded}
          aria-controls={panelId}
          data-tone={tone}
          className={cx(look, "nav-disclosure-toggle", inverse ? "text-ink-on-inverse hover:text-ink-on-inverse aria-expanded:text-ink-on-inverse focus-visible:text-ink-on-inverse hover:bg-control-tonal-inverse-hover focus-visible:outline-ink-on-inverse" : undefined)}
          style={{ minHeight: UI_LAYOUT_TAP_TARGET, minWidth: UI_LAYOUT_TAP_TARGET }}
          onClick={() => (expanded ? close() : setExpanded(true))}
        >
          <><SemanticContent as="span" className="nav-disclosure-icon" data-open={expanded ? "" : undefined} aria-hidden="true"><SemanticContent as="span" /><SemanticContent as="span" /></SemanticContent></>
        </NativeAction>
      ) : (
        <NativeAction
          ref={toggle}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          data-tone={tone}
          className={cx(look, "nav-disclosure-toggle", inverse ? "text-ink-on-inverse hover:text-ink-on-inverse aria-expanded:text-ink-on-inverse focus-visible:text-ink-on-inverse hover:bg-control-tonal-inverse-hover focus-visible:outline-ink-on-inverse" : undefined)}
          style={{ minHeight: UI_LAYOUT_TAP_TARGET, minWidth: UI_LAYOUT_TAP_TARGET }}
          onClick={() => (expanded ? close() : setExpanded(true))}
        >
          {triggerLabel}
        </NativeAction>
      )}
      <SemanticContent as="div"
        ref={panel}
        id={panelId}
        className="nav-disclosure-panel"
        data-expanded={expanded ? "" : undefined}
        onClick={event => {
          // Following a link moves on from the menu; focus stays with the
          // destination rather than returning to the toggle.
          if (event.target instanceof Element && event.target.closest("a[href]")) close(false);
        }}
      >
        {children}
      </SemanticContent>
    </FrameRegion>
  );
}

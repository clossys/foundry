"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
// transition: only the decorative bars animate, through the shared CSS tokens.
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
    if (restore) toggle.current?.focus();
    panel.current?.toggleAttribute("inert", Boolean(nav.current?.closest("header")));
    setExpanded(false);
  };
  useLayoutEffect(() => {
    const media = window.matchMedia?.(`(min-width: ${TOKENS["--breakpoint-tablet"]!.value})`);
    const header = nav.current?.closest<HTMLElement>("[data-header-root]");
    const frame = header?.parentElement;
    const priorClearance = frame?.style.getPropertyValue("--site-header-clearance");
    let disposed = false, pending = 0;
    let wasMobile: boolean | undefined;
    // Read desktop intrinsics before restoring responsive paint, within one frame.
    const extent = (element: HTMLElement | null) => {
      const boxes = [...(element?.children ?? [])].map(child => child.getBoundingClientRect()).filter(box => box.width > 0);
      return boxes.length ? Math.max(...boxes.map(box => box.right)) - Math.min(...boxes.map(box => box.left)) : 0;
    };
    const measure = () => {
      pending = 0;
      if (disposed) return;
      let narrow = !media?.matches;
      if (header) {
        header.removeAttribute("data-collapsed"); header.setAttribute("data-measuring", "");
        const row = header.firstElementChild as HTMLElement;
        const brand = row.querySelector<HTMLElement>(".site-header-brand");
        const actions = row.querySelector<HTMLElement>(".site-header-desktop-actions") ?? row.querySelector<HTMLElement>(".site-header-actions");
        const links = panel.current?.querySelector<HTMLElement>(".site-header-nav-links") ?? panel.current;
        const spacing = getComputedStyle(row);
        const width = row.getBoundingClientRect().width - parseFloat(spacing.paddingInlineStart || "0") - parseFloat(spacing.paddingInlineEnd || "0");
        const gap = parseFloat(spacing.columnGap || "0");
        const required = 2 * Math.max(extent(brand), extent(actions)) + extent(links) + 2 * gap;
        // One focus-ring width of slack prevents rounding at the fit edge from flapping.
        const slack = wasMobile ? parseFloat(getComputedStyle(header).getPropertyValue("--ui-border-focus")) || 2 : 0;
        narrow ||= width < required + slack;
        header.removeAttribute("data-measuring"); header.toggleAttribute("data-collapsed", narrow);
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
      } else if (wasMobile !== true && active instanceof Node && panel.current?.contains(active)) {
        close(); toggle.current?.focus();
      }
      wasMobile = narrow; setMobile(narrow);
    };
    const schedule = () => { if (!disposed && !pending) pending = window.requestAnimationFrame(measure); };
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
    const owner = header ?? nav.current;
    if (owner) mutations.observe(owner, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "aria-current", "class", "style", "src", "width", "height"] });
    const direction = new MutationObserver(schedule);
    for (let parent: HTMLElement | null = owner ?? null; parent; parent = parent.parentElement) direction.observe(parent, { attributes: true, attributeFilter: ["dir", "lang"] });
    measure(); observe();
    media?.addEventListener("change", schedule); window.addEventListener("resize", schedule);
    owner?.addEventListener("load", schedule, true);
    document.fonts?.ready.then(schedule); document.fonts?.addEventListener("loadingdone", schedule);
    return () => {
      disposed = true; window.cancelAnimationFrame(pending); observer?.disconnect(); mutations.disconnect(); direction.disconnect();
      media?.removeEventListener("change", schedule); window.removeEventListener("resize", schedule);
      owner?.removeEventListener("load", schedule, true); document.fonts?.removeEventListener("loadingdone", schedule);
      header?.removeAttribute("data-measuring");
      if (priorClearance) frame?.style.setProperty("--site-header-clearance", priorClearance); else frame?.style.removeProperty("--site-header-clearance");
    };
  }, []);
  useEffect(() => {
    const header = nav.current?.closest<HTMLElement>('header[data-placement="overlay"]');
    if (!header) return;
    const prior = header.hasAttribute("data-scrolled");
    let pending = 0;
    const measure = () => { pending = 0; header.toggleAttribute("data-scrolled", window.scrollY > 0); };
    const schedule = () => { if (!pending) pending = window.requestAnimationFrame(measure); };
    measure(); window.addEventListener("scroll", schedule, { passive: true });
    return () => { window.cancelAnimationFrame(pending); window.removeEventListener("scroll", schedule); header.toggleAttribute("data-scrolled", prior); };
  }, []);
  const motion = useRef<Animation | null>(null);
  const previousOpen = useRef(false);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const header = nav.current?.closest("header");
    const narrow = header?.hasAttribute("data-header-root") ? header.hasAttribute("data-collapsed") : mobile;
    element.toggleAttribute("inert", narrow && !expanded && Boolean(header));
    const previous = motion.current;
    const style = getComputedStyle(element);
    const from = previous ? { opacity: style.opacity, transform: style.transform } :
      { opacity: previousOpen.current ? "1" : "0", transform: previousOpen.current ? "none" : "translateY(calc(-1 * var(--spacing-sm, 8px)))" };
    const changed = previousOpen.current !== expanded;
    previousOpen.current = expanded; motion.current = null; previous?.cancel();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!narrow || reduced || !element.animate || (!changed && !previous)) { element.removeAttribute("data-present"); return; }
    element.setAttribute("data-present", "");
    const rawDuration = style.getPropertyValue("--site-header-panel-duration").trim() || "240ms";
    const duration = parseFloat(rawDuration) * (rawDuration.endsWith("ms") ? 1 : 1000);
    const animation = element.animate([from, { opacity: expanded ? "1" : "0", transform: expanded ? "none" : "translateY(calc(-1 * var(--spacing-sm, 8px)))" }], {
      duration, easing: style.getPropertyValue("--site-header-panel-ease").trim() || "cubic-bezier(.2, 0, 0, 1)", fill: "both",
    });
    motion.current = animation;
    const finish = () => { if (motion.current !== animation) return; motion.current = null; element.removeAttribute("data-present"); animation.cancel(); };
    void animation.finished.then(finish, finish);
  }, [expanded, mobile]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const cancel = () => { const animation = motion.current; motion.current = null; animation?.cancel(); panel.current?.removeAttribute("data-present"); };
    const change = () => { if (media?.matches) cancel(); };
    media?.addEventListener("change", change);
    return () => { media?.removeEventListener("change", change); cancel(); };
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
          onClick={() => expanded ? close() : setExpanded(true)}
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
          onClick={() => expanded ? close() : setExpanded(true)}
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

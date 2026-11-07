"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TOKENS } from "../tokens/tokens.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/preview-runtime/components/disclosure/collapsible.js";
import { buttonVariants } from "../components/preview-runtime/components/button/button.js";
import { cn } from "../components/preview-runtime/components/_parts/utils/index.js";
import { INVERSE_CONTROL_INK } from "../components/button-classes.js";
import { Icon } from "../components/Icon.js";
import { List } from "../icons/index.js";

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

/**
 * SiteHeader navigation on the stock Collapsible: a disclosure below tablet and
 * an always-expanded inline row above it. The server and first client render
 * are expanded, so the links stay reachable without scripting. Unlike NavShell,
 * this is a disclosure, without a modal drawer or focus trap.
 */
export function NavDisclosure({ children, "aria-label": ariaLabel = "Primary", triggerLabel = "Menu", trigger = "label", tone, className }: NavDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const nav = useRef<HTMLElement>(null);
  // The stock parts take no ref; find them inside this landmark.
  const toggle = { get current() { return nav.current?.querySelector<HTMLButtonElement>(".nav-disclosure-toggle") ?? null; } };
  const panel = { get current() { return nav.current?.querySelector<HTMLDivElement>(".nav-disclosure-panel") ?? null; } };
  // Desktop until measured: the server markup keeps every link reachable.
  const [mobile, setMobile] = useState(false);
  // The stock ghost Button look; on the inverse plate it carries the inverse control ink.
  // An inline desktop row, and the server render, needs no toggle.
  const look = cn(buttonVariants({ variant: "ghost", size: trigger === "icon" ? "icon" : "sm" }), "min-size-tap", tone === "inverse" && [INVERSE_CONTROL_INK, "aria-expanded:text-background"], !mobile && "hidden", "nav-disclosure-toggle");
  const open = useRef(false);
  open.current = expanded;
  const close = (restore = true) => {
    if (!open.current) return;
    if (restore) toggle.current?.focus();
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
        const slack = settled && wasMobile ? parseFloat(TOKENS["--spacing-sm"]!.value) : 0;
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
      onClick={event => {
        // A followed link closes the panel and returns focus to the toggle.
        if (event.target instanceof Element && event.target.closest(".nav-disclosure-panel a[href]")) close();
      }}
    >
      <Collapsible className="contents" isExpanded={expanded || !mobile} onExpandedChange={next => (next ? setExpanded(true) : close())}>
        <CollapsibleTrigger aria-label={trigger === "icon" ? triggerLabel : undefined} data-tone={tone} className={look}>
          {trigger === "icon" ? <Icon glyph={List} decorative /> : triggerLabel}
        </CollapsibleTrigger>
        <CollapsibleContent
          className="nav-disclosure-panel"
          data-expanded={expanded ? "" : undefined}
        >
          {children}
        </CollapsibleContent>
      </Collapsible>
    </nav>
  );
}

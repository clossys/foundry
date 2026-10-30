"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NativeAction, SemanticContent, Icon } from "@clossys/designer/components/server";
import { DialogContext, ModalContext, useLocale } from "react-aria-components";
import { Sheet, SheetClose, SheetTitle } from "../../components/sheet/index.js";
import { X } from "../../icons/index.js";
import { FrameRegion } from "./FrameRegion.js";
import { TOKENS } from "../../tokens/tokens.js";
import { buttonLinkClassName } from "../../components/button-classes.js";
import { cx } from "../../components/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../../shell/internal/shell-vars.js";

export interface NavDisclosureProps {
  /** Navigation links, inline on desktop and inside the mobile Sheet. */
  children: ReactNode;
  /** The same mapped content expanded into the narrow navigation sheet. */
  mobileChildren?: ReactNode;
  minimumBreakpoint?: "tablet" | "tablet-lg";
  /** The Writer-resolved navigation landmark name. */
  "aria-label": string;
  /** Writer-resolved toggle name; also visible with the label trigger. */
  triggerLabel: string;
  /** Writer-resolved close-control name; omitted reuses the toggle name. */
  closeLabel?: string;
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

/**
 * Intrinsically measured header navigation with the registered Sheet on mobile.
 * Sheet owns focus containment, dismissal, restoration and background exclusion.
 * The inline tree remains available to server rendering and no-script layouts.
 */
export function FrameNavDisclosure({ children, mobileChildren, minimumBreakpoint = "tablet", "aria-label": ariaLabel, triggerLabel, closeLabel, trigger = "label", tone, className }: NavDisclosureProps) {
  // Select a complete look before cx: tailwind-merge is an optional peer.
  const inverse = tone === "inverse";
  const look = inverse
    ? TOGGLE_CLASSES.split(" ").filter(token => !["text-ink-primary", "hover:bg-surface-sunken", "focus-visible:outline-accent"].includes(token)).join(" ")
    : TOGGLE_CLASSES;
  const { locale, direction } = useLocale();
  const panelId = useId();
  const sheetId = `${panelId}-sheet`;
  const toggle = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(true);
  const desktopFocus = useRef<HTMLElement | null>(null);
  const open = useRef(false);
  open.current = expanded;
  const close = () => setExpanded(false);
  useEffect(() => {
    const minWidth = minimumBreakpoint === "tablet-lg" ? TOKENS["--breakpoint-tablet-lg"]!.value : TOKENS["--breakpoint-tablet"]!.value;
    const media = window.matchMedia?.(`(min-width: ${minWidth})`);
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
        if (open.current || active === toggle.current || (activeActions && getComputedStyle(activeActions).display === "none")) {
          const anchors = [...(nav.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])];
          const target = anchors.find(link => active instanceof HTMLAnchorElement && link.href === active.href) ?? anchors[0] ?? header?.querySelector<HTMLElement>(".site-header-brand a");
          desktopFocus.current = target ?? null;
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
  }, [minimumBreakpoint]);
  // Keep the hidden desktop duplicate outside the mobile keyboard order.
  // Imperative inert supports React 18 and preserves the no-script SSR tree.
  useBeforePaint(() => {
    panel.current?.toggleAttribute("inert", mobile);
  }, [mobile]);
  useEffect(() => {
    const target = desktopFocus.current;
    if (mobile || expanded || !target) return;
    desktopFocus.current = null;
    // Run after Sheet's own restoration when its trigger becomes hidden.
    const pending = window.requestAnimationFrame(() => target.focus());
    return () => window.cancelAnimationFrame(pending);
  }, [mobile, expanded]);
  useEffect(() => {
    window.addEventListener("popstate", close);
    window.addEventListener("hashchange", close);
    return () => {
      window.removeEventListener("popstate", close);
      window.removeEventListener("hashchange", close);
    };
  }, []);


  return (
    <FrameRegion
      ref={nav}
      aria-label={ariaLabel}
      className={className}
    >
      {trigger === "icon" ? (
        <NativeAction
          ref={toggle}
          type="button"
          aria-label={triggerLabel}
          aria-expanded={expanded}
          aria-controls={sheetId}
          aria-haspopup="dialog"
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
          aria-controls={sheetId}
          aria-haspopup="dialog"
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
        className="nav-disclosure-panel site-header-nav-inline"
        onClickCapture={event => {
          if (event.target instanceof Element && event.target.closest("a[href]")) close();
        }}
      >
        {children}
      </SemanticContent>
      <ModalContext.Provider value={{ dir: direction, lang: locale }}>
      <DialogContext.Provider value={{ id: sheetId }}>
      <Sheet
        isOpen={mobile && expanded}
        onOpenChange={setExpanded}
        showCloseButton={false}
        side="right"
        className="site-header-nav-sheet motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0"
      >
        <SemanticContent as="div" className="site-header-nav-sheet-content">
          <SheetTitle className="sr-only">{ariaLabel}</SheetTitle>
          <SheetClose variant="ghost" size="icon" aria-label={closeLabel ?? triggerLabel} className="site-header-nav-sheet-close">
            <Icon glyph={X} decorative />
          </SheetClose>
          <FrameRegion aria-label={ariaLabel} onClickCapture={event => {
            if (event.target instanceof Element && event.target.closest("a[href]")) close();
          }}>
            {mobileChildren ?? children}
          </FrameRegion>
        </SemanticContent>
      </Sheet>
      </DialogContext.Provider>
      </ModalContext.Provider>
    </FrameRegion>
  );
}

"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SemanticContent, Icon } from "@clossys/designer/components/server";
import { Sheet, SheetClose, SheetTitle } from "../../components/sheet/index.js";
import { DialogTarget, useOverlayLocale } from "../../components/Dialog.js";
import { List, X } from "../../icons/index.js";
import { FrameRegion } from "./FrameRegion.js";
import { TOKENS } from "../../tokens/tokens.js";
import { INVERSE_CONTROL_INK } from "../../components/button-classes.js";
import { cn } from "../../components/preview-runtime/components/_parts/utils/index.js";
import { componentLeaf, type ButtonLeaf } from "../../runtime/component-leaf.js";
import { SECTION_REVEAL_ATTRIBUTE, SectionRevealStyle } from "../../styles/section-reveal.js";

export interface NavDisclosureProps {
  /** Navigation links, inline on desktop and inside the mobile Sheet. */
  children: ReactNode;
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

/** The selected stock Button; the server shape renders the same leaf, so hydration agrees. */
const Button = componentLeaf<ButtonLeaf>("components.button");

/** The toggle's classes beside the stock ghost look; the server shape renders the base tone. */
function navToggleClassName(tone?: "auto" | "inverse"): string {
  return cn("min-size-tap", tone === "inverse" && [INVERSE_CONTROL_INK, "aria-expanded:text-background"], "nav-disclosure-toggle");
}

// Panel inertness must land before paint, but a server render has no layout.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Intrinsically measured header navigation with the registered Sheet on mobile.
 * Sheet owns focus containment, dismissal, restoration and background exclusion.
 * The inline tree remains available to server rendering and no-script layouts.
 */
export function FrameNavDisclosure({ children, "aria-label": ariaLabel, triggerLabel, closeLabel, trigger = "label", tone, className }: NavDisclosureProps) {
  const { locale, direction } = useOverlayLocale();
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
  }, []);
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
      <Button
        ref={toggle}
        variant="ghost"
        size="sm"
        aria-label={trigger === "icon" ? triggerLabel : undefined}
        aria-expanded={expanded}
        aria-controls={sheetId}
        aria-haspopup="dialog"
        data-tone={tone}
        className={navToggleClassName(tone)}
        onPress={() => (expanded ? close() : setExpanded(true))}
      >
        {trigger === "icon" ? <Icon glyph={List} decorative /> : triggerLabel}
      </Button>
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
      <DialogTarget id={sheetId} dir={direction} lang={locale}>
      <Sheet
        isOpen={mobile && expanded}
        onOpenChange={setExpanded}
        showCloseButton={false}
        side="right"
        className="site-header-nav-sheet motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0"
      >
        <SemanticContent as="div" {...{ [SECTION_REVEAL_ATTRIBUTE]: "" }} className="site-header-nav-sheet-content">
          <SectionRevealStyle />
          <SheetTitle className="sr-only">{ariaLabel}</SheetTitle>
          <SheetClose variant="ghost" size="icon" aria-label={closeLabel ?? triggerLabel} className="site-header-nav-sheet-close">
            <Icon glyph={X} decorative />
          </SheetClose>
          <FrameRegion aria-label={ariaLabel} onClickCapture={event => {
            if (event.target instanceof Element && event.target.closest("a[href]")) close();
          }}>
            {children}
          </FrameRegion>
        </SemanticContent>
      </Sheet>
      </DialogTarget>
    </FrameRegion>
  );
}

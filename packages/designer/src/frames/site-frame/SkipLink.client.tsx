"use client";

import * as React from "react";
import { SkipLink } from "@clossys/designer/shell/server";

const GROUND_SELECTOR = '[data-ground="light"], [data-ground="dark"], [data-landing-ground]';

/**
 * Client island around Designer's `SkipLink`, whose click handler moves focus
 * to the target. Under React Server Components a server-rendered frame cannot
 * hand a function to a DOM element, so the handler lives here and the frame
 * passes resolved data. The private header flag enables ground observation
 * for SiteFrame without adding another client module or changing skip markup.
 */
export function SiteSkipLink({ targetId, label, followHeaderGround = false }: { readonly targetId: string; readonly label: string; readonly followHeaderGround?: boolean }) {
  // This private island already belongs to the frame. It adds no wrapper or
  // client boundary, and reserved frames retain the ordinary skip link alone.
  React.useEffect(() => {
    if (!followHeaderGround) return;
    const main = document.getElementById(targetId);
    const frame = main?.closest<HTMLElement>("[data-frame-root]");
    const header = frame?.querySelector<HTMLElement>('header[data-placement="overlay"]');
    if (!main || !frame || !header) return;
    const prefersDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
    let disposed = false;
    let pending: number | undefined;
    const useAnimationFrame = typeof requestAnimationFrame === "function";

    const updateTone = () => {
      pending = undefined;
      if (disposed || !header.isConnected || header.getAttribute("data-placement") !== "overlay") return;
      const bounds = header.getBoundingClientRect();
      // An unpainted header has no ground to sample. Keep its server hint
      // until ResizeObserver reports that it has a measurable box.
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const x = (bounds.left + bounds.right) / 2;
      const y = bounds.bottom - Math.min(1, bounds.height / 2);
      const theme = document.documentElement.getAttribute("data-theme");
      const dark = theme === "dark" || (theme !== "light" && prefersDark?.matches === true);
      let tone: "base" | "inverse" = "base";
      for (const section of main.querySelectorAll<HTMLElement>(GROUND_SELECTOR)) {
        const rect = section.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
        const physical = section.getAttribute("data-ground");
        const relative = section.getAttribute("data-landing-ground");
        // DOM order visits an enclosing ground before its nested grounds.
        // Physical light/dark stays literal; shipped LandingView grounds
        // already express polarity relative to the page's token register.
        if (physical === "light" || physical === "dark") tone = (physical === "dark") === dark ? "base" : "inverse";
        else if (relative === "inverse") tone = "inverse";
        else if (relative === "base" || relative === "sunken") tone = "base";
      }
      if (header.getAttribute("data-tone") !== tone) header.setAttribute("data-tone", tone);
    };
    const schedule = () => {
      if (disposed || pending !== undefined) return;
      pending = useAnimationFrame ? requestAnimationFrame(updateTone) : window.setTimeout(updateTone, 0);
    };
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : undefined;
    const observed = new Set<Element>();
    const refreshObserved = () => {
      if (disposed || !resize) return;
      const next = new Set<Element>([frame, main, header, ...main.querySelectorAll(GROUND_SELECTOR)]);
      for (const element of observed) if (!next.has(element)) { resize.unobserve(element); observed.delete(element); }
      for (const element of next) if (!observed.has(element)) { resize.observe(element); observed.add(element); }
    };
    updateTone();
    refreshObserved();
    const themeChanges = typeof MutationObserver === "function" ? new MutationObserver(schedule) : undefined;
    themeChanges?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const contentChanges = typeof MutationObserver === "function" ? new MutationObserver(() => { refreshObserved(); schedule(); }) : undefined;
    contentChanges?.observe(frame, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-ground", "data-landing-ground", "data-placement", "data-tone"] });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    prefersDark?.addEventListener?.("change", schedule);
    return () => {
      disposed = true;
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      prefersDark?.removeEventListener?.("change", schedule);
      themeChanges?.disconnect();
      contentChanges?.disconnect();
      resize?.disconnect();
      if (pending !== undefined) {
        if (useAnimationFrame) cancelAnimationFrame(pending);
        else window.clearTimeout(pending);
      }
    };
  }, [targetId, followHeaderGround]);
  return <SkipLink targetId={targetId}>{label}</SkipLink>;
}

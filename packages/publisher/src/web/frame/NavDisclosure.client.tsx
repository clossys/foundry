"use client";

import { useEffect, useRef } from "react";
import { NavDisclosure } from "@clossys/designer/shell";
import { NavLinks } from "./NavLinks.js";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";

/** The frame resolves copy and links on the server; Designer owns disclosure interaction. */
export function SiteNavDisclosure({ nav, actions, surfaceLabel, header, artwork }: { readonly nav?: ResolvedSiteShell["nav"]; readonly actions?: ResolvedSiteShell["actions"]; readonly surfaceLabel?: string; readonly header?: ResolvedSiteShell["header"]; readonly artwork?: ResolvedSiteShell["brand"]["artwork"] }) {
  const marker = useRef<HTMLSpanElement>(null);
  const ground = header?.placement === "overlay" ? header.sectionGround : undefined;
  useEffect(() => {
    const banner = marker.current?.closest("header");
    const main = banner?.parentElement?.querySelector(":scope > main");
    if (!banner || !main) return;
    const image = banner.querySelector<HTMLImageElement>(".site-header-brand img");
    const prior = ["data-scrolled", "data-section-ground", "data-tone"].map(key => [key, banner.getAttribute(key)] as const);
    const priorSrc = image?.getAttribute("src");
    const sections = new Map(ground?.sections.map(section => [section.id, section.ground]) ?? []);
    let pending = 0;
    let disposed = false;
    const measure = () => {
      pending = 0;
      if (disposed) return;
      banner.toggleAttribute("data-scrolled", window.scrollY > 0);
      if (!ground || !artwork) return;
      const edge = banner.getBoundingClientRect().bottom;
      let current = ground.initial;
      let nearest = -Infinity;
      // Match explicit IDs inside this frame only; no selector interpolation or pixel sampling.
      for (const element of main.querySelectorAll<HTMLElement>("[id]")) {
        const declared = sections.get(element.id);
        if (!declared) continue;
        const top = element.getBoundingClientRect().top;
        if (top <= edge && top >= nearest) { nearest = top; current = declared; }
      }
      banner.setAttribute("data-section-ground", current);
      banner.setAttribute("data-tone", current === "dark" ? "inverse" : "base");
      const src = current === "light" ? artwork.onLight : artwork.onDark;
      if (image && image.getAttribute("src") !== src) image.setAttribute("src", src);
    };
    const schedule = () => { if (!pending && !disposed) pending = window.requestAnimationFrame(measure); };
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resize?.observe(banner); resize?.observe(main);
    const mutations = new MutationObserver(schedule);
    mutations.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["id"] });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule);
    measure();
    return () => {
      disposed = true; window.cancelAnimationFrame(pending); resize?.disconnect(); mutations.disconnect();
      window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule);
      for (const [key, value] of prior) { if (value === null) banner.removeAttribute(key); else banner.setAttribute(key, value); }
      if (image && priorSrc !== undefined && priorSrc !== null) image.setAttribute("src", priorSrc);
    };
  }, [ground, artwork, header?.placement]);
  const navigation = nav ? <NavDisclosure aria-label={nav.label} triggerLabel={nav.triggerLabel} trigger={nav.trigger} tone={nav.tone}>
    <NavLinks links={nav.links} actions={actions} surfaceLabel={surfaceLabel} />
  </NavDisclosure> : null;
  return header?.placement === "overlay" ? <><span hidden ref={marker} data-header-observer="" />{navigation}</> : navigation;
}

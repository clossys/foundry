"use client";

import { useEffect, useRef } from "react";
import { Banner, type BannerProps } from "../components/Banner.js";
import { Link } from "../components/Link.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { FrameRegion } from "../frames/site-frame/FrameRegion.js";

export interface SiteLocaleLink {
  readonly href: string;
  readonly label: string;
  readonly locale: string;
  readonly isCurrent?: boolean;
}

/** Route alternates are supplied by the host's checked content-map projection. */
export function SiteLocaleLinks({ label, links }: { readonly label: string; readonly links: readonly SiteLocaleLink[] }) {
  if (links.length <= 1) return null;
  if (!label.trim() || new Set(links.map(link => link.locale)).size !== links.length
    || links.filter(link => link.isCurrent).length !== 1) throw new TypeError("Locale links require one current locale and unique alternatives");
  for (const link of links) {
    if (!link.label.trim() || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(link.locale)
      || !/^\/(?!\/)[^\s\\]*$/.test(link.href) || /[\u0000-\u001f\u007f]/.test(link.href)) {
      throw new TypeError("Locale links require named locales and local route paths");
    }
  }
  return <FrameRegion aria-label={label} className="flex flex-wrap items-center gap-sm">
    {links.map(link => <Link key={link.locale} variant="standalone" href={link.href} hrefLang={link.locale}
      lang={link.locale} aria-current={link.isCurrent ? "page" : undefined}>{link.label}</Link>)}
  </FrameRegion>;
}

export interface SiteAnnouncementProps extends Pick<BannerProps, "children" | "onDismiss" | "dismissLabel" | "variant"> {
  readonly dismissed?: boolean;
}

/** Visibility is controlled by the host. The frame never stores dismissal. */
export function SiteAnnouncement({ dismissed, children, ...props }: SiteAnnouncementProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current, frame = element?.parentElement;
    if (!element || !frame) return;
    const previous = frame.style.getPropertyValue("--site-announcement-height");
    const update = () => frame.style.setProperty("--site-announcement-height", `${element.getBoundingClientRect().height}px`);
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    return () => { observer?.disconnect(); if (previous) frame.style.setProperty("--site-announcement-height", previous); else frame.style.removeProperty("--site-announcement-height"); };
  }, [dismissed]);
  return dismissed ? null : <SemanticContent as="div" ref={root} data-site-announcement=""><Banner {...props}>{children}</Banner></SemanticContent>;
}

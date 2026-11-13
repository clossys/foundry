import type { MouseEvent } from "react";
export type FrameNavigate = (href: string) => void | Promise<void>;

/** Delegate only an ordinary self-target link activation; the host may flush before navigating. */
export function frameLinkNavigation(event: MouseEvent<Element>, onNavigate?: FrameNavigate) {
  if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
  if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
  const href = link.getAttribute("href");
  if (!href) return;
  event.preventDefault();
  // A rejected host flush keeps this page mounted; it never becomes an unhandled rejection or native navigation.
  void Promise.resolve().then(() => onNavigate(href)).catch(() => {});
}

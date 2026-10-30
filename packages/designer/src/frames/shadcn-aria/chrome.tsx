import { createElement, useEffect, type RefObject } from "react";
import animation from "../../catalog/fills/foundry/tokens.animation.json" with { type: "json" };

export const CHROME_ANIMATION_MEMBER = "tokens.animation.reveal";
export const CHROME_ANIMATION_FALLBACK = animation.tokens.animation.reveal.$value;

/** A registered animation shorthand owns both transition values; no parallel timing scale. */
export function chromeAnimation(value: string) {
  const duration = /(?:^|\s)(\d+(?:\.\d+)?m?s)(?:\s|$)/.exec(value)?.[1];
  const easing = /cubic-bezier\([^)]*\)|steps\([^)]*\)|\b(?:ease-in-out|ease-in|ease-out|ease|linear)\b/.exec(value)?.[0];
  if (!duration || !easing) throw new TypeError("AppFrame requires a duration and easing in its animation token");
  return { duration, easing };
}
const motion = chromeAnimation(CHROME_ANIMATION_FALLBACK);
export const APP_FRAME_CHROME_CSS = `
[data-app-frame-chrome] { --frame-motion-duration:${motion.duration}; --frame-motion-easing:${motion.easing}; --frame-module-width:var(--ui-layout-sidebar-w); }
[data-app-frame-chrome] [data-slot="sidebar-gap"] { transition-property:width; transition-duration:var(--frame-motion-duration); transition-timing-function:var(--frame-motion-easing); }
[data-app-frame-chrome] [data-slot="sidebar-container"] { width:var(--ui-layout-sidebar-w); transition-property:transform; transition-duration:var(--frame-motion-duration); transition-timing-function:var(--frame-motion-easing); transform:translateX(0); }
[data-app-frame-chrome] [data-state="collapsed"] [data-slot="sidebar-container"] { transform:translateX(calc(var(--ui-layout-sidebar-rail-w) - var(--ui-layout-sidebar-w))); pointer-events:none; }
[data-app-frame-chrome][dir="rtl"] [data-state="collapsed"] [data-slot="sidebar-container"] { transform:translateX(calc(var(--ui-layout-sidebar-w) - var(--ui-layout-sidebar-rail-w))); }
[data-app-frame-chrome] .frame-docked-navigation, [data-app-frame-chrome] .frame-docked-panel, [data-app-frame-page], [data-page-frame-header], [data-page-frame-stage], [data-page-frame-modules] { transition-property:width,inline-size,margin-inline-start,padding-inline-start,grid-template-columns; transition-duration:var(--frame-motion-duration); transition-timing-function:var(--frame-motion-easing); }
.frame-page { display:flex; flex-direction:column; min-width:0; min-height:0; flex:1; }
.frame-page-header { display:flex; align-items:center; justify-content:space-between; gap:var(--spacing-md); min-width:0; min-height:var(--ui-layout-tap-target); padding:var(--spacing-sm) calc(var(--ui-layout-tap-target) + var(--spacing-md)); border-block-end:var(--ui-border-hairline) solid var(--color-line-base); }
[data-app-frame-has-panel="false"] .frame-page-header { padding-inline-end:var(--spacing-md); }
.frame-page-layout { display:flex; min-height:0; min-width:0; flex:1; }
.frame-page-stage { min-width:0; min-height:0; flex:1; overflow:auto; }
.frame-page-modules { display:flex; flex-direction:column; gap:var(--spacing-sm); flex:0 0 var(--frame-module-width); min-height:0; overflow:auto; padding:var(--spacing-sm); border-inline-start:var(--ui-border-hairline) solid var(--color-line-base); }
@media (prefers-reduced-motion:reduce) {
 [data-app-frame-chrome] { --frame-motion-duration:0ms !important; }
 [data-app-frame-chrome] [data-slot="sidebar-gap"], [data-app-frame-chrome] [data-slot="sidebar-container"], [data-app-frame-chrome] .frame-docked-navigation, [data-app-frame-chrome] .frame-docked-panel, [data-app-frame-page], [data-page-frame-header], [data-page-frame-stage], [data-page-frame-modules] { transition-duration:0ms !important; animation-duration:0ms !important; }
}
`;

export function AppFrameChromeStyle() { return createElement("style", { "data-app-frame-motion": "" }, APP_FRAME_CHROME_CSS); }

/** Consumer-emitted animation values win; the pinned registry value is the default fill. */
export function useAppFrameChromeMotion(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const sync = () => {
      const element = ref.current; if (!element) return;
      const styles = getComputedStyle(element);
      const raw = styles.getPropertyValue("--animate-reveal").trim() || styles.getPropertyValue("--animation-reveal").trim() || CHROME_ANIMATION_FALLBACK;
      const resolved = chromeAnimation(raw);
      element.style.setProperty("--frame-motion-duration", resolved.duration);
      element.style.setProperty("--frame-motion-easing", resolved.easing);
      element.style.setProperty("--frame-motion-source", raw);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    return () => observer.disconnect();
  }, [ref]);
}

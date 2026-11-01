import { useCallback, useEffect, useRef, useState } from "react";

const SPY_OFFSET = 96;

const mainColumn = () => document.getElementById('studio-main');
const target = (selector: string) => {
  try { return mainColumn()?.querySelector<HTMLElement>(selector) ?? null; } catch { return null; }
};
/** The scroll-spy over the open popover's targets: the part at the top of the page column is active. */
export function useStudioFrameScrollSpy(targets: readonly string[]) {
  const [active, setActive] = useState<string | undefined>(undefined);
  const chosen = useRef<string | undefined>(undefined);
  const spy = useCallback(() => {
    const main = mainColumn();
    if (!main) return;
    // A part chosen in a popover stays highlighted while it is in view (a short part, or one at
    // the end of the column, may never reach the top).
    const bounds = main.getBoundingClientRect();
    const kept = chosen.current ? target(chosen.current)?.getBoundingClientRect() : undefined;
    if (kept && kept.top < bounds.bottom && kept.bottom > bounds.top) { setActive(chosen.current); return; }
    chosen.current = undefined;
    const top = bounds.top + SPY_OFFSET;
    let current: string | undefined;
    for (const selector of targets) { const element = target(selector); if (element && element.getBoundingClientRect().top <= top) current = selector; }
    setActive(current ?? targets.find(selector => target(selector)));
  }, [targets]);
  useEffect(() => {
    const main = mainColumn();
    if (!main || !targets.length) return;
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(spy); };
    onScroll();
    main.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(frame); main.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [targets, spy]);
  const select = useCallback((selector: string) => {
    const element = target(selector);
    const main = mainColumn();
    if (!element || !main) return;
    chosen.current = selector;
    // Scroll the page column only: scrolling an ancestor of the header would close the popover.
    main.scrollTo({ top: main.scrollTop + element.getBoundingClientRect().top - main.getBoundingClientRect().top });
    setActive(selector);
  }, []);
  return { active, select };
}


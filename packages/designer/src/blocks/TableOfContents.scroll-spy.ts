import { useEffect, useRef, useState } from "react";

/** Shared observer policy for the outline and the chunk host; no wheel or pointer engine. */
export const HEADING_ROOT_MARGIN = "0px 0px -70% 0px";
export interface HeadingScrollSpyOptions {
  readonly enabled?: boolean;
  readonly root?: Element | null;
  readonly onChange?: (id: string) => void;
}

/** The first intersecting heading in document order wins; retain the previous one between headings. */
export function useHeadingScrollSpy(ids: readonly string[], options: HeadingScrollSpyOptions = {}): string | undefined {
  const [current, setCurrent] = useState<string>();
  const active = useRef<string | undefined>(undefined);
  const notify = useRef(options.onChange); notify.current = options.onChange;
  const key = ids.join("\n");
  useEffect(() => {
    if (options.enabled === false || typeof IntersectionObserver === "undefined") return;
    const order = key ? key.split("\n") : [], visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const first = order.find(id => visible.has(id));
      if (first !== undefined && active.current !== first) {
        active.current = first; setCurrent(first); notify.current?.(first);
      }
    }, { root: options.root, rootMargin: HEADING_ROOT_MARGIN });
    const observed = new Set<Element>();
    const observe = () => {
      for (const id of order) {
        const target = document.getElementById(id);
        if (target && !observed.has(target)) { observed.add(target); observer.observe(target); }
      }
    };
    observe();
    // Lazy chunks introduce headings after the observer starts.
    const mutations = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(observe);
    mutations?.observe(options.root ?? document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); mutations?.disconnect(); };
  }, [key, options.enabled, options.root]);
  return current;
}

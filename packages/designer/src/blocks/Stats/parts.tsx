"use client";

import * as React from "react";
import { componentLeaf } from "../../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** The authored final value stays in server HTML and in the accessibility tree. */
export function StatsCount({ finalValue, to, format }: { finalValue: React.ReactNode; to?: number; format?: (value: number) => React.ReactNode }) {
  const root = React.useRef<HTMLSpanElement>(null);
  const counted = React.useRef(false);
  const [value, setValue] = React.useState<number | null>(null);
  React.useEffect(() => {
    setValue(null);
    const node = root.current;
    if (!node || to === undefined || typeof matchMedia !== "function" || typeof IntersectionObserver === "undefined" || typeof requestAnimationFrame !== "function") return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let stopped = preference.matches;
    const observer = new IntersectionObserver(entries => {
      if (stopped || counted.current || !entries.some(entry => entry.target === node && entry.isIntersecting)) return;
      counted.current = true;
      observer.disconnect();
      const rawDuration = getComputedStyle(node).getPropertyValue("--ui-duration-default").trim();
      const parsed = Number.parseFloat(rawDuration);
      const duration = parsed * (rawDuration.endsWith("ms") ? 1 : 1000);
      // Missing or zero duration is a static presentation, never an invented animation tier.
      if (!Number.isFinite(duration) || duration <= 0) return;
      let start: number | undefined;
      setValue(0);
      const tick = (now: number) => {
        if (stopped) return;
        start ??= now;
        const progress = Math.min((now - start) / duration, 1);
        if (progress === 1) { setValue(null); return; }
        setValue(to * progress);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    const stop = () => {
      if (!preference.matches) return;
      stopped = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      setValue(null);
    };
    if (!stopped && !counted.current) observer.observe(node);
    preference.addEventListener("change", stop);
    return () => { stopped = true; observer.disconnect(); cancelAnimationFrame(frame); preference.removeEventListener("change", stop); };
  }, [to]);
  if (to !== undefined && !Number.isFinite(to)) throw new TypeError("Stats count requires a finite target");
  return <SemanticContent as="span" ref={root} data-stats-count="">
    <SemanticContent as="span" className={value === null ? undefined : "sr-only"}>{finalValue}</SemanticContent>
    {value === null ? null : <SemanticContent as="span" aria-hidden="true">{format ? format(value) : Math.round(value)}</SemanticContent>}
  </SemanticContent>;
}

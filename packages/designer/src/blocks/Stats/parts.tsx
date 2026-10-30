"use client";

import * as React from "react";
import { SemanticContent } from "../../components/SemanticContent.js";
import { proofAnimationTiming, useReducedProofMotion } from "../LogoCloud/motion.js";

/** Final authored content is the server HTML and the permanent accessible value. */
export function StatsCount({ finalValue, to, format }: { finalValue: React.ReactNode; to?: number; format?: (value: number) => React.ReactNode }) {
  const reduced = useReducedProofMotion();
  const root = React.useRef<HTMLSpanElement>(null);
  const counted = React.useRef(false);
  const [value, setValue] = React.useState<number | null>(null);
  React.useEffect(() => {
    const node = root.current;
    if (reduced || !node || to === undefined || typeof IntersectionObserver === "undefined" || typeof requestAnimationFrame !== "function") { setValue(null); return; }
    if (counted.current) return;
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      if (counted.current || !entries.some(entry => entry.target === node && entry.isIntersecting)) return;
      counted.current = true;
      observer.disconnect();
      const { duration } = proofAnimationTiming(node, "count");
      let start: number | undefined;
      setValue(0);
      function tick(now: number) {
        start ??= now;
        const progress = Math.min((now - start) / duration, 1);
        if (progress === 1) { setValue(null); return; }
        setValue(to! * progress);
        frame = requestAnimationFrame(tick);
      }
      frame = requestAnimationFrame(tick);
    });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [reduced, to]);
  if (to !== undefined && !Number.isFinite(to)) throw new TypeError("Stats count requires a finite target");
  return <SemanticContent as="span" ref={root} data-stats-count="">
    <SemanticContent as="span" className={value === null ? undefined : "sr-only"}>{finalValue}</SemanticContent>
    {value === null ? null : <SemanticContent as="span" aria-hidden="true">{format ? format(value) : Math.round(value)}</SemanticContent>}
  </SemanticContent>;
}

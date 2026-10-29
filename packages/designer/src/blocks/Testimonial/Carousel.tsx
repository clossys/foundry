"use client";

import * as React from "react";
import { ScrollArea } from "../../components/scroll-area/index.js";
import { NativeAction } from "../../components/NativeAction.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";
import { useReducedProofMotion } from "../LogoCloud/motion.js";

export interface TestimonialCarouselLabels { previous: string; next: string }

/** Manual scroll-snap navigation; the track never advances by itself. */
export function TestimonialCarousel({ children, labels, rootProps, className, style }: { children: React.ReactNode; labels: TestimonialCarouselLabels; rootProps?: React.HTMLAttributes<HTMLElement>; className?: string; style?: React.CSSProperties }) {
  const reduced = useReducedProofMotion();
  const track = React.useRef<HTMLDivElement>(null);
  function move(direction: number) {
    const node = track.current;
    if (node) node.scrollBy({ left: direction * node.clientWidth, behavior: reduced ? "instant" : "smooth" });
  }
  return <SemanticContent as="div" {...rootProps} data-layout="carousel" data-testimonial-carousel="" className={cx("flex min-w-0 flex-col gap-md", className)} style={style}>
    <ScrollArea ref={track} data-testimonial-track="" className="snap-x snap-mandatory">{children}</ScrollArea>
    <SemanticContent as="div" className="flex gap-sm">
      <NativeAction type="button" onClick={() => move(-1)}>{labels.previous}</NativeAction>
      <NativeAction type="button" onClick={() => move(1)}>{labels.next}</NativeAction>
    </SemanticContent>
  </SemanticContent>;
}

"use client";

import * as React from "react";
import { NativeAction } from "../../components/NativeAction.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";
import { proofAnimationTiming, useReducedProofMotion } from "./motion.js";

export interface LogoCloudMotionLabels { pause: string; resume: string }

/** A static grid is the complete reduced-motion and server-rendered presentation. */
export function LogoCloudMarquee({ grid, track, duplicate, labels, className, style, rootProps }: {
  grid: React.ReactNode; track: React.ReactNode; duplicate: React.ReactNode; labels: LogoCloudMotionLabels;
  className?: string; style?: React.CSSProperties;
  rootProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const reduced = useReducedProofMotion();
  const moving = React.useRef<HTMLDivElement>(null);
  const animation = React.useRef<Animation | null>(null);
  const [paused, setPaused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    const node = moving.current;
    if (!node || typeof node.animate !== "function") return;
    const running = node.animate([{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }], { ...proofAnimationTiming(node, "marquee"), iterations: Infinity });
    animation.current = running;
    return () => { running.cancel(); animation.current = null; };
  }, [reduced]);
  React.useEffect(() => {
    if (paused || hovered || focused) animation.current?.pause();
    else animation.current?.play();
  }, [paused, hovered, focused, reduced]);
  if (reduced) return <>{grid}</>;
  return <SemanticContent as="div" {...rootProps} data-logo-cloud-motion="marquee" className={cx("flex flex-col gap-md", className)} style={style}
    onMouseEnter={event => { rootProps?.onMouseEnter?.(event); setHovered(true); }} onMouseLeave={event => { rootProps?.onMouseLeave?.(event); setHovered(false); }}
    onFocusCapture={event => { rootProps?.onFocusCapture?.(event); setFocused(true); }} onBlurCapture={event => { rootProps?.onBlurCapture?.(event); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <SemanticContent as="div" className="overflow-hidden">
      <SemanticContent as="div" ref={moving} data-logo-cloud-track="" className="flex w-max">{track}{duplicate}</SemanticContent>
    </SemanticContent>
    <NativeAction type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? labels.resume : labels.pause}</NativeAction>
  </SemanticContent>;
}

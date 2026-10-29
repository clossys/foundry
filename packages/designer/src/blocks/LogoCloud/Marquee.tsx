"use client";

import * as React from "react";
import { NativeAction } from "../../components/NativeAction.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { proofAnimationTiming, useReducedProofMotion } from "./motion.js";

export interface LogoCloudMotionLabels { pause: string; resume: string }

/** A static grid is the complete reduced-motion and server-rendered presentation. */
export function LogoCloudMarquee({ grid, track, duplicate, labels }: {
  grid: React.ReactNode; track: React.ReactNode; duplicate: React.ReactNode; labels: LogoCloudMotionLabels;
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
  return <SemanticContent as="div" data-logo-cloud-motion="marquee" className="flex flex-col gap-md"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <SemanticContent as="div" className="overflow-hidden">
      <SemanticContent as="div" ref={moving} data-logo-cloud-track="" className="flex w-max">{track}{duplicate}</SemanticContent>
    </SemanticContent>
    <NativeAction type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? labels.resume : labels.pause}</NativeAction>
  </SemanticContent>;
}

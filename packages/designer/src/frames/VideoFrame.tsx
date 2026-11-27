import { useEffect, useState, type ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { GROUND_PAINT } from "../components/ground-paint.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Button = componentLeaf<import("../runtime/component-leaf.js").ButtonLeaf>("components.button");
const Slider = componentLeaf<typeof import("../components/preview-runtime/components/slider/slider.js").Slider<number>>("components.slider");

/** DOM provenance (WIRE-3 D1): this frame root stamps its leaf and fill. */
const FRAME_STAMP = dsAttrs("frames", "frames.video", "foundry/frames.video");

export interface VideoFrameProps {
  /** Ordered scene sections; the stage holds exactly one at a time. */
  scenes: readonly ReactNode[];
  /** Writer-owned copy: the controls region name, the play and pause actions and the scrubber name. */
  labels: { readonly controls: string; readonly play: string; readonly pause: string; readonly scrubber: string };
  /** Milliseconds each scene holds while playing. */
  sceneDuration: number;
  /** Controlled playing state; omit to let the frame own it. It always starts paused. */
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  /** Controlled zero-based scene index; omit to let the frame own it. */
  scene?: number;
  defaultScene?: number;
  onSceneChange?: (scene: number) => void;
  className?: string;
}

/**
 * A 16:9 stage holding one scene section, with a named controls region built from the stock
 * Button (play/pause) and Slider (scene scrubber) plus the scene count. It starts paused, so
 * nothing moves until the viewer asks; playing advances one scene per `sceneDuration`.
 */
export function VideoFrame({ scenes, labels, sceneDuration, playing, onPlayingChange, scene, defaultScene = 0, onSceneChange, className }: VideoFrameProps) {
  if (!scenes.length) throw new TypeError("VideoFrame: at least one scene is required.");
  if (!(sceneDuration > 0)) throw new TypeError("VideoFrame: sceneDuration must be a positive number of milliseconds.");
  const [ownPlaying, setOwnPlaying] = useState(false);
  const [ownScene, setOwnScene] = useState(defaultScene);
  const isPlaying = playing ?? ownPlaying, last = scenes.length - 1;
  const current = Math.min(Math.max(scene ?? ownScene, 0), last);
  const changePlaying = (next: boolean) => { if (playing === undefined) setOwnPlaying(next); onPlayingChange?.(next); };
  const changeScene = (next: number) => { if (scene === undefined) setOwnScene(next); onSceneChange?.(next); };
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setTimeout(() => current < last ? changeScene(current + 1) : changePlaying(false), sceneDuration);
    return () => clearTimeout(timer);
  });
  return <SemanticContent as="div" {...FRAME_STAMP} data-frame-root="" data-aspect="16:9" data-playing={isPlaying} className={cx("flex w-full min-w-0 flex-col frame-stage-flow", GROUND_PAINT.page.surface, GROUND_PAINT.page.primary, className)}>
    <SemanticContent as="main" data-slot="video-stage" className={cx("aspect-video w-full min-w-0 overflow-hidden rounded-lg border", GROUND_PAINT.page.border)}>
      {scenes[current]}
    </SemanticContent>
    <SemanticContent as="section" data-slot="video-controls" aria-label={labels.controls} className="flex w-full min-w-0 items-center frame-heading-stack">
      <Button variant="ghost" size="sm" onPress={() => changePlaying(!isPlaying)}>{isPlaying ? labels.pause : labels.play}</Button>
      <Slider aria-label={labels.scrubber} minValue={0} maxValue={last} step={1} value={current} onChange={value => changeScene(value)} className="min-w-0 flex-1" />
      <SemanticContent as="span" data-slot="video-count" className={GROUND_PAINT.page.secondary}>{current + 1} / {scenes.length}</SemanticContent>
    </SemanticContent>
  </SemanticContent>;
}

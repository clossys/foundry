"use client";
// Kibo UI Video Player (MIT, Copyright (c) 2023 — Present shadcnblocks), copied from
// shadcnblocks/kibo packages/video-player/index.tsx at commit
// 3d63cdb15b79d972e3dc38a10997987672f9b263, over media-chrome (MIT). Local adaptations,
// imports and tokens only: `@/lib/utils` points at the vendored `cn`; the shadcn colour and
// font variables are the Designer surface, ink, action, line and status tokens; and
// MediaCaptionsButton is added beside the other media-chrome controls, wrapped the same way.

import {
  MediaCaptionsButton,
  MediaControlBar,
  MediaController,
  MediaMuteButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "../../preview-runtime/components/_parts/utils/index.js";

export type VideoPlayerProps = ComponentProps<typeof MediaController>;

const variables = {
  "--media-primary-color": "var(--color-action)",
  "--media-secondary-color": "var(--color-surface-base)",
  "--media-text-color": "var(--color-ink-primary)",
  "--media-background-color": "var(--color-surface-base)",
  "--media-control-hover-background": "var(--color-control-tonal)",
  "--media-font-family": "var(--font-body)",
  "--media-live-button-icon-color": "var(--color-ink-secondary)",
  "--media-live-button-indicator-color": "var(--color-status-danger)",
  "--media-range-track-background": "var(--color-line-base)",
} as CSSProperties;

export const VideoPlayer = ({ style, ...props }: VideoPlayerProps) => (
  <MediaController
    style={{
      ...variables,
      ...style,
    }}
    {...props}
  />
);

export type VideoPlayerControlBarProps = ComponentProps<typeof MediaControlBar>;

export const VideoPlayerControlBar = (props: VideoPlayerControlBarProps) => (
  <MediaControlBar {...props} />
);

export type VideoPlayerTimeRangeProps = ComponentProps<typeof MediaTimeRange>;

export const VideoPlayerTimeRange = ({
  className,
  ...props
}: VideoPlayerTimeRangeProps) => (
  <MediaTimeRange className={cn("p-2.5", className)} {...props} />
);

export type VideoPlayerTimeDisplayProps = ComponentProps<
  typeof MediaTimeDisplay
>;

export const VideoPlayerTimeDisplay = ({
  className,
  ...props
}: VideoPlayerTimeDisplayProps) => (
  <MediaTimeDisplay className={cn("p-2.5", className)} {...props} />
);

export type VideoPlayerVolumeRangeProps = ComponentProps<
  typeof MediaVolumeRange
>;

export const VideoPlayerVolumeRange = ({
  className,
  ...props
}: VideoPlayerVolumeRangeProps) => (
  <MediaVolumeRange className={cn("p-2.5", className)} {...props} />
);

export type VideoPlayerPlayButtonProps = ComponentProps<typeof MediaPlayButton>;

export const VideoPlayerPlayButton = ({
  className,
  ...props
}: VideoPlayerPlayButtonProps) => (
  <MediaPlayButton className={cn("p-2.5", className)} {...props} />
);

export type VideoPlayerSeekBackwardButtonProps = ComponentProps<
  typeof MediaSeekBackwardButton
>;

export const VideoPlayerSeekBackwardButton = ({
  className,
  ...props
}: VideoPlayerSeekBackwardButtonProps) => (
  <MediaSeekBackwardButton className={cn("p-2.5", className)} {...props} />
);

export type VideoPlayerSeekForwardButtonProps = ComponentProps<
  typeof MediaSeekForwardButton
>;

export const VideoPlayerSeekForwardButton = ({
  className,
  ...props
}: VideoPlayerSeekForwardButtonProps) => (
  <MediaSeekForwardButton className={cn("p-2.5", className)} {...props} />
);

export type VideoPlayerMuteButtonProps = ComponentProps<typeof MediaMuteButton>;

export const VideoPlayerMuteButton = ({
  className,
  ...props
}: VideoPlayerMuteButtonProps) => (
  <MediaMuteButton className={cn("p-2.5", className)} {...props} />
);

export type VideoPlayerContentProps = ComponentProps<"video">;

export const VideoPlayerContent = ({
  className,
  ...props
}: VideoPlayerContentProps) => (
  <video className={cn("mt-0 mb-0", className)} {...props} />
);

export type VideoPlayerCaptionsButtonProps = ComponentProps<typeof MediaCaptionsButton>;

export const VideoPlayerCaptionsButton = ({
  className,
  ...props
}: VideoPlayerCaptionsButtonProps) => (
  <MediaCaptionsButton className={cn("p-2.5", className)} {...props} />
);

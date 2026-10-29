"use client";
import { MediaPlayer, type MediaPlayerProps } from "./media-player.js";

/** Preview hosts resolve assets and Writer passage fields before mounting this specimen. */
export function MediaPlayerSpecimen(props: MediaPlayerProps) {
  return <div className="flex flex-col gap-lg">
    <MediaPlayer {...props} controls="full" />
    <MediaPlayer {...props} controls="minimal" />
  </div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { ImageResource, VideoResource } from "../../catalog-assets/media.js";
import { Button } from "../preview-runtime/components/button/button.js";
import { Icon } from "../preview-runtime/components/icon/icon.js";
import { ChevronRight } from "../../icons/ChevronRight.js";
import { SemanticContent } from "../SemanticContent.js";
import {
  VideoPlayer, VideoPlayerCaptionsButton, VideoPlayerContent, VideoPlayerControlBar, VideoPlayerMuteButton,
  VideoPlayerPlayButton, VideoPlayerTimeDisplay, VideoPlayerTimeRange,
} from "../partners/kibo-ui/video-player.js";
import { cx } from "../internal/cx.js";

/** Resolved Writer passage fields; the host owns language and approval. */
export interface MediaPlayerPassage {
  title: string;
  play: string;
  pause: string;
  mute: string;
  seek: string;
  captions: string;
  error: { title: string; description: string };
}

export interface MediaPlayerProps {
  decorative?: false;
  /** The resolved assets.video resource. */
  video: VideoResource;
  /** The resolved assets.image still, shown before playback and after failure. */
  poster: ImageResource;
  passage: MediaPlayerPassage;
  captions?: VideoResource["captions"];
  muted?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  controls?: "full" | "minimal";
  className?: string;
}

/** The keyboard seek step, in seconds; media-chrome's hotkeys use it for ArrowLeft and ArrowRight. */
const SEEK_STEP = 5;
/** media-controller attributes its React wrapper passes through but does not type. */
const SEEK_ATTRIBUTES = { keyboardbackwardseekoffset: SEEK_STEP, keyboardforwardseekoffset: SEEK_STEP } as object;

/**
 * Poster-first inline playback on the Kibo UI Video Player (media-chrome). media-chrome owns the
 * controls, their state, the Space/K, M, C and arrow-key hotkeys and the seek bar; this session
 * keeps the poster-first start, the automatic-playback policy (muted, at least a quarter visible,
 * never under reduced motion, never after a user pause) and the Writer error fallback.
 */
function MediaPlayerSession({ video, poster, passage, captions = video.captions, muted = false, autoplay = false, loop = false, controls = "full", className }: MediaPlayerProps) {
  const media = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const userPaused = useRef(false);
  const policyPause = useRef(false);
  const reducedMotion = useRef(true);
  const visible = useRef(false);
  const failed = useRef(false);
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);

  const play = () => {
    const element = media.current;
    if (!element || failed.current) return;
    // A blocked play request is recoverable through the same visible play control.
    void element.play()?.catch(() => undefined);
  };
  /** A pause the policy makes (visibility, motion, unmount) is not the user's and never blocks resuming. */
  const pauseForPolicy = (element: HTMLVideoElement) => {
    policyPause.current = true;
    element.pause();
    policyPause.current = false;
  };
  const start = () => { userPaused.current = false; play(); };

  useEffect(() => { if (media.current) media.current.muted = muted; }, [muted]);
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    element.muted = muted;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = query.matches;
    const reconcile = () => {
      if (!visible.current) { pauseForPolicy(element); return; }
      if (autoplay && element.muted && !reducedMotion.current && !userPaused.current && !failed.current) {
        void element.play()?.catch(() => undefined);
      }
    };
    const motionChanged = () => {
      reducedMotion.current = query.matches;
      // A newly enabled preference also stops an already running automatic clip.
      if (query.matches) pauseForPolicy(element);
      else reconcile();
    };
    query.addEventListener("change", motionChanged);
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "function" && root.current) {
      observer = new IntersectionObserver(entries => {
        const entry = entries.find(item => item.target === root.current);
        if (!entry) return;
        visible.current = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        reconcile();
      }, { threshold: [0, 0.25] });
      observer.observe(root.current);
    } else { visible.current = true; reconcile(); }
    return () => { query.removeEventListener("change", motionChanged); observer?.disconnect(); pauseForPolicy(element); };
  }, [autoplay, video.src]);

  return <div ref={root} data-slot="media-player" className={cx("relative overflow-hidden rounded-surface bg-surface-sunken text-ink-primary", className)}>
    <VideoPlayer role="group" aria-label={passage.title} aria-keyshortcuts="Space K ArrowLeft ArrowRight M C" tabIndex={0}
      {...SEEK_ATTRIBUTES}
      hidden={error} className="block w-full focus-ring">
      <VideoPlayerContent ref={media} slot="media" src={video.src} poster={poster.src} width={video.width} height={video.height}
        preload="metadata" playsInline muted={muted} loop={loop} aria-label={passage.title}
        className="block h-auto w-full"
        onPlay={() => { userPaused.current = false; setStarted(true); }}
        onPause={() => { if (!policyPause.current && !media.current?.ended) userPaused.current = true; }}
        onEnded={() => { userPaused.current = true; }}
        onError={() => { failed.current = true; pauseForPolicy(media.current!); setError(true); }}>
        {captions ? <track kind="captions" src={captions.src} srcLang={captions.srclang} label={captions.label} /> : null}
      </VideoPlayerContent>
      <VideoPlayerControlBar>
        <VideoPlayerPlayButton />
        <VideoPlayerMuteButton />
        {controls === "full" ? <VideoPlayerTimeRange /> : null}
        {controls === "full" ? <VideoPlayerTimeDisplay showDuration /> : null}
        {captions && controls === "full" ? <VideoPlayerCaptionsButton /> : null}
      </VideoPlayerControlBar>
    </VideoPlayer>
    {error ? <img src={poster.src} alt={poster.decorative ? "" : poster.alt} width={poster.width} height={poster.height} className="block h-auto w-full" /> : null}
    {!started && !error ? <div className="absolute inset-0 flex items-center justify-center">
      <Button onPress={start}><Icon glyph={ChevronRight} decorative size="sm" />{passage.play}</Button>
    </div> : null}
    {error ? <SemanticContent as="div" role="alert" className="flex flex-col gap-xs p-md">
      <SemanticContent as="strong">{passage.error.title}</SemanticContent>
      <SemanticContent as="p">{passage.error.description}</SemanticContent>
    </SemanticContent> : null}
  </div>;
}

export type PassiveMediaPlayerProps = Omit<MediaPlayerProps, "decorative" | "passage" | "controls"> & { decorative: true; passage?: MediaPlayerPassage };

/** Passive decoration has no controls or tab stops and keeps the poster until motion is allowed. */
function PassiveMediaPlayer({ video, poster, className }: PassiveMediaPlayerProps) {
  const media = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const element = media.current;
    if (!element || reduced || failed) return;
    element.muted = true; element.defaultMuted = true;
    void element.play()?.catch(() => setFailed(true));
    return () => element.pause();
  }, [reduced, failed, video.src]);
  return <div data-slot="media-player" data-media-passive="" aria-hidden="true" className={cx("h-full w-full", className)} style={{ pointerEvents: "none" }}>
    {reduced || failed ? <img data-media-poster="" src={poster.src} alt="" width={poster.width} height={poster.height} className="h-full w-full object-cover" /> : <VideoPlayerContent ref={media} src={video.src} poster={poster.src} width={video.width} height={video.height} muted autoPlay loop playsInline tabIndex={-1} aria-hidden="true" preload="metadata" className="h-full w-full object-cover" onError={() => setFailed(true)} />}
  </div>;
}

/** A new video resource starts a fresh playback session. */
export function MediaPlayer(props: MediaPlayerProps | PassiveMediaPlayerProps) {
  return props.decorative ? <PassiveMediaPlayer key={props.video.src} {...props} /> : <MediaPlayerSession key={props.video.src} {...props} />;
}

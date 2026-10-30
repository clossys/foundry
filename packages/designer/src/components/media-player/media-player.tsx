"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ImageResource, VideoResource } from "../../catalog-assets/media.js";
import { Button } from "../Button.js";
import { ToggleButton } from "../ToggleButton.js";
import { Slider } from "../Slider.js";
import { Icon } from "../Icon.js";
import { ChevronRight } from "../../icons/ChevronRight.js";
import { SemanticContent } from "../SemanticContent.js";
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

/** Poster-first inline playback. Automatic playback always respects motion, sound and user intent. */
function MediaPlayerSession({ video, poster, passage, captions = video.captions, muted = false, autoplay = false, loop = false, controls = "full", className }: MediaPlayerProps) {
  const media = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const userPaused = useRef(false);
  const reducedMotion = useRef(true);
  const visible = useRef(false);
  const failed = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [isMuted, setMuted] = useState(muted);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);

  const play = () => {
    const element = media.current;
    if (!element || failed.current) return;
    // A blocked play request is recoverable through the same visible play control.
    void element.play()?.catch(() => setPlaying(false));
  };
  const pause = () => { media.current?.pause(); };
  const togglePlayback = () => {
    if (playing) { userPaused.current = true; pause(); }
    else { userPaused.current = false; play(); }
  };
  const seek = (value: number) => {
    if (!media.current || !Number.isFinite(duration) || duration <= 0) return;
    const next = Math.max(0, Math.min(duration, value));
    media.current.currentTime = next;
    setPosition(next);
  };

  useEffect(() => { setMuted(muted); }, [muted]);
  useEffect(() => { if (media.current) media.current.muted = isMuted; }, [isMuted]);
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    element.muted = isMuted;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = query.matches;
    const reconcile = () => {
      if (!visible.current) { element.pause(); return; }
      if (autoplay && element.muted && !reducedMotion.current && !userPaused.current && !failed.current) {
        void element.play()?.catch(() => setPlaying(false));
      }
    };
    const motionChanged = () => {
      reducedMotion.current = query.matches;
      // A newly enabled preference also stops an already running automatic clip.
      if (query.matches) element.pause();
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
    return () => { query.removeEventListener("change", motionChanged); observer?.disconnect(); element.pause(); };
  }, [autoplay, video.src]);

  useEffect(() => {
    const tracks = media.current?.textTracks;
    if (tracks) for (let index = 0; index < tracks.length; index++) tracks[index]!.mode = captionsOn ? "showing" : "disabled";
  }, [captionsOn, captions?.src]);

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const key = event.key.toLowerCase();
    // The styled controls retain their own Space and arrow interactions.
    if ((key === " " || key.startsWith("arrow")) && event.target !== event.currentTarget) return;
    if (key === " " || key === "k") togglePlayback();
    else if (key === "arrowleft") seek(position - 5);
    else if (key === "arrowright") seek(position + 5);
    else if (key === "m") setMuted(value => !value);
    else if (key === "c" && captions) setCaptionsOn(value => !value);
    else return;
    event.preventDefault();
  };

  return <div ref={root} data-slot="media-player" role="group" aria-label={passage.title}
    aria-keyshortcuts="Space K ArrowLeft ArrowRight M C" tabIndex={0} onKeyDown={keyboard}
    className={cx("relative overflow-hidden rounded-surface bg-surface-sunken text-ink-primary focus-ring", className)}>
    <div className="relative">
      <video ref={media} src={video.src} poster={poster.src} width={video.width} height={video.height}
        preload="metadata" playsInline muted={isMuted} loop={loop} aria-label={passage.title}
        className="block h-auto w-full" hidden={error}
        onPlay={() => { setPlaying(true); setStarted(true); }} onPause={() => setPlaying(false)}
        onEnded={() => { userPaused.current = true; setPlaying(false); }} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onError={() => { failed.current = true; pause(); setError(true); setPlaying(false); }}>
        {captions ? <track kind="captions" src={captions.src} srcLang={captions.srclang} label={captions.label}
          onLoad={() => { const tracks = media.current?.textTracks; if (tracks) for (let index = 0; index < tracks.length; index++) tracks[index]!.mode = captionsOn ? "showing" : "disabled"; }} /> : null}
      </video>
      {error ? <img src={poster.src} alt={poster.decorative ? "" : poster.alt} width={poster.width} height={poster.height} className="block h-auto w-full" /> : null}
      {!started && !error ? <div className="absolute inset-0 flex items-center justify-center">
        <Button onPress={togglePlayback}><Icon glyph={ChevronRight} decorative size="sm" />{passage.play}</Button>
      </div> : null}
    </div>
    {error ? <SemanticContent as="div" role="alert" className="flex flex-col gap-xs p-md">
      <SemanticContent as="strong">{passage.error.title}</SemanticContent>
      <SemanticContent as="p">{passage.error.description}</SemanticContent>
    </SemanticContent> : <div className="flex flex-wrap items-center gap-sm p-sm">
      {started ? <Button variant="secondary" onPress={togglePlayback}>{playing ? passage.pause : passage.play}</Button> : null}
      <ToggleButton isSelected={isMuted} onChange={setMuted}>{passage.mute}</ToggleButton>
      {captions ? <ToggleButton isSelected={captionsOn} onChange={setCaptionsOn}>{passage.captions}</ToggleButton> : null}
      {controls === "full" ? <Slider label={passage.seek} minValue={0} maxValue={duration || 1} step={5} value={position}
        isDisabled={duration <= 0} showValue={false} onChange={seek} /> : null}
    </div>}
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
    {reduced || failed ? <img data-media-poster="" src={poster.src} alt="" width={poster.width} height={poster.height} className="h-full w-full object-cover" /> : <video ref={media} src={video.src} poster={poster.src} width={video.width} height={video.height} muted autoPlay loop playsInline tabIndex={-1} aria-hidden="true" preload="metadata" className="h-full w-full object-cover" onError={() => setFailed(true)} />}
  </div>;
}

/** A new video resource starts a fresh playback session. */
export function MediaPlayer(props: MediaPlayerProps | PassiveMediaPlayerProps) {
  return props.decorative ? <PassiveMediaPlayer key={props.video.src} {...props} /> : <MediaPlayerSession key={props.video.src} {...props} />;
}

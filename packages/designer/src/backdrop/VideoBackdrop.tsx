"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "../components/Button.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { isVideoResource, type VideoResource } from "../catalog-assets/media.js";
import { BackdropHost } from "./BackdropHost.js";
import { checkRuntimeBackdrop, type BackdropModuleLoaders, type RuntimeBackdropResource } from "./runtime-module.js";
import type { StillBackdropArt } from "./consumer-art.js";
import type { HeroBackdropScrim } from "../blocks/hero/StillBackdrop.js";

export interface VideoBackdropResource {
  kind: "video";
  video: VideoResource;
  poster: StillBackdropArt;
  still: StillBackdropArt;
  /** Declared bytes of the video file and total transfer budget including fallback art. */
  bytes: number;
  budgetBytes: number;
  /** Resolved Writer copy. The renderer supplies no text defaults. */
  labels: { pause: string; resume: string };
}

function runtimeResource(resource: VideoBackdropResource): RuntimeBackdropResource {
  return { kind: "module", moduleRef: "./video-backdrop", poster: resource.poster, still: resource.still, moduleBytes: resource.bytes, budgetBytes: resource.budgetBytes };
}

/** Uses the same offline budget and local-only policy as executable backdrop art. */
export function checkVideoBackdrop(value: unknown): value is VideoBackdropResource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const resource = value as VideoBackdropResource;
  return resource.kind === "video" && isVideoResource(resource.video)
    && /^\/(?!\/)[A-Za-z0-9_./-]+$/.test(resource.video.src) && !resource.video.src.split("/").includes("..")
    && (resource.video.poster === undefined || /^\/(?!\/)[A-Za-z0-9_./-]+$/.test(resource.video.poster) && !resource.video.poster.split("/").includes(".."))
    && typeof resource.labels?.pause === "string" && resource.labels.pause.trim().length > 0
    && typeof resource.labels?.resume === "string" && resource.labels.resume.trim().length > 0
    && checkRuntimeBackdrop(runtimeResource(resource));
}

/** Video decoration inherits the checked host lifetime; its pause control remains outside the hidden layer. */
export function VideoBackdrop({ resource, scrim = "light" }: { resource: VideoBackdropResource; scrim?: HeroBackdropScrim }) {
  if (!checkVideoBackdrop(resource)) throw new TypeError("Invalid video backdrop declaration");
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const userPaused = useRef(false);
  const visibilityPaused = useRef(true);
  const video = useRef<HTMLVideoElement | null>(null);
  const declared = useMemo(() => runtimeResource(resource), [resource]);
  const modules = useMemo<BackdropModuleLoaders>(() => ({
    "./video-backdrop": async () => ({
      mount(element, options) {
        const player = document.createElement("video");
        player.muted = true;
        player.defaultMuted = true;
        player.loop = true;
        player.playsInline = true;
        player.preload = "none";
        player.setAttribute("aria-hidden", "true");
        player.tabIndex = -1;
        player.style.pointerEvents = "none";
        player.style.width = "100%";
        player.style.height = "100%";
        player.style.objectFit = "cover";
        player.poster = resource.video.poster ?? (resource.poster.source.format === "svg" ? "" : resource.poster.source.src);
        player.src = resource.video.src;
        player.addEventListener("error", options.onError);
        element.append(player);
        video.current = player;
        visibilityPaused.current = options.paused;
        setReady(true);
        const setPlayback = (offscreen: boolean) => {
          visibilityPaused.current = offscreen;
          if (offscreen || userPaused.current) player.pause();
          else void player.play().catch(options.onError);
        };
        return {
          setPaused: setPlayback,
          destroy() {
            player.removeEventListener("error", options.onError);
            player.pause();
            player.removeAttribute("src");
            player.load();
            player.remove();
            if (video.current === player) video.current = null;
            setReady(false);
          },
        };
      },
    }),
  }), [resource]);
  const toggle = () => {
    userPaused.current = !userPaused.current;
    setPaused(userPaused.current);
    if (userPaused.current) video.current?.pause();
    else if (!visibilityPaused.current) void video.current?.play().catch(() => { userPaused.current = true; setPaused(true); });
  };
  return <>
    <BackdropHost resource={declared} modules={modules} scrim={scrim} />
    {ready ? <SemanticContent as="div" className="absolute bottom-md right-md">
      <Button variant="secondary" size="sm" aria-pressed={paused} onPress={toggle}>{paused ? resource.labels.resume : resource.labels.pause}</Button>
    </SemanticContent> : null}
  </>;
}

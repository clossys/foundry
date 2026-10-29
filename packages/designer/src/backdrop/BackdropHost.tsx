"use client";

import { useEffect, useRef, useState } from "react";
import { SemanticContent } from "../components/SemanticContent.js";
import { StillBackdrop, type HeroBackdropScrim } from "../blocks/hero/StillBackdrop.js";
import { checkBackdropElement } from "./contract.js";
import { checkRuntimeBackdrop, type BackdropModuleInstance, type BackdropModuleLoaders, type RuntimeBackdropResource } from "./runtime-module.js";

export interface BackdropHostProps {
  resource: RuntimeBackdropResource;
  modules: BackdropModuleLoaders;
  scrim?: HeroBackdropScrim;
}

/** Decorative runtime art: still by default, then in-view + idle; the host owns lifetime and pause policy. */
export function BackdropHost({ resource, modules, scrim = "light" }: BackdropHostProps) {
  if (!checkRuntimeBackdrop(resource)) throw new TypeError("Invalid runtime backdrop declaration");
  const layer = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const root = layer.current;
    const target = mount.current;
    if (!root || !target) return;
    setActive(false);
    const abort = new AbortController();
    let instance: BackdropModuleInstance | undefined;
    let visible = false;
    let requested = false;
    let generation = 0;
    let cancelIdle: (() => void) | undefined;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let motionReduced = preference.matches;
    setReduced(motionReduced);

    const dispose = () => {
      generation++;
      cancelIdle?.();
      cancelIdle = undefined;
      try { if (typeof instance?.destroy === "function") instance.destroy(); } catch { /* Retain the static fallback when consumer teardown fails. */ }
      instance = undefined;
      target.replaceChildren();
      setActive(false);
    };
    const fail = () => {
      dispose();
      abort.abort();
    };
    const start = () => {
      if (!visible || motionReduced || requested || abort.signal.aborted) return;
      requested = true;
      const ticket = ++generation;
      const load = Object.hasOwn(modules, resource.moduleRef) ? modules[resource.moduleRef] : undefined;
      if (!load) { fail(); return; }
      Promise.resolve().then(load).then(module => {
        if (abort.signal.aborted || motionReduced || ticket !== generation) return undefined;
        return module.mount(target, { paused: !visible, signal: abort.signal });
      }).then(created => {
        if (!created) return;
        if (abort.signal.aborted || motionReduced || ticket !== generation) { if (typeof created.destroy === "function") created.destroy(); return; }
        instance = created;
        if (typeof instance.setPaused !== "function" || typeof instance.destroy !== "function" || !checkBackdropElement(root).ok) { fail(); return; }
        instance.setPaused(!visible);
        setActive(true);
      }).catch(fail);
    };
    const schedule = () => {
      if (!visible || motionReduced || requested || cancelIdle || abort.signal.aborted) return;
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(() => { cancelIdle = undefined; start(); });
        cancelIdle = () => window.cancelIdleCallback(id);
      }
    };
    const onPreference = () => {
      motionReduced = preference.matches;
      setReduced(motionReduced);
      if (motionReduced) {
        dispose();
        requested = false;
      } else schedule();
    };
    preference.addEventListener("change", onPreference);
    // Without visibility observation, keep the safe still rather than eagerly loading decoration.
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.target === root && entry.isIntersecting);
      instance?.setPaused(!visible);
      if (!visible) { cancelIdle?.(); cancelIdle = undefined; }
      else schedule();
    }) : undefined;
    observer?.observe(root);
    return () => {
      abort.abort();
      preference.removeEventListener("change", onPreference);
      observer?.disconnect();
      dispose();
    };
  }, [resource, modules]);

  return (
    <SemanticContent as="div" ref={layer} data-backdrop-host="" aria-hidden="true" className="absolute inset-0" style={{ pointerEvents: "none" }}>
      <StillBackdrop art={reduced ? resource.still : resource.poster} scrim={scrim} />
      <SemanticContent as="div" ref={mount} data-backdrop-runtime="" className="absolute inset-0" style={{ pointerEvents: "none", visibility: active && !reduced ? "visible" : "hidden" }} />
      <SemanticContent as="div" data-backdrop-runtime-scrim="" className="absolute inset-0" style={{ pointerEvents: "none", backgroundImage: "var(--gradient-media-scrim)" }} />
      {Array.from({ length: scrim === "strong" ? 5 : 4 }, (_, index) => <SemanticContent as="div" key={index} className="absolute inset-0" style={{ pointerEvents: "none", backgroundColor: "var(--color-overlay-scrim)" }} />)}
    </SemanticContent>
  );
}

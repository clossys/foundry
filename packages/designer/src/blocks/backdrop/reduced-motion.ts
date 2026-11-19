import { useSyncExternalStore } from "react";

/**
 * The visitor's reduced-motion preference for the interactive backdrops (foundry-build-0048 A4,
 * U23). Still unless the browser says motion is welcome: on the server, before hydration and where
 * `matchMedia` is missing, every backdrop renders its still frame.
 */
const REDUCE = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia(REDUCE);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}
const motionReduced = (): boolean => typeof matchMedia !== "function" || matchMedia(REDUCE).matches;
/** The server and the first hydration frame always render the still frame. */
const serverMotionReduced = (): boolean => true;
/** Whether the visitor asked for reduced motion (true on the server and where it cannot be read). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionReduced, serverMotionReduced);
}

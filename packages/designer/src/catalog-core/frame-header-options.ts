/** Closed behavior shared by the two header frames and their previews. */
export interface FrameHeaderOptions {
  position?: "sticky" | "static";
  surface?: "solid" | "transparent" | "glass";
}
export type HeaderFrameId = "frames.app-header" | "frames.site-header";

/** Instance values override library defaults one axis at a time; omission keeps the shipped behavior. */
export function resolveFrameHeaderOptions(frame: HeaderFrameId, instance: FrameHeaderOptions = {}, defaults: FrameHeaderOptions = {}) {
  const position = instance.position === undefined ? defaults.position : instance.position;
  const surface = instance.surface === undefined ? defaults.surface : instance.surface;
  if (position !== undefined && position !== "sticky" && position !== "static")
    throw new TypeError("Header frame: position must be sticky or static.");
  if (surface !== undefined && surface !== "solid" && surface !== "transparent" && surface !== "glass")
    throw new TypeError("Header frame: surface must be solid, transparent or glass.");
  if (surface === "glass" && position === "static")
    throw new TypeError("Header frame: glass cannot use static position.");
  const effectivePosition = surface === "glass" ? "fixed" : position ?? (frame === "frames.app-header" ? "sticky" : "relative");
  return {
    position: effectivePosition,
    surface,
    /** Selected members stay separate from CSS fixed/relative legacy mechanisms. */
    members: { ...(position === undefined ? {} : { position }), ...(surface === undefined ? {} : { surface }) },
    reads: [] as const,
  } as const;
}

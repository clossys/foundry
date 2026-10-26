import type { AppFrameBrand } from "./app-frame-types.js";
export function assertAppFrameBrand({ markSrc }: AppFrameBrand) {
  if (typeof markSrc !== "string" || !markSrc.trim()) throw new TypeError("AppFrame: brand mark source must be non-empty.");
}

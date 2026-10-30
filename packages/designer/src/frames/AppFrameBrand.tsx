import type { AppFrameBrand } from "./app-frame-types.js";
export function assertAppFrameBrand({ markSrc, reversedMarkSrc, navigationMark }: AppFrameBrand) {
  if (typeof markSrc !== "string" || !markSrc.trim()) throw new TypeError("AppFrame: brand mark source must be non-empty.");
  if (reversedMarkSrc !== undefined && (typeof reversedMarkSrc !== "string" || !reversedMarkSrc.trim())) throw new TypeError("AppFrame: reversed brand mark source must be non-empty.");
  if (navigationMark !== undefined && (typeof navigationMark.label !== "string" || !navigationMark.label.trim())) throw new TypeError("AppFrame: navigation brand name must be non-empty.");
}

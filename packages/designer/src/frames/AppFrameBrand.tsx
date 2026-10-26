import type { AppFrameBrand } from "./app-frame-types.js";
function normalize(value: string) { return value.replace(/\s+/g, " ").trim().toLowerCase(); }
export function assertAppFrameBrand({ markSrc, wordmark, label }: AppFrameBrand) {
  if (!markSrc.trim() || !wordmark.trim() || !label.trim()) throw new TypeError("AppFrame: brand source, wordmark and label must be non-empty.");
  if (!normalize(label).includes(normalize(wordmark))) throw new TypeError("AppFrame: brand label must contain the visible wordmark.");
}

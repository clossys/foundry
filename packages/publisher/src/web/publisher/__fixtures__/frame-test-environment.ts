import { vi } from "vitest";

/** Same deterministic media-query surface used by the actual Frame tests. */
export function installFrameTestEnvironment() {
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media, matches: media.includes("min-width") || media === "all", onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
  })));
}

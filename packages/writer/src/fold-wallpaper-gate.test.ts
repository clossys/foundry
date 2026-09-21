import { describe, expect, it } from "vitest";
import { findFoldWallpaperPhrase } from "./fold-wallpaper-gate.js";

describe("findFoldWallpaperPhrase", () => {
  it("matches case-insensitive wallpaper phrases", () => {
    expect(findFoldWallpaperPhrase("Built with AI intelligence for teams")).toBe("ai intelligence");
  });

  it("does not match partial tokens inside other words", () => {
    expect(findFoldWallpaperPhrase("microfounders club")).toBeUndefined();
  });

  it("allows request a demo as CTA copy", () => {
    expect(findFoldWallpaperPhrase("Request a demo")).toBeUndefined();
  });
});

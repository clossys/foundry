import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { colorAlpha, contrastRatioEncodedBlend, parseOklch } from "../tokens/color.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { stillBackdropPolicy } from "../blocks/hero/StillBackdrop.js";
import { resolveHeroBackdrop } from "../blocks/hero/hero-backdrop.js";
import { MarketingComponentProvider } from "./marketing-component-selection.js";
import { HERO_BACKDROP_SPECIMENS, HERO_SPECIMEN_BACKDROP, HERO_SPECIMEN_COPY, HeroSpecimen } from "./hero-specimen.js";

describe("Hero backdrop kind specimen", () => {
  it.each(HERO_BACKDROP_SPECIMENS)("renders explicit $kind data or a visible missing-binding NEED", async ({ kind, backdrop }) => {
    const { container } = render(<MarketingComponentProvider><Suspense><HeroSpecimen backdrop={backdrop} /></Suspense></MarketingComponentProvider>);
    await screen.findByRole("heading", { name: HERO_SPECIMEN_COPY["header.heading"] });
    const section = container.querySelector("section")!;
    expect(section).toHaveAttribute("data-hero-backdrop-kind", kind);
    if (kind === "none") {
      expect(section.querySelector("[data-hero-backdrop]")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    } else if (kind === "image") {
      expect(section.querySelector("[data-hero-backdrop] svg path")).toHaveAttribute("fill", "var(--color-accent)");
      expect(screen.queryByRole("status")).toBeNull();
    } else if (kind === "video") {
      expect(section.querySelector("[data-hero-backdrop] svg path")).toHaveAttribute("fill", "var(--color-accent)");
      expect(section.querySelector("video")).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("NEED components.media-player");
    } else {
      expect(section.querySelector("[data-hero-backdrop]")).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("NEED Assets leaf: asset.backdrop.graphic");
    }
  });
  it("requires a real poster policy and muted inline autoplay loop declaration for video", () => {
    const video = HERO_BACKDROP_SPECIMENS[2].backdrop;
    expect(resolveHeroBackdrop(video)).toMatchObject({ kind: "video", art: HERO_SPECIMEN_BACKDROP });
    expect(() => resolveHeroBackdrop({ ...video, muted: false })).toThrow(/muted autoplay loop playsInline/);
    expect(() => resolveHeroBackdrop({ ...video, video: { ...video.video, reducedMotion: "paused" } })).toThrow(/poster policy/);
    expect(() => resolveHeroBackdrop({ ...video, poster: undefined })).toThrow(/poster policy/);
  });
  it.each(["light", "strong"] as const)("bounds the actual %s scalar token scrim against the worst white backdrop in both themes", scrim => {
    const css = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
    const light = parseRootDeclarations(css);
    const dark = new Map([...light, ...parseDeclarationsForSelector(css, ':root[data-theme="dark"]')]);
    const policy = stillBackdropPolicy(HERO_SPECIMEN_BACKDROP, scrim);
    expect(policy.report.ok).toBe(true);
    for (const tokens of [light, dark]) {
      const scalar = tokens.get("--color-overlay-scrim")!;
      expect(parseOklch(scalar)).toMatchObject({ L: 0, C: 0 });
      const alpha = colorAlpha(scalar)!;
      expect(alpha).toBeGreaterThan(0);
      const effective = 1 - (1 - alpha) ** policy.passes;
      const ratio = contrastRatioEncodedBlend(tokens.get("--color-neutral-50")!, `oklch(0 0 0 / ${effective})`, "#ffffff");
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});

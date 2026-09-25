import { describe, expect, it } from "vitest";
import {
  getSocialChannelSpec,
  getVideoCallBackgroundSpec,
  OG_SHARE_CARD_SPEC,
  SOCIAL_CHANNEL_SPECS,
  staleChannelSpecEntries,
  VIDEO_CALL_BACKGROUND_SPECS,
} from "./channelSpecs.js";

describe("SOCIAL_CHANNEL_SPECS", () => {
  it("covers every popular channel #1207 names", () => {
    expect(SOCIAL_CHANNEL_SPECS.map((entry) => entry.channel).sort()).toEqual(
      ["facebook", "github", "instagram", "linkedin", "tiktok", "x", "youtube"].sort(),
    );
  });

  it("every entry declares at least one image spec, one text limit, and a verified date", () => {
    for (const entry of SOCIAL_CHANNEL_SPECS) {
      expect(entry.images.length).toBeGreaterThan(0);
      expect(entry.textLimits.length).toBeGreaterThan(0);
      expect(entry.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const image of entry.images) {
        expect(image.widthPx).toBeGreaterThan(0);
        expect(image.heightPx).toBeGreaterThan(0);
      }
      for (const limit of entry.textLimits) expect(limit.maxChars).toBeGreaterThan(0);
    }
  });

  it("has no duplicate channel entries", () => {
    const channels = SOCIAL_CHANNEL_SPECS.map((entry) => entry.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });
});

describe("getSocialChannelSpec", () => {
  it("finds a known channel", () => {
    expect(getSocialChannelSpec("linkedin")?.channel).toBe("linkedin");
  });

  it("returns undefined for an unknown channel", () => {
    expect(getSocialChannelSpec("myspace")).toBeUndefined();
  });
});

describe("VIDEO_CALL_BACKGROUND_SPECS", () => {
  it("covers Zoom, Google Meet, and Microsoft Teams (#1207)", () => {
    expect(VIDEO_CALL_BACKGROUND_SPECS.map((entry) => entry.platform).sort()).toEqual(["google-meet", "microsoft-teams", "zoom"]);
  });

  it("every platform is 16:9", () => {
    for (const entry of VIDEO_CALL_BACKGROUND_SPECS) expect(entry.widthPx / entry.heightPx).toBeCloseTo(16 / 9, 2);
  });
});

describe("getVideoCallBackgroundSpec", () => {
  it("finds a known platform", () => {
    expect(getVideoCallBackgroundSpec("zoom")?.platform).toBe("zoom");
  });

  it("returns undefined for an unknown platform", () => {
    expect(getVideoCallBackgroundSpec("skype")).toBeUndefined();
  });
});

describe("OG_SHARE_CARD_SPEC", () => {
  it("is the standard 1200x630 share card size", () => {
    expect(OG_SHARE_CARD_SPEC).toEqual({ label: "og-share-card", widthPx: 1200, heightPx: 630 });
  });
});

describe("staleChannelSpecEntries", () => {
  it("reports nothing stale immediately after every entry's verified date", () => {
    expect(staleChannelSpecEntries(new Date("2026-09-22T00:00:00Z"), 90)).toEqual([]);
  });

  it("reports every entry once the verified date is older than the staleness window", () => {
    const stale = staleChannelSpecEntries(new Date("2030-01-01T00:00:00Z"), 90);
    expect(stale.length).toBe(SOCIAL_CHANNEL_SPECS.length + VIDEO_CALL_BACKGROUND_SPECS.length);
    expect(stale).toContain("social:linkedin");
    expect(stale).toContain("video-call-background:zoom");
  });
});

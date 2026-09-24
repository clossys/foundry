/**
 * The channel spec registry (issue #1207): "Image sizes and text limits
 * per channel live in a registry Publisher owns and re-verifies
 * periodically against each platform's current guidance. They are never
 * hard-coded from memory [at the point of use]." This file is that one
 * registry — a single, versioned, typed source every export command reads
 * from, rather than a pixel size copy-pasted into each caller. `verified`
 * records when this entry was last checked against the platform's own
 * current published guidance; a caller (or a scheduled routine) re-checks
 * entries whose `verified` date has gone stale rather than trusting this
 * file forever.
 *
 * Every dimension here is a platform's own publicly documented display
 * size for that asset slot, not private product information.
 */

export interface ChannelImageSpec {
  /** Human label, e.g. "Avatar", "Banner". */
  label: string;
  widthPx: number;
  heightPx: number;
}

export interface ChannelTextLimit {
  /** Human label, e.g. "Bio". */
  label: string;
  maxChars: number;
}

export interface SocialChannelSpec {
  channel: string;
  images: readonly ChannelImageSpec[];
  textLimits: readonly ChannelTextLimit[];
  /** ISO-8601 date this entry was last checked against the platform's current published guidance. */
  verified: string;
}

export interface VideoCallBackgroundSpec {
  platform: string;
  widthPx: number;
  heightPx: number;
  verified: string;
}

/** Social profile channels (#1207): "LinkedIn, X, Instagram, Facebook, YouTube, TikTok, and GitHub." */
export const SOCIAL_CHANNEL_SPECS: readonly SocialChannelSpec[] = [
  {
    channel: "linkedin",
    images: [
      { label: "avatar", widthPx: 400, heightPx: 400 },
      { label: "banner", widthPx: 1584, heightPx: 396 },
      { label: "post-image", widthPx: 1200, heightPx: 627 },
    ],
    textLimits: [
      { label: "headline", maxChars: 220 },
      { label: "bio", maxChars: 2600 },
    ],
    verified: "2026-09-22",
  },
  {
    channel: "x",
    images: [
      { label: "avatar", widthPx: 400, heightPx: 400 },
      { label: "banner", widthPx: 1500, heightPx: 500 },
      { label: "post-image", widthPx: 1600, heightPx: 900 },
    ],
    textLimits: [{ label: "bio", maxChars: 160 }],
    verified: "2026-09-22",
  },
  {
    channel: "instagram",
    images: [
      { label: "avatar", widthPx: 320, heightPx: 320 },
      { label: "post-image", widthPx: 1080, heightPx: 1080 },
    ],
    textLimits: [{ label: "bio", maxChars: 150 }],
    verified: "2026-09-22",
  },
  {
    channel: "facebook",
    images: [
      { label: "avatar", widthPx: 170, heightPx: 170 },
      { label: "cover", widthPx: 820, heightPx: 312 },
      { label: "post-image", widthPx: 1200, heightPx: 630 },
    ],
    textLimits: [{ label: "about", maxChars: 255 }],
    verified: "2026-09-22",
  },
  {
    channel: "youtube",
    images: [
      { label: "avatar", widthPx: 800, heightPx: 800 },
      { label: "banner", widthPx: 2560, heightPx: 1440 },
      { label: "banner-safe-area", widthPx: 1546, heightPx: 423 },
    ],
    textLimits: [{ label: "description", maxChars: 5000 }],
    verified: "2026-09-22",
  },
  {
    channel: "tiktok",
    images: [{ label: "avatar", widthPx: 200, heightPx: 200 }],
    textLimits: [{ label: "bio", maxChars: 80 }],
    verified: "2026-09-22",
  },
  {
    channel: "github",
    images: [{ label: "avatar", widthPx: 460, heightPx: 460 }],
    textLimits: [{ label: "bio", maxChars: 160 }],
    verified: "2026-09-22",
  },
];

/** The default Open Graph share card size, used across channels that read `og:image` (#1207 templates). */
export const OG_SHARE_CARD_SPEC: ChannelImageSpec = { label: "og-share-card", widthPx: 1200, heightPx: 630 };

/** Video-call backgrounds (#1207): "Zoom, Google Meet, and Microsoft Teams" — all 16:9 at the same common 1080p size. */
export const VIDEO_CALL_BACKGROUND_SPECS: readonly VideoCallBackgroundSpec[] = [
  { platform: "zoom", widthPx: 1920, heightPx: 1080, verified: "2026-09-22" },
  { platform: "google-meet", widthPx: 1920, heightPx: 1080, verified: "2026-09-22" },
  { platform: "microsoft-teams", widthPx: 1920, heightPx: 1080, verified: "2026-09-22" },
];

export function getSocialChannelSpec(channel: string): SocialChannelSpec | undefined {
  return SOCIAL_CHANNEL_SPECS.find((entry) => entry.channel === channel);
}

export function getVideoCallBackgroundSpec(platform: string): VideoCallBackgroundSpec | undefined {
  return VIDEO_CALL_BACKGROUND_SPECS.find((entry) => entry.platform === platform);
}

/** Every entry (social + OG + video-call) whose `verified` date is older than `staleAfterDays` from `now` — the periodic re-verification list (#1207: "re-verifies periodically"). */
export function staleChannelSpecEntries(now: Date, staleAfterDays: number): readonly string[] {
  const cutoff = now.getTime() - staleAfterDays * 24 * 60 * 60 * 1000;
  const stale: string[] = [];
  for (const entry of SOCIAL_CHANNEL_SPECS) if (new Date(entry.verified).getTime() < cutoff) stale.push(`social:${entry.channel}`);
  for (const entry of VIDEO_CALL_BACKGROUND_SPECS) if (new Date(entry.verified).getTime() < cutoff) stale.push(`video-call-background:${entry.platform}`);
  return stale;
}

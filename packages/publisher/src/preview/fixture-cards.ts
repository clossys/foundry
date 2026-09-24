import type { ComposeDocument } from "../core/index.js";
import { OG_SHARE_CARD_SPEC, SOCIAL_CHANNEL_SPECS, VIDEO_CALL_BACKGROUND_SPECS } from "../templates/channelSpecs.js";
import { previewCopyString } from "./fixture-copy-registry.js";

/**
 * Fixture `ComposeDocument`s for every share/social card and video-call
 * background this package's channel-spec registry declares (#1207) — one
 * `image`-channel document per `ChannelImageSpec`/`VideoCallBackgroundSpec`
 * entry, sized exactly to that entry's own `widthPx`/`heightPx`, so the
 * preview shows the actual pixel dimensions a real export would use. This
 * module never invents its own sizes — every dimension is read straight off
 * `../templates/channelSpecs.ts`, the one registry this package owns for
 * them.
 *
 * Every card uses the same generic two-line layout (brand eyebrow, then a
 * headline) — the card CONTENT is a fixture; the card SIZE is real. Prose
 * comes from `fixture-copy-registry.ts` by id.
 */
export interface CardFixture {
  /** This preview's own flat output filename, e.g. "cards-linkedin-avatar.svg". */
  file: string;
  document: ComposeDocument;
}

const EYEBROW_TEXT = previewCopyString("preview.card.eyebrow");
const HEADING_TEXT = previewCopyString("preview.card.heading");
const VIDEOCALL_HEADING_TEXT = previewCopyString("preview.card.videocall.heading");

function cardDocument(id: string, widthPx: number, heightPx: number, alt: string): ComposeDocument {
  return {
    id,
    channel: "image",
    template: "launch-pack-card",
    meta: { channel: "image", width: widthPx, height: heightPx, format: "svg", alt },
    layout: {
      slots: [
        { key: "eyebrow", element: "eyebrow", frame: { x: 0.08, y: 0.1, w: 0.84, h: 0.18 } },
        { key: "heading", element: "heading", frame: { x: 0.08, y: 0.34, w: 0.84, h: 0.5 }, required: true },
      ],
    },
    bindings: [
      { slot: "eyebrow", copyId: "preview.card.eyebrow" },
      { slot: "heading", copyId: "preview.card.heading" },
    ],
  };
}

function videoCallDocument(id: string, widthPx: number, heightPx: number, alt: string): ComposeDocument {
  return {
    id,
    channel: "image",
    template: "launch-pack-videocall",
    meta: { channel: "image", width: widthPx, height: heightPx, format: "svg", alt },
    layout: {
      slots: [{ key: "heading", element: "heading", frame: { x: 0.2, y: 0.44, w: 0.6, h: 0.2 }, required: true }],
    },
    bindings: [{ slot: "heading", copyId: "preview.card.videocall.heading" }],
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function buildCardFixtures(): CardFixture[] {
  const fixtures: CardFixture[] = [];

  fixtures.push({
    file: "cards-og-share-card.svg",
    document: cardDocument(
      "publisher-preview-card-og",
      OG_SHARE_CARD_SPEC.widthPx,
      OG_SHARE_CARD_SPEC.heightPx,
      `${EYEBROW_TEXT} — ${HEADING_TEXT}`,
    ),
  });

  for (const channelSpec of SOCIAL_CHANNEL_SPECS) {
    for (const image of channelSpec.images) {
      const file = `cards-${slug(channelSpec.channel)}-${slug(image.label)}.svg`;
      fixtures.push({
        file,
        document: cardDocument(
          `publisher-preview-card-${slug(channelSpec.channel)}-${slug(image.label)}`,
          image.widthPx,
          image.heightPx,
          `${EYEBROW_TEXT} — ${channelSpec.channel} ${image.label}`,
        ),
      });
    }
  }

  for (const platform of VIDEO_CALL_BACKGROUND_SPECS) {
    fixtures.push({
      file: `cards-videocall-${slug(platform.platform)}.svg`,
      document: videoCallDocument(
        `publisher-preview-card-videocall-${slug(platform.platform)}`,
        platform.widthPx,
        platform.heightPx,
        `${VIDEOCALL_HEADING_TEXT} — ${platform.platform} background`,
      ),
    });
  }

  return fixtures;
}

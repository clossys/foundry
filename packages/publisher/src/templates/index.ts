/**
 * `@clossys/publisher/templates` — the pack's opinionated defaults (issue
 * #1207): overview and deck structure, an email kit (signatures, launch
 * announcement, welcome/follow-up — see this subpath's own README section
 * for the two email templates' shape, built through
 * `@clossys/publisher/email`), the channel spec registry (image sizes and
 * text limits, re-verified periodically), and video-call background
 * specs.
 */
export { getSocialChannelSpec, getVideoCallBackgroundSpec, OG_SHARE_CARD_SPEC, SOCIAL_CHANNEL_SPECS, staleChannelSpecEntries, VIDEO_CALL_BACKGROUND_SPECS } from "./channelSpecs.js";
export type { ChannelImageSpec, ChannelTextLimit, SocialChannelSpec, VideoCallBackgroundSpec } from "./channelSpecs.js";

export { PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS, PITCH_DECK_SLIDE_ORDER } from "./deckTemplate.js";

export { buildEmailSignatureHtml, buildEmailSignatureText } from "./emailSignature.js";
export type { EmailSignatureLink, EmailSignaturePerson } from "./emailSignature.js";

export { COMPANY_OVERVIEW_TEMPLATES, overviewSectionIds } from "./overviewTemplate.js";
export type { CompanyOverviewLength } from "./overviewTemplate.js";

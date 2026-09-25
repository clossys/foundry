import type { ComposeDocument } from "../core/index.js";
import type { EmailSignatureLink, EmailSignaturePerson } from "../templates/emailSignature.js";
import { previewCopyString } from "./fixture-copy-registry.js";

/**
 * Fixture `ComposeDocument`s for the email kit's two rendered-through-
 * `renderEmailDocument` templates (#1207: "launch announcement,
 * welcome/follow-up"). No `layout`/`flow` is supplied — the same "no real
 * positioned template, let `renderEmailDocument` build one from binding
 * order" path `../email/internal/geometry.ts`'s `buildSyntheticLayout`
 * documents — so every binding below is a plain vertical row, in binding
 * order, exactly like the two other emails in this file. Prose comes from
 * `fixture-copy-registry.ts` by id.
 */
function emailDoc(id: string, copyPrefix: string): ComposeDocument {
  return {
    id,
    channel: "email",
    template: "launch-pack-email",
    meta: {
      channel: "email",
      subject: previewCopyString(`${copyPrefix}.subject`),
      preheader: previewCopyString(`${copyPrefix}.preheader`),
    },
    bindings: [
      { slot: "heading", copyId: `${copyPrefix}.heading` },
      { slot: "body", copyId: `${copyPrefix}.body` },
      { slot: "cta", copyId: `${copyPrefix}.cta` },
    ],
  };
}

export const LAUNCH_ANNOUNCEMENT_EMAIL: ComposeDocument = emailDoc("publisher-preview-email-launch", "preview.email.launch");
export const WELCOME_EMAIL: ComposeDocument = emailDoc("publisher-preview-email-welcome", "preview.email.welcome");
export const FOLLOW_UP_EMAIL: ComposeDocument = emailDoc("publisher-preview-email-followup", "preview.email.followup");

/**
 * Fixture signature person (#1207: "a signature per person"). Every field
 * is a plain string (`buildEmailSignatureHtml`/`Text`'s own contract — see
 * `templates/emailSignature.ts`), so it is read from the registry here at
 * fixture-build time rather than resolved as a `copyId` at render time; no
 * `logoUrl` is set, since this preview does not stage a real image asset.
 */
export function buildSignaturePerson(): EmailSignaturePerson {
  const links: EmailSignatureLink[] = [
    { label: previewCopyString("preview.email.signature.link.site.label"), href: "https://example.com" },
    { label: previewCopyString("preview.email.signature.link.social.label"), href: "https://example.com/social" },
  ];
  return {
    name: previewCopyString("preview.email.signature.name"),
    role: previewCopyString("preview.email.signature.role"),
    company: previewCopyString("preview.email.signature.company"),
    links,
  };
}

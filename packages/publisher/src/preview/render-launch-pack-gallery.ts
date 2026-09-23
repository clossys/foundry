/**
 * The Launch-pack preview (issue #1204/#1207/#1208's own "off-the-shelf
 * boilerplate views a user relies on until they build custom views"): every
 * shipped view `publisher-preview`'s `gallery.html` already renders, PLUS
 * the site template's own routes, the materials mini-site (company
 * overviews and the pitch deck), the email kit, and every share/social
 * card the channel-spec registry declares — all rendered from the SAME
 * `<brand.css>` input `render-preview-gallery.ts` already validates, all
 * deterministic, no network calls, and every string of prose read from
 * `fixture-copy-registry.ts` by id (never typed in this file — see that
 * registry's own top comment).
 *
 * OUTPUT SHAPE: ONE FLAT DIRECTORY, LISTED BY `index.html`
 * -----------------------------------------------------------
 * Every file this module writes lands directly in the output directory
 * (no subdirectories) — the same flat layout `gallery.html`/`guide.html`/
 * `audit.html` already use. `buildLaunchPackIndexHtml` links every one of
 * them, grouped by section, so a user can open `index.html` once and reach
 * everything from there.
 *
 * WHAT CANNOT BE STATICALLY RENDERED
 * ---------------------------------------
 * `templates/site/app/robots.ts` and `templates/site/app/sitemap.ts` are Next.js metadata
 * ROUTE HANDLERS (they export a function Next calls to produce
 * `robots.txt`/`sitemap.xml`, not a page component) — there is no view or
 * markup to render for either, so neither appears in this gallery. Every
 * other route in `templates/site/web-route-manifest.json`, plus
 * `templates/site/app/not-found.tsx`, IS rendered here — see `fixture-site.ts`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { renderImageDocument } from "../image/renderImageDocument.js";
import { renderEmailDocument } from "../email/renderEmailDocument.js";
import { renderSlidesDeck } from "../slides/renderSlidesDeck.js";
import { renderPitchDeckHtml } from "../materials/deckHtml.js";
import { renderMaterialsIndexHtml } from "../materials/siteIndex.js";
import { selectAudienceVariant } from "../materials/audienceVariant.js";
import { buildEmailSignatureHtml, buildEmailSignatureText } from "../templates/emailSignature.js";
import { renderWebDocument } from "../web/renderWebDocument.js";
import { DocumentView } from "../web/views/DocumentView.js";
import { previewCopyLookup, previewCopyString } from "./fixture-copy-registry.js";
import { PREVIEW_BRAND_LABEL, previewCopyResolver } from "./fixture-documents.js";
import { SITE_PAGE_FIXTURES, buildNotFoundElement } from "./fixture-site.js";
import { COMPANY_OVERVIEW_LENGTHS, PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS, buildMaterialsIndexEntries, buildOverviewDocument, buildPitchDeck } from "./fixture-materials.js";
import { FOLLOW_UP_EMAIL, LAUNCH_ANNOUNCEMENT_EMAIL, WELCOME_EMAIL, buildSignaturePerson } from "./fixture-email.js";
import { buildCardFixtures } from "./fixture-cards.js";

const DESIGNER_TOKENS_BASENAME = "designer-tokens.css";
const DESIGNER_COMPILED_BASENAME = "designer-compiled.css";
const BRAND_COPY_BASENAME = "brand.css";

export const LAUNCH_PACK_INDEX_FILENAME = "index.html";

/** One file this module writes, in the exact order `writeLaunchPackGallery` emits it. */
export interface LaunchPackFile {
  file: string;
  content: string;
}

/** One section of the index page — a heading plus every file it links. */
export interface LaunchPackSection {
  heading: string;
  description: string;
  links: Array<{ file: string; label: string }>;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text);
}

/** Wraps one rendered view's markup as a full, standalone, brand-bound page — the same three stylesheet links `gallery.html` itself uses. */
function wrapStandalonePage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-brand-bound>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${DESIGNER_TOKENS_BASENAME}" />
  <link rel="stylesheet" href="${DESIGNER_COMPILED_BASENAME}" />
  <link rel="stylesheet" href="${BRAND_COPY_BASENAME}" />
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: var(--color-surface-base, #f5f5f5); }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

/** An email-width (600px) frame — the conventional email-client reading width — so an already-complete, self-contained email HTML document previews the way it will actually be read, without its own `<html>`/inline styles colliding with this gallery page's own. */
function wrapEmailFramePage(title: string, emailHtml: string, plainText: string): string {
  const body = `<main style="max-width: 640px; margin: 0 auto; padding: 2rem 1.5rem 4rem; display: flex; flex-direction: column; gap: 1.5rem;">
  <h1 style="font-size: 1.125rem; margin: 0;">${escapeHtml(title)}</h1>
  <iframe title="${escapeAttribute(title)}" srcdoc="${escapeAttribute(emailHtml)}" style="width: 600px; max-width: 100%; height: 720px; border: 1px solid #ddd; border-radius: 0.5rem; background: #fff;"></iframe>
  <details>
    <summary>Plain-text alternative</summary>
    <pre style="white-space: pre-wrap; font: 13px/1.5 ui-monospace, monospace;">${escapeHtml(plainText)}</pre>
  </details>
</main>`;
  return wrapStandalonePage(title, body);
}

// ---------------------------------------------------------------------------
// Site pages
// ---------------------------------------------------------------------------

export function renderSitePages(): LaunchPackFile[] {
  const files: LaunchPackFile[] = SITE_PAGE_FIXTURES.map((fixture) => {
    const { element } = renderWebDocument(fixture.document, { groups: fixture.groups, resolveCopyId: previewCopyLookup });
    const markup = renderToStaticMarkup(element);
    return { file: `site-${fixture.slug}.html`, content: wrapStandalonePage(`Site — ${fixture.slug}`, markup) };
  });
  const notFoundMarkup = renderToStaticMarkup(buildNotFoundElement());
  files.push({ file: "site-not-found.html", content: wrapStandalonePage("Site — not-found", notFoundMarkup) });
  return files;
}

// ---------------------------------------------------------------------------
// Materials: company overviews + pitch deck
// ---------------------------------------------------------------------------

export function renderMaterialsSection(tokenOverrides: Record<string, string>): LaunchPackFile[] {
  const files: LaunchPackFile[] = [];

  for (const length of COMPANY_OVERVIEW_LENGTHS) {
    const document = buildOverviewDocument(length);
    const markup = renderToStaticMarkup(
      createElement(DocumentView, {
        brand: PREVIEW_BRAND_LABEL,
        document,
        resolveCopyId: previewCopyResolver,
      }),
    );
    const title = previewCopyString(`preview.overview.title.${length}`);
    files.push({
      file: `materials-overview-${length}.html`,
      content: wrapStandalonePage(title, `<p style="max-width: var(--ui-width-prose-max, 48rem); margin: 1rem auto 0; padding: 0 1.5rem;"><a href="materials-index.html">&larr; Materials index</a></p>\n${markup}`),
    });
  }

  const deck = buildPitchDeck();
  const deckResult = renderSlidesDeck(deck, { resolveCopyId: previewCopyLookup, tokenOverrides });
  files.push({ file: "materials-pitch-deck.html", content: renderPitchDeckHtml(deckResult, { title: previewCopyString("preview.deck.title") }) });

  // "partner" (rather than "investor") is the audience this fixture demos:
  // `PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS` marks "financials"/"ask" as
  // investor/board-only, so an "investor" variant would keep every slide —
  // not a visibly different deck. "partner" is excluded from "financials"
  // and "ask" (only "business-model" includes it), so this variant
  // actually demonstrates `selectAudienceVariant`'s own filtering.
  const partnerDeck = selectAudienceVariant(deck, PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS, "partner");
  const partnerResult = renderSlidesDeck(partnerDeck, { resolveCopyId: previewCopyLookup, tokenOverrides });
  files.push({
    file: "materials-pitch-deck-partner.html",
    content: renderPitchDeckHtml(partnerResult, { title: previewCopyString("preview.deck.title"), audience: "Partner" }),
  });

  // The deck pages above are already complete, self-contained HTML
  // documents (`renderPitchDeckHtml`'s own doc comment) and are left
  // exactly as that function produced them — no `wrapStandalonePage`,
  // which would nest a second `<html>` document inside the first.
  const indexEntries = buildMaterialsIndexEntries();
  files.push({ file: "materials-index.html", content: renderMaterialsIndexHtml(indexEntries) });

  return files;
}

// ---------------------------------------------------------------------------
// Email kit
// ---------------------------------------------------------------------------

export function renderEmailSection(tokenOverrides: Record<string, string>): LaunchPackFile[] {
  const files: LaunchPackFile[] = [];

  const emailEntries: Array<{ file: string; title: string; doc: typeof LAUNCH_ANNOUNCEMENT_EMAIL }> = [
    { file: "email-launch-announcement.html", title: "Email — launch announcement", doc: LAUNCH_ANNOUNCEMENT_EMAIL },
    { file: "email-welcome.html", title: "Email — welcome", doc: WELCOME_EMAIL },
    { file: "email-follow-up.html", title: "Email — follow-up", doc: FOLLOW_UP_EMAIL },
  ];
  for (const entry of emailEntries) {
    const result = renderEmailDocument(entry.doc, { lookup: previewCopyLookup, brand: tokenOverrides });
    files.push({ file: entry.file, content: wrapEmailFramePage(entry.title, result.html, result.text) });
  }

  const person = buildSignaturePerson();
  const signatureHtml = buildEmailSignatureHtml(person);
  const signatureText = buildEmailSignatureText(person);
  files.push({
    file: "email-signature.html",
    content: wrapStandalonePage(
      "Email — signature",
      `<main style="max-width: 640px; margin: 0 auto; padding: 2rem 1.5rem 4rem; display: flex; flex-direction: column; gap: 1.5rem;">
  <h1 style="font-size: 1.125rem; margin: 0;">Email — signature</h1>
  <div style="border: 1px solid #ddd; border-radius: 0.5rem; padding: 1rem; background: #fff;">${signatureHtml}</div>
  <details>
    <summary>Plain-text alternative</summary>
    <pre style="white-space: pre-wrap; font: 13px/1.5 ui-monospace, monospace;">${escapeHtml(signatureText)}</pre>
  </details>
</main>`,
    ),
  });

  return files;
}

// ---------------------------------------------------------------------------
// Share and social cards
// ---------------------------------------------------------------------------

/** One rendered card, its filename, and its real pixel size (for `index.html`'s link label — see `buildLaunchPackIndexHtml`). */
export interface CardFile extends LaunchPackFile {
  label: string;
}

/**
 * Renders every card straight to its own standalone `.svg` file — a
 * browser opens an `.svg` file natively, so this section needs no
 * per-card HTML wrapper page the way the other sections do. `index.html`
 * (see `buildLaunchPackIndexHtml`) links every one of these files
 * directly, by filename, rather than through an intermediate index page —
 * "the index links every file written" holds for cards the same way it
 * holds for every other section.
 */
export function renderCardsSection(tokenOverrides: Record<string, string>): CardFile[] {
  const fixtures = buildCardFixtures();
  return fixtures.map((fixture) => {
    const result = renderImageDocument(fixture.document, { resolveCopyId: previewCopyLookup, tokenOverrides });
    const meta = fixture.document.meta as { width: number; height: number };
    return { file: fixture.file, content: result.svg, label: `${fixture.document.id} (${meta.width}×${meta.height})` };
  });
}

// ---------------------------------------------------------------------------
// index.html — links every file written
// ---------------------------------------------------------------------------

export function buildLaunchPackIndexHtml(sections: LaunchPackSection[]): string {
  const sectionsHtml = sections
    .map(
      (section) => `<section style="display: flex; flex-direction: column; gap: 0.75rem; border-top: 1px solid #ddd; padding-top: 1.5rem;">
  <h2 style="margin: 0; font-size: 1.125rem;">${escapeHtml(section.heading)}</h2>
  <p style="margin: 0; color: #444;">${escapeHtml(section.description)}</p>
  <ul style="margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.25rem;">
${section.links.map((link) => `    <li><a href="${escapeAttribute(link.file)}">${escapeHtml(link.label)}</a></li>`).join("\n")}
  </ul>
</section>`,
    )
    .join("\n");

  return wrapStandalonePage(
    "Launch pack preview",
    `<main style="max-width: 60rem; margin: 0 auto; padding: 2rem 1.5rem 4rem; display: flex; flex-direction: column; gap: 2rem;">
  <header>
    <h1 style="margin: 0 0 0.5rem;">Launch pack preview</h1>
    <p style="margin: 0; color: #444;">Every off-the-shelf boilerplate view, rendered against your brand.css.</p>
  </header>
${sectionsHtml}
</main>`,
  );
}

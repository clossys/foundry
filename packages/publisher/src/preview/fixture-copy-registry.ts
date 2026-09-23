import type { CopyRegistry } from "@clossys/writer";

/**
 * Approved placeholder copy for `publisher-preview` fixtures only. Same
 * `CopyRegistry` shape Writer's render path expects; not a consumer store.
 */
const FIXTURE_COPY: Record<string, string> = {
  "preview.sectioned.hero.eyebrow": "New",
  "preview.sectioned.hero.heading": "A placeholder home page",
  "preview.sectioned.hero.description": "Fixture description.",
  "preview.sectioned.features.heading": "Features",
  "preview.sectioned.features.description": "Feature fixture.",
  "preview.sectioned.features.one.heading": "First feature",
  "preview.sectioned.features.one.description": "First feature description.",
  "preview.sectioned.features.two.heading": "Second feature",
  "preview.sectioned.faq.heading": "Questions",
  "preview.sectioned.faq.description": "FAQ fixture.",
  "preview.sectioned.faq.one.question": "Why this?",
  "preview.sectioned.faq.one.answer": "Because it is validated.",
  "preview.sectioned.steps.heading": "Steps",
  "preview.sectioned.steps.one.ordinal": "1",
  "preview.sectioned.steps.one.label": "First",
  "preview.sectioned.steps.one.heading": "Start here",
  "preview.sectioned.steps.one.description": "Start fixture.",
  "preview.sectioned.status.heading": "Readiness",
  "preview.sectioned.status.available": "Available",
  "preview.sectioned.status.partial": "Partial",
  "preview.sectioned.status.planned": "Planned",
  "preview.sectioned.status.not-offered": "Not offered",
  "preview.sectioned.status.group.heading": "Core",
  "preview.sectioned.status.item.label": "Fixture capability",
  "preview.sectioned.stats.heading": "Metrics",
  "preview.sectioned.stats.one.label": "Active users",
  "preview.sectioned.stats.one.value": "2,481",
  "preview.sectioned.stats.one.delta": "+12%",
  "preview.sectioned.pricing.eyebrow": "Plans",
  "preview.sectioned.pricing.heading": "Pricing",
  "preview.sectioned.pricing.description": "Fixture pricing.",
  "preview.sectioned.pricing.tier.name": "Team",
  "preview.sectioned.pricing.tier.price": "$12",
  "preview.sectioned.pricing.tier.feature": "Unlimited seats",
  "preview.sectioned.pricing.tier.cta": "Start trial",
  "preview.sectioned.testimonial.heading": "Proof",
  "preview.sectioned.testimonial.quote": "It just works.",
  "preview.sectioned.testimonial.name": "Fixture Author",
  "preview.sectioned.testimonial.role": "Customer",
  "preview.sectioned.stat.heading": "Outcomes",
  "preview.sectioned.stat.label": "Uptime",
  "preview.sectioned.stat.value": "99.9%",
  "preview.sectioned.stat.delta": "+0.1%",
  "preview.document.title": "Privacy notice",
  "preview.document.summary": "How this fixture handles data.",
  "preview.document.date": "Effective today",
  "preview.document.section": "Details",
  "preview.document.body": "Fixture body.",

  // -------------------------------------------------------------------
  // Launch pack (issue #1204/#1207/#1208) — the site template's own
  // routes, rendered through the shipped MarketingView/ErrorView
  // template exactly as `templates/site` calls them. See
  // `fixture-site.ts`.
  // -------------------------------------------------------------------
  "preview.site.home.hero.eyebrow": "Now live",
  "preview.site.home.hero.heading": "Everything your launch needs, out of the box",
  "preview.site.home.hero.description": "A branded materials kit, ready before your first customer call.",
  "preview.site.home.features.heading": "What ships on day one",
  "preview.site.home.features.one.heading": "A branded site",
  "preview.site.home.features.one.description": "Home, about, contact, privacy, and terms — wired to your brand from the first commit.",
  "preview.site.home.features.two.heading": "A materials kit",
  "preview.site.home.features.two.description": "Overviews, a pitch deck, and share cards, all from one source.",
  "preview.site.home.faq.question": "Can this be customized later?",
  "preview.site.home.faq.answer": "Yes — every view here is a starting point, not a lock-in.",
  "preview.site.home.cta.heading": "Ready to launch?",
  "preview.site.home.cta.description": "Everything above ships branded, from day one.",
  "preview.site.home.meta.title": "Home",
  "preview.site.home.meta.description": "The default landing page shipped by the launch pack.",

  "preview.site.about.hero.eyebrow": "About",
  "preview.site.about.hero.heading": "Built by a small, focused team",
  "preview.site.about.hero.description": "We build the tools we wished we had.",
  "preview.site.about.cta.heading": "Get in touch",
  "preview.site.about.cta.description": "We read every message.",
  "preview.site.about.meta.title": "About",
  "preview.site.about.meta.description": "Who is behind this product.",

  "preview.site.contact.hero.eyebrow": "Contact",
  "preview.site.contact.hero.heading": "Talk to us",
  "preview.site.contact.hero.description": "Send a note and we reply within one business day.",
  "preview.site.contact.cta.heading": "Prefer email?",
  "preview.site.contact.cta.description": "Reach us directly and we will follow up.",
  "preview.site.contact.meta.title": "Contact",
  "preview.site.contact.meta.description": "How to reach the team.",

  "preview.site.privacy.hero.eyebrow": "Legal",
  "preview.site.privacy.hero.heading": "Privacy notice",
  "preview.site.privacy.hero.description": "How this fixture product collects, uses, and protects data.",
  "preview.site.privacy.cta.heading": "Questions about your data?",
  "preview.site.privacy.cta.description": "Contact us any time.",
  "preview.site.privacy.meta.title": "Privacy",
  "preview.site.privacy.meta.description": "The product's privacy notice.",

  "preview.site.terms.hero.eyebrow": "Legal",
  "preview.site.terms.hero.heading": "Terms of service",
  "preview.site.terms.hero.description": "The terms that govern use of this fixture product.",
  "preview.site.terms.cta.heading": "Questions about these terms?",
  "preview.site.terms.cta.description": "Contact us any time.",
  "preview.site.terms.meta.title": "Terms",
  "preview.site.terms.meta.description": "The product's terms of service.",

  "preview.site.not-found.title": "Page not found",
  "preview.site.not-found.description": "The page you are looking for does not exist or has moved.",
  "preview.site.not-found.action": "Back to home",

  // -------------------------------------------------------------------
  // Launch pack — company overview sections, keyed by
  // `COMPANY_OVERVIEW_TEMPLATES`' own section ids. See `fixture-materials.ts`.
  // -------------------------------------------------------------------
  "preview.overview.title.short": "Company overview — short",
  "preview.overview.title.medium": "Company overview — medium",
  "preview.overview.title.long": "Company overview — long",
  "preview.overview.one-liner.heading": "One-liner",
  "preview.overview.one-liner.body": "A branded launch pack, ready before your first customer call.",
  "preview.overview.problem.heading": "Problem",
  "preview.overview.problem.body": "Founders assemble a site, a deck, and a materials kit by hand, from scratch, every time.",
  "preview.overview.solution.heading": "Solution",
  "preview.overview.solution.body": "One brand file drives a site, a deck, company overviews, an email kit, and share cards.",
  "preview.overview.market.heading": "Market",
  "preview.overview.market.body": "Every founder preparing to launch needs this once, and needs it fast.",
  "preview.overview.product.heading": "Product",
  "preview.overview.product.body": "A single CLI renders every off-the-shelf view against your brand, deterministically.",
  "preview.overview.traction.heading": "Traction",
  "preview.overview.traction.body": "Fixture traction metric — a placeholder a real deployment would replace.",
  "preview.overview.business-model.heading": "Business model",
  "preview.overview.business-model.body": "Fixture business-model description for the preview gallery only.",
  "preview.overview.team.heading": "Team",
  "preview.overview.team.body": "Fixture team description for the preview gallery only.",
  "preview.overview.roadmap.heading": "Roadmap",
  "preview.overview.roadmap.body": "Fixture roadmap description for the preview gallery only.",
  "preview.overview.call-to-action.heading": "Get in touch",
  "preview.overview.call-to-action.body": "Let's talk about your launch.",

  // -------------------------------------------------------------------
  // Launch pack — pitch deck slides, keyed by `PITCH_DECK_SLIDE_ORDER`'s
  // own slide ids. See `fixture-materials.ts`.
  // -------------------------------------------------------------------
  "preview.deck.title": "Pitch deck",
  "preview.deck.cover.heading": "Fixture Co.",
  "preview.deck.cover.body": "A placeholder pitch deck for the preview gallery.",
  "preview.deck.problem.heading": "Problem",
  "preview.deck.problem.body": "Founders assemble launch materials by hand, every time.",
  "preview.deck.solution.heading": "Solution",
  "preview.deck.solution.body": "One brand file, every launch view, rendered deterministically.",
  "preview.deck.market.heading": "Market",
  "preview.deck.market.body": "Every founder preparing to launch needs this.",
  "preview.deck.product.heading": "Product",
  "preview.deck.product.body": "A CLI, a brand file, and a browsable gallery.",
  "preview.deck.traction.heading": "Traction",
  "preview.deck.traction.body": "Fixture traction metric.",
  "preview.deck.business-model.heading": "Business model",
  "preview.deck.business-model.body": "Fixture business-model slide.",
  "preview.deck.competition.heading": "Competition",
  "preview.deck.competition.body": "Fixture competitive-landscape slide.",
  "preview.deck.team.heading": "Team",
  "preview.deck.team.body": "Fixture team slide.",
  "preview.deck.financials.heading": "Financials",
  "preview.deck.financials.body": "Fixture financials slide — investor and board audiences only.",
  "preview.deck.ask.heading": "Ask",
  "preview.deck.ask.body": "Fixture ask slide — investor audience only.",
  "preview.deck.close.heading": "Thank you",
  "preview.deck.close.body": "Fixture closing slide.",

  // -------------------------------------------------------------------
  // Launch pack — materials index entry titles. See `fixture-materials.ts`.
  // -------------------------------------------------------------------
  "preview.materials.index.overview-short.title": "Company overview — short",
  "preview.materials.index.overview-medium.title": "Company overview — medium",
  "preview.materials.index.overview-long.title": "Company overview — long",
  "preview.materials.index.pitch-deck.title": "Pitch deck",
  "preview.materials.index.pitch-deck-partner.title": "Pitch deck — partner variant",

  // -------------------------------------------------------------------
  // Launch pack — email kit (launch announcement, welcome, follow-up,
  // signature). See `fixture-email.ts`.
  // -------------------------------------------------------------------
  "preview.email.launch.subject": "We're live",
  "preview.email.launch.preheader": "The launch pack is ready.",
  "preview.email.launch.heading": "We're live",
  "preview.email.launch.body": "Everything in this kit is ready to send, branded, today.",
  "preview.email.launch.cta": "See what's new",
  "preview.email.welcome.subject": "Welcome aboard",
  "preview.email.welcome.preheader": "Here's how to get started.",
  "preview.email.welcome.heading": "Welcome aboard",
  "preview.email.welcome.body": "Thanks for joining — here is how to get started.",
  "preview.email.welcome.cta": "Get started",
  "preview.email.followup.subject": "Still there?",
  "preview.email.followup.preheader": "A quick follow-up.",
  "preview.email.followup.heading": "Just checking in",
  "preview.email.followup.body": "Following up in case you had questions.",
  "preview.email.followup.cta": "Reply now",
  "preview.email.signature.name": "Jordan Rivera",
  "preview.email.signature.role": "Founder",
  "preview.email.signature.company": "Fixture Co.",
  "preview.email.signature.link.site.label": "Website",
  "preview.email.signature.link.social.label": "Follow us",

  // -------------------------------------------------------------------
  // Launch pack — share/social cards and video-call backgrounds. See
  // `fixture-cards.ts`.
  // -------------------------------------------------------------------
  "preview.card.eyebrow": "Fixture Co.",
  "preview.card.heading": "Build faster, launch sooner",
  "preview.card.videocall.heading": "Fixture Co.",
};

export const PREVIEW_FIXTURE_COPY_REGISTRY: CopyRegistry = {
  id: "publisher-preview-fixtures",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "packages/publisher/src/preview/fixture-copy-registry" },
  entries: Object.entries(FIXTURE_COPY).map(([id, text]) => ({
    id,
    text,
    context: "publisher-preview fixture",
    status: "approved",
  })),
};

/**
 * The `CopyLookup` shape (`(copyId: string) => string | undefined`) that
 * `@clossys/publisher/image`, `/slides`, and `/email` take — a plain
 * string-keyed lookup, distinct from `@clossys/writer`'s ref-based
 * `CopyResolver` (`previewCopyResolver`, above) that `/web`'s
 * `DocumentView`/`SectionedView` take. Same one `FIXTURE_COPY` map either
 * way; this is just the other shape a caller needs it in.
 */
export const previewCopyLookup = (copyId: string): string | undefined => FIXTURE_COPY[copyId];

/**
 * Reads one fixture-copy entry as a plain string, for the fixture-building
 * code paths (a `ComposeDocument`'s `meta.title`, a `MaterialsIndexEntry`'s
 * `title`, an `EmailSignaturePerson`'s `name`, an `ImageMeta`'s `alt`, …)
 * whose target type is a literal `string`, never a `CopyRef` — so there is
 * no `copyId` binding for a renderer to resolve, and the ONLY way to keep
 * that literal out of the renderer itself (this package's own "no
 * hardcoded prose in renderers" rule) is to read it from this same
 * registry at the point the fixture object is built. Throws on a missing
 * id — a preview fixture referencing an id this registry doesn't have is a
 * bug in the fixture, not a value that should silently become `undefined`
 * prose downstream.
 */
export function previewCopyString(id: string): string {
  const text = FIXTURE_COPY[id];
  if (text === undefined) {
    throw new Error(`fixture-copy-registry: no entry for copy id "${id}"`);
  }
  return text;
}

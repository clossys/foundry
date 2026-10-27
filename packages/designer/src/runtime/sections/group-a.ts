/**
 * Group-a Section runtime renderers, keyed by contract leaf. Each renderer turns the assembly's resolved
 * content and selected members into its real registered block; `GROUP_A_SECTION_INPUTS` names the content
 * slots and members each one reads, which are exactly its generated fill's slotMap and propMap keys. The
 * aggregate renderer table and the runtime manifest's renderer descriptors are assembled elsewhere.
 */
import type { SectionRenderer, SectionRendererInputs } from "./group-a-content.js";
import { articleInputs, renderArticleSection } from "./article.js";
import { bandInputs, renderBandSection } from "./band.js";
import { callToActionInputs, renderCallToActionSection } from "./call-to-action.js";
import { comparisonInputs, renderComparisonSection } from "./comparison.js";
import { contentInputs, renderContentSection } from "./content.js";
import { faqInputs, renderFaqSection } from "./faq.js";
import { featuresInputs, renderFeaturesSection } from "./features.js";
import { galleryInputs, renderGallerySection } from "./gallery.js";
import { heroInputs, renderHeroSection } from "./hero.js";
import { logoCloudInputs, renderLogoCloudSection } from "./logo-cloud.js";
import { mediaInputs, renderMediaSection } from "./media.js";
import { newsletterInputs, renderNewsletterSection } from "./newsletter.js";
import { peopleInputs, renderPeopleSection } from "./people.js";
import { pricingInputs, renderPricingSection } from "./pricing.js";
import { renderTestimonialsSection, testimonialsInputs } from "./testimonials.js";

export const GROUP_A_SECTION_RENDERERS: Readonly<Record<string, SectionRenderer>> = {
  "sections.article": renderArticleSection,
  "sections.band": renderBandSection,
  "sections.call-to-action": renderCallToActionSection,
  "sections.comparison": renderComparisonSection,
  "sections.content": renderContentSection,
  "sections.faq": renderFaqSection,
  "sections.features": renderFeaturesSection,
  "sections.gallery": renderGallerySection,
  "sections.hero": renderHeroSection,
  "sections.logo-cloud": renderLogoCloudSection,
  "sections.media": renderMediaSection,
  "sections.newsletter": renderNewsletterSection,
  "sections.people": renderPeopleSection,
  "sections.pricing": renderPricingSection,
  "sections.testimonials": renderTestimonialsSection,
};

export const GROUP_A_SECTION_INPUTS: Readonly<Record<string, SectionRendererInputs>> = {
  "sections.article": articleInputs,
  "sections.band": bandInputs,
  "sections.call-to-action": callToActionInputs,
  "sections.comparison": comparisonInputs,
  "sections.content": contentInputs,
  "sections.faq": faqInputs,
  "sections.features": featuresInputs,
  "sections.gallery": galleryInputs,
  "sections.hero": heroInputs,
  "sections.logo-cloud": logoCloudInputs,
  "sections.media": mediaInputs,
  "sections.newsletter": newsletterInputs,
  "sections.people": peopleInputs,
  "sections.pricing": pricingInputs,
  "sections.testimonials": testimonialsInputs,
};

/**
 * The contact page's submit path: one memoised handler, built on first use.
 *
 * `submitContact` is what the contact page's server action calls. It builds
 * the handler from the records, the deployment target and the delivery the
 * target allows, keeps it so the limiter's counts persist across requests in
 * this server instance, and never throws: a construction failure is a
 * logged code and an `unavailable` result.
 *
 * Server-only.
 */
import { createProductionDelivery } from "./site-delivery";
import { CONTACT_SUBJECT_ID, requireCopy } from "./site-copy";
import { createSiteCopyResolver, loadBrandFacts, siteTarget } from "./site-records";
import { createContactSubmitter, createSiteContactHandler, selectContactDelivery } from "./site-wiring";

export const submitContact = createContactSubmitter(
  () => {
    const target = siteTarget();
    return createSiteContactHandler({
      target,
      delivery: selectContactDelivery(target, createProductionDelivery),
      contactEmail: loadBrandFacts().contactEmail,
      // The subject of the message that reaches the inbox: approved copy, fixed, and never built from the submission.
      subject: requireCopy(createSiteCopyResolver(target), [CONTACT_SUBJECT_ID])[CONTACT_SUBJECT_ID] as string,
      onUnavailable: (reason) => console.error(`contact-unavailable:${reason}`),
    });
  },
  (code) => console.error(code),
);

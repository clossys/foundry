import pages from "../../../../../writer/src/catalog/records/admin-pages.r1.en.json" with { type: "json" };
import studio from "../../../../../writer/src/catalog/records/admin-studio.r1.en.json" with { type: "json" };
import chat from "../../../../../writer/src/catalog/records/admin-chat.r1.en.json" with { type: "json" };
import arabic from "../../../../../writer/src/catalog/__fixtures__/admin-pages.r1.ar.json" with { type: "json" };
import { prepareAdminPageCopyEnvelopes } from "../admin-copy-source.js";
import { createAdminPageCopy } from "../admin-copy.js";
export { pages, studio, chat, arabic };
export const copyEnvelopes = () => prepareAdminPageCopyEnvelopes([
  { source: "admin-pages.r1.en.json", envelope: pages },
  { source: "admin-studio.r1.en.json", envelope: studio },
  { source: "admin-chat.r1.en.json", envelope: chat },
  { source: "admin-pages.r1.ar.json", envelope: arabic },
]);
export const adminCopyFixture = () => createAdminPageCopy({ locale: "en", envelopes: copyEnvelopes() });

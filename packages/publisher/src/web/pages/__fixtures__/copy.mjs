import pageSource from "../../../../../writer/src/catalog/records/admin-pages.r1.en.json" with { type: "json" };
import studio from "../../../../../writer/src/catalog/records/admin-studio.r1.en.json" with { type: "json" };
import chatSource from "../../../../../writer/src/catalog/records/admin-chat.r1.en.json" with { type: "json" };
import common from "../../../../../writer/src/catalog/records/common-labels.r1.en.json" with { type: "json" };
import paging from "../../../../../writer/src/catalog/records/admin-writer-paging.r1.en.json" with { type: "json" };
import signIn from "../../../../../writer/src/catalog/records/sign-in.json" with { type: "json" };
import arabic from "../../../../../writer/src/catalog/__fixtures__/admin-pages.r1.ar.json" with { type: "json" };
import { prepareAdminPageCopyEnvelopes } from "../admin-copy-source.js";
import { createAdminPageCopy } from "../admin-copy.js";
import { ADMIN_COMMON_COPY_EN } from "@clossys/writer/admin-copy";

// The nested sign-in catalog has no route envelope. This fixture projection
// uses its version and the declaring common source's draft-preview metadata;
// the original English records retain their context, status and ownership.
const signInShared = {
  version: signIn.version, revision: common.revision, state: common.state,
  locale: common.locale, activation: common.activation, bindings: [],
  records: signIn.locales[common.locale].records.filter(record => "text" in record
    && common.externalRecords.some(row => row.source === "sign-in.json" && row.recordId === record.id)),
};
const sourceEnvelopes = [
  { source: "admin-pages.r1.en.json", envelope: pageSource },
  { source: "admin-studio.r1.en.json", envelope: studio },
  { source: "admin-chat.r1.en.json", envelope: chatSource },
  { source: "admin-pages.r1.ar.json", envelope: arabic },
  // The Writer facade projects only genuine retained Studio item-name bindings.
  // Raw common records and their sole source owner remain unchanged.
  { source: "common-labels.r1.en.json", envelope: { ...common, bindings: ADMIN_COMMON_COPY_EN.bindings } },
  { source: "admin-writer-paging.r1.en.json", envelope: paging },
  { source: "sign-in.json", envelope: signInShared },
];
const declaredRecords = envelope => (envelope.externalRecords ?? []).map(declaration => {
  const owners = sourceEnvelopes.filter(row => row.source === declaration.source && row.envelope.locale === envelope.locale);
  const matches = owners.flatMap(row => row.envelope.records.filter(record => record.id === declaration.recordId && record.context === declaration.sourceContext));
  if (owners.length !== 1 || matches.length !== 1) throw new Error(`Invalid fixture copy source: ${declaration.recordId}`);
  return matches[0];
});
declaredRecords(common);
// Inspection views include genuine moved records for existing fixture callers.
// Resolution receives only the original owner envelopes, never these views.
export const pages = { ...pageSource, records: [...pageSource.records, ...declaredRecords(pageSource)] };
export const chat = { ...chatSource, records: [...chatSource.records, ...declaredRecords(chatSource)] };
export { studio, arabic };
export const copyEnvelopes = () => prepareAdminPageCopyEnvelopes(sourceEnvelopes);
export const adminCopyFixture = () => createAdminPageCopy({ locale: "en", envelopes: copyEnvelopes() });

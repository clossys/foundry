export { createConsumerPageRecords, createConsumerPageRegistry, consumerPageRef, consumerPageColumns, consumerPageStaticContent, checkConsumerPageConfig } from "./admin-page.js";
export type { ConsumerPageConfig, ConsumerPageColumn, ConsumerPageSectionStyle, ConsumerPageNode, ConsumerPageSkeleton, ConsumerPageRecordOptions, ConsumerPageSources, ConsumerPageRegistryOptions } from "./admin-page.js";
export { createAdminPageCopy, writerCopy, adminTechnicalData, resolveAdminPageValue, adminPageContent, bindAdminPageLoaders } from "./admin-copy.js";
export type { AdminPageCopy, AdminPageCopyRef, AdminPageCopyDocument, AdminPageCopyEnvelope, AdminPageCopyProof, ResolvedAdminPageCopy, AdminPageLoaders } from "./admin-copy.js";
export { adminPageChatHost, adminPageSectionHosts, ADMIN_CHAT_LABEL_KEYS } from "./admin-copy-ports.js";
export type { PageCopyPortRefs } from "./admin-copy-ports.js";

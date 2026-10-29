import { createAdminPageRecords, type AdminPageRecordOptions } from "./admin-page.js";
/** Publisher list and item records retain their publication's frame and chat. */
export const createPublisherPageRecords = (options: AdminPageRecordOptions) => createAdminPageRecords("publisher", options);

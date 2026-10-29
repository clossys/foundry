import { createAdminPageRecords, type AdminPageRecordOptions } from "./admin-page.js";
/** Locale-neutral records: empty layers and RTL content are consumer loader data. */
export const createWriterPageRecords = (options: AdminPageRecordOptions) => createAdminPageRecords("writer", options);

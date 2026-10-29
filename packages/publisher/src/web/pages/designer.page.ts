import { createAdminPageRecords, type AdminPageRecordOptions } from "./admin-page.js";
/** Designer list and item records consume catalog loader data through native Sections. */
export const createDesignerPageRecords = (options: AdminPageRecordOptions) => createAdminPageRecords("designer", options);

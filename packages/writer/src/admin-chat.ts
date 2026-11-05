/** English chat display copy for explicit draft review, never approval or activation. */
import source from "./catalog/records/admin-chat.r1.en.json" with { type: "json" };
import { freezeAdminCopy } from "./admin-copy-core.js";
import type { AdminRouteCopy } from "./admin-route-copy.js";

/** Bindings declare intended consumers; importing copy does not mount those consumers. */
export const ADMIN_CHAT_COPY_EN: AdminRouteCopy = freezeAdminCopy(source as AdminRouteCopy);

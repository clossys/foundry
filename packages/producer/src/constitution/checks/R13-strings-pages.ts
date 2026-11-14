/**
 * R13 Strings and pages: not implemented yet. Every check reports one pending row naming its owner unit
 * (W2-D); a pending check is never a pass, so the suite exits non-zero until the owner lands it.
 */
import type { RuleModule } from "../types.js";
import { pending } from "./shared.js";

export const R13: RuleModule = {
  rule: "R13",
  checks: {
    "R13.1": pending("R13", "R13.1", "W2-D", "every visible string is a Writer key"),
    "R13.2": pending("R13", "R13.2", "W2-D", "every page is one frame plus sections"),
    "R13.3": pending("R13", "R13.3", "W2-D", "every page copy key exists in the pinned Writer candidate"),
  },
};

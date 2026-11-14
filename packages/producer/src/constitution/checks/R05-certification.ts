/**
 * R05 Certification: not implemented yet. Every check reports one pending row naming its owner unit
 * (W2-C); a pending check is never a pass, so the suite exits non-zero until the owner lands it.
 */
import type { RuleModule } from "../types.js";
import { pending } from "./shared.js";

export const R05: RuleModule = {
  rule: "R05",
  checks: {
    "R05.1": pending("R05", "R05.1", "W2-C", "every candidate is certified"),
    "R05.2": pending("R05", "R05.2", "W2-C", "pins point only to certified candidates"),
    "R05.3": pending("R05", "R05.3", "W2-C", "no fixture borrowing"),
  },
};

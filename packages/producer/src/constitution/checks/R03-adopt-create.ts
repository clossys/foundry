/**
 * R03 Adopt or create, one certification: not implemented yet. Every check reports one pending row naming its owner unit
 * (W2-C); a pending check is never a pass, so the suite exits non-zero until the owner lands it.
 */
import type { RuleModule } from "../types.js";
import { pending } from "./shared.js";

export const R03: RuleModule = {
  rule: "R03",
  checks: {
    "R03.1": pending("R03", "R03.1", "W2-C", "submit event names a rung"),
    "R03.2": pending("R03", "R03.2", "W2-C", "adopt candidates are verbatim"),
    "R03.3": pending("R03", "R03.3", "W2-C", "one certifier"),
  },
};

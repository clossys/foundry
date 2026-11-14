/**
 * R11 One resolver: not implemented yet. Every check reports one pending row naming its owner unit
 * (W2-D); a pending check is never a pass, so the suite exits non-zero until the owner lands it.
 */
import type { RuleModule } from "../types.js";
import { pending } from "./shared.js";

export const R11: RuleModule = {
  rule: "R11",
  checks: {
    "R11.1": pending("R11", "R11.1", "W2-D", "one reader and one writer of the agent trees"),
    "R11.2": pending("R11", "R11.2", "W2-D", "one citation resolver"),
  },
};

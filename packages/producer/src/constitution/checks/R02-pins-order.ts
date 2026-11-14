/**
 * R02 Pins and order: not implemented yet. Every check reports one pending row naming its owner unit
 * (W2-B); a pending check is never a pass, so the suite exits non-zero until the owner lands it.
 */
import type { RuleModule } from "../types.js";
import { pending } from "./shared.js";

export const R02: RuleModule = {
  rule: "R02",
  checks: {
    "R02.1": pending("R02", "R02.1", "W2-B", "pin basis and decidedBy in the closed lists"),
    "R02.2": pending("R02", "R02.2", "W2-B", "upstream pinned before downstream"),
    "R02.3": pending("R02", "R02.3", "W2-B", "each pin equals its last ledger pin event"),
  },
};

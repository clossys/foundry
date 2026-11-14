/**
 * R12 Deterministic build: not implemented yet. Every check reports one pending row naming its owner unit
 * (W2-D); a pending check is never a pass, so the suite exits non-zero until the owner lands it.
 */
import type { RuleModule } from "../types.js";
import { pending } from "./shared.js";

export const R12: RuleModule = {
  rule: "R12",
  checks: {
    "R12.1": pending("R12", "R12.1", "W2-D", "compile.lock.json pin-set hash is current"),
    "R12.2": pending("R12", "R12.2", "W2-D", "compile is pure"),
    "R12.3": pending("R12", "R12.3", "W2-D", "build twice is byte-identical"),
  },
};

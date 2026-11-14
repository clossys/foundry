/**
 * R14 Provenance: not implemented yet. Every check reports one pending row naming its owner unit
 * (W2-B); a pending check is never a pass, so the suite exits non-zero until the owner lands it.
 */
import type { RuleModule } from "../types.js";
import { pending } from "./shared.js";

export const R14: RuleModule = {
  rule: "R14",
  checks: {
    "R14.1": pending("R14", "R14.1", "W2-B", "every record byte state matches a ledger event"),
    "R14.2": pending("R14", "R14.2", "W2-B", "every event names a verb and an action skill"),
    "R14.3": pending("R14", "R14.3", "W2-B", "LLM events name model and tier"),
  },
};

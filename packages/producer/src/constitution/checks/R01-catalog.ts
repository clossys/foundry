/**
 * R01 Catalog and contract: not implemented yet. Every check reports one pending row naming its owner unit
 * (W2-A); a pending check is never a pass, so the suite exits non-zero until the owner lands it.
 */
import type { RuleModule } from "../types.js";
import { pending } from "./shared.js";

export const R01: RuleModule = {
  rule: "R01",
  checks: {
    "R01.1": pending("R01", "R01.1", "W2-A", "ia.json valid for all five agents"),
    "R01.2": pending("R01", "R01.2", "W2-A", "every live slot has a valid slot.json and contract"),
    "R01.3": pending("R01", "R01.3", "W2-A", "every contract carries a fixture"),
    "R01.4": pending("R01", "R01.4", "W2-A", "agent tree holds only live slots, tombstones, requests/, ledger.json, policy.json"),
    "R01.5": pending("R01", "R01.5", "W2-A", "live slots are Foundry-placed leaves or listed extensions"),
    "R01.6": pending("R01", "R01.6", "W2-A", "no two live slots share a contract"),
  },
};

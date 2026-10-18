import { validateBlockRole } from "./index.js";
import type { BlockRole, BlockRoleClaim, BlockRoleMedium, BlockRoleDescriptor, BlockRoleAdapterContract, BlockRoleValidationResult, BlockRoleConfigValue, FlowSlotSpec, Channel } from "./index.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Roles = Assert<Equal<BlockRole, "frame" | "view">>;
type Media = Assert<Equal<BlockRoleMedium, Channel | "video">>;
type Status = Assert<Equal<BlockRoleValidationResult["status"], "shape-error" | "qualified" | "unverified" | "unsupported">>;
type Claim = Assert<Equal<Extract<BlockRoleValidationResult, { claim: BlockRoleClaim }>["claim"], BlockRoleClaim>>;
type Qualified = Assert<Equal<Extract<BlockRoleValidationResult, { status: "qualified" }>["descriptor"], BlockRoleDescriptor>>;
type Slot = Assert<Equal<BlockRoleDescriptor["regions"][number]["key"], FlowSlotSpec["key"]>>;
const config: BlockRoleConfigValue = { nested: [true, null, 1, "value"] };
// @ts-expect-error Configs must be JSON data, never executable callbacks.
const callback: BlockRoleConfigValue = () => 1;
// @ts-expect-error Roles are a closed vocabulary.
const unknownRole: BlockRole = "Frame";
// @ts-expect-error Medium does not silently borrow a catalog display label.
const unknownMedium: BlockRoleMedium = "document";
const validate: (input: unknown, adapters: readonly BlockRoleAdapterContract[]) => BlockRoleValidationResult = validateBlockRole;
function narrow(result: BlockRoleValidationResult): string {
  if (result.status === "shape-error") return result.path;
  return result.reasons.join(",");
}
void [config, callback, unknownRole, unknownMedium, validate, narrow];
export type { Roles, Media, Status, Claim, Qualified, Slot };

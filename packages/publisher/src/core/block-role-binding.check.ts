import { validateBlockRoleBinding } from "./index.js";
import type {
  InstanceBlockBinding, BlockRoleBindingIdentity, BlockRoleBindingRefIdentity,
  BlockRoleBindingReason, BlockRoleBindingValidationResult, BlockRoleMedium,
  BlockRoleReason, BlockRoleAdapterContract,
} from "./index.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type FrameRef = Assert<Equal<InstanceBlockBinding["frameBlockRef"]["role"], "frame">>;
type ViewRef = Assert<Equal<InstanceBlockBinding["viewBlockRef"]["role"], "view">>;
type Medium = Assert<Equal<InstanceBlockBinding["context"]["medium"], BlockRoleMedium>>;
type Status = Assert<Equal<BlockRoleBindingValidationResult["status"], "shape-error" | "qualified" | "unverified" | "unsupported">>;
type Scope = Assert<Equal<BlockRoleBindingReason["ref"], "frameBlockRef" | "viewBlockRef" | "pair">>;
type Reason = Assert<Equal<BlockRoleBindingReason["code"], BlockRoleReason | "role-mismatch" | "medium-mismatch" | "web-main">>;
type Identity = Assert<Equal<keyof BlockRoleBindingIdentity, "context" | "frameBlockRef" | "viewBlockRef">>;
type RefIdentity = Assert<Equal<keyof BlockRoleBindingRefIdentity, "blockId" | "role" | "medium" | "adapter" | "configDigest" | "sourceRevision">>;
type Digest = Assert<Equal<BlockRoleBindingRefIdentity["configDigest"], `sha256:${string}`>>;
const validate: (input: unknown, adapters: readonly BlockRoleAdapterContract[]) => BlockRoleBindingValidationResult = validateBlockRoleBinding;
// @ts-expect-error A view cannot occupy the explicit frame ref.
const swapped: InstanceBlockBinding["frameBlockRef"]["role"] = "view";
// @ts-expect-error Status is a closed vocabulary.
const pending: BlockRoleBindingValidationResult["status"] = "pending";
void [validate, swapped, pending];
export type { FrameRef, ViewRef, Medium, Status, Scope, Reason, Identity, RefIdentity, Digest };

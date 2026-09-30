// Compile-time assertions (checked by tsc, never run): no command option, and
// no input of plan, materialize, verify or body, can carry an approval binding. Admission
// computes the binding from the hub (#1178); a caller cannot supply one.

import type { ApplyCommandOptions } from "./apply-plan-cli.js";
import type { BodyInput } from "./body-command.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import type { MaterializeInput, VerifyInput } from "./materialize.js";
import type { PlanCommandOptions } from "./plan-command.js";

const forged = { kind: "approved", subjectDigest: `sha256:${"f".repeat(64)}` } as const;
const set = undefined as unknown as RepositoryChangeSet;

// @ts-expect-error ApplyCommandOptions has no binding key
export const commandOptions: ApplyCommandOptions = { binding: forged };
// @ts-expect-error MaterializeInput has no binding key
export const materializeInput: MaterializeInput = { clone: "", hub: "", set, texts: {}, binding: forged };
// @ts-expect-error VerifyInput has no binding key
export const verifyInput: VerifyInput = { clone: "", hub: "", set, binding: forged };
// @ts-expect-error BodyInput has no binding key
export const bodyInput: BodyInput = { clone: "", hub: "", set, heldChangeSets: [], taskRecord: 1, binding: forged };
// @ts-expect-error PlanCommandOptions has no binding key
export const planOptions: PlanCommandOptions = { binding: forged };
// @ts-expect-error PlanCommandOptions has no approval key
export const planApproval: PlanCommandOptions = { approval: forged };
// @ts-expect-error PlanCommandOptions has no subjectDigest key
export const planSubject: PlanCommandOptions = { subjectDigest: forged.subjectDigest };

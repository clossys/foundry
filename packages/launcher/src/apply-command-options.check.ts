// Compile-time assertions (checked by tsc, never run): no command option, and
// no input of materialize or verify, can carry an approval binding. Admission
// computes the binding from the hub (#1178); a caller cannot supply one.

import type { ApplyCommandOptions } from "./apply-plan-cli.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import type { MaterializeInput, VerifyInput } from "./materialize.js";

const forged = { kind: "approved", subjectDigest: `sha256:${"f".repeat(64)}` } as const;
const set = undefined as unknown as RepositoryChangeSet;

// @ts-expect-error ApplyCommandOptions has no binding key
export const commandOptions: ApplyCommandOptions = { binding: forged };
// @ts-expect-error MaterializeInput has no binding key
export const materializeInput: MaterializeInput = { clone: "", hub: "", set, texts: {}, binding: forged };
// @ts-expect-error VerifyInput has no binding key
export const verifyInput: VerifyInput = { clone: "", hub: "", set, binding: forged };

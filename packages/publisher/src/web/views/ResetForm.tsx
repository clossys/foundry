import { resolveFrontDoorCopy } from "@clossys/writer";
import { createResetForm } from "./internal/createResetForm.js";
export type { ResetFailure, ResetResult, ResetDetails, ResetFormProps } from "./internal/createResetForm.js";

/** Legacy form bound to the strict mutable root registry resolver. */
export const ResetForm = createResetForm(resolveFrontDoorCopy);

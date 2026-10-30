import { resolveFrontDoorCopy } from "@clossys/writer/front-door/strict";
import { createActivateForm } from "./internal/createActivateForm.js";
export type { ActivateFailure, ActivateResult, ActivateDetails, ActivateFormProps } from "./internal/createActivateForm.js";

/** Legacy form bound to the strict mutable root registry resolver. */
export const ActivateForm = createActivateForm(resolveFrontDoorCopy);

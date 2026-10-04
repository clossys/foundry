/** Browser forms use immutable package defaults, not consumer approval records. */
import { resolveFrontDoorCopy } from "@clossys/writer/front-door";
import { createSignInForm } from "./views/internal/createSignInForm.js";
import { createActivateForm } from "./views/internal/createActivateForm.js";
import { createResetForm } from "./views/internal/createResetForm.js";
export const SignInForm = createSignInForm(resolveFrontDoorCopy);
export type { SignInFailure, SignInResult, SignInFormProps } from "./views/internal/createSignInForm.js";
export const ActivateForm = createActivateForm(resolveFrontDoorCopy);
export type { ActivateFailure, ActivateResult, ActivateDetails, ActivateFormProps } from "./views/internal/createActivateForm.js";
export const ResetForm = createResetForm(resolveFrontDoorCopy);
export type { ResetFailure, ResetResult, ResetDetails, ResetFormProps } from "./views/internal/createResetForm.js";
export { AuthView } from "./views/AuthView.js";
export type { AuthViewProps } from "./views/AuthView.js";
export { BoundaryView } from "./views/BoundaryView.js";
export type { BoundaryViewProps } from "./views/BoundaryView.js";

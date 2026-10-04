import { resolveFrontDoorCopy } from "@clossys/writer";
import { createSignInForm } from "./internal/createSignInForm.js";
export type { SignInFailure, SignInResult, SignInFormProps } from "./internal/createSignInForm.js";

/** Legacy form bound to the strict mutable root registry resolver. */
export const SignInForm = createSignInForm(resolveFrontDoorCopy);

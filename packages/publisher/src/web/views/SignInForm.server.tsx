import { RenderError } from "../../internal/errors.js";
import type { SignInFormProps } from "./SignInForm.js";

/**
 * React-server stub for SignInForm. The form needs React Aria fields and
 * client state, neither of which can load under the `react-server` condition,
 * so this same-named export exists only to keep both entries' runtime names
 * identical. It imports nothing from React Aria and always throws: render
 * SignInForm from a client module.
 */
export function SignInForm(_props: SignInFormProps): never {
  throw new RenderError("wrong-channel", "SignInForm is a client component and cannot render under react-server; render it from a client module.");
}

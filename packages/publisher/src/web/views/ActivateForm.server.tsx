import { RenderError } from "../../internal/errors.js";
import type { ActivateFormProps } from "./ActivateForm.js";

/**
 * React-server stub for ActivateForm. The form needs React Aria fields and
 * client state, neither of which can load under the `react-server` condition,
 * so this same-named export exists only to keep both entries' runtime names
 * identical. It imports nothing from React Aria and always throws: render
 * ActivateForm from a client module.
 */
export function ActivateForm(_props: ActivateFormProps): never {
  throw new RenderError("wrong-channel", "ActivateForm is a client component and cannot render under react-server; render it from a client module.");
}

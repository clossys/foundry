import { RenderError } from "../../internal/errors.js";
import type { ResetFormProps } from "./ResetForm.js";

/**
 * React-server stub for ResetForm. The form needs React Aria fields and
 * client state, neither of which can load under the `react-server` condition,
 * so this same-named export exists only to keep both entries' runtime names
 * identical. It imports nothing from React Aria and always throws: render
 * ResetForm from a client module.
 */
export function ResetForm(_props: ResetFormProps): never {
  throw new RenderError("wrong-channel", "ResetForm is a client component and cannot render under react-server; render it from a client module.");
}

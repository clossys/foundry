import { RenderError } from "../../internal/errors.js";
import type { ContactViewProps } from "./ContactView.js";

/**
 * React-server stub for ContactView. The form needs React Aria fields and
 * client state, neither of which can load under the `react-server` condition,
 * so this same-named export exists only to keep both entries' runtime names
 * identical. It imports nothing from React Aria and always throws: render
 * ContactView from a client module.
 */
export function ContactView(_props: ContactViewProps): never {
  throw new RenderError("wrong-channel", "ContactView is a client component and cannot render under react-server; render it from a client module.");
}

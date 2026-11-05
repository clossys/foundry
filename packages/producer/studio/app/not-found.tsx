// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { PublishedState } from "../components/StudioPage";

export default function NotFound() {
  return createElement(PublishedState, { state: "not-found" });
}

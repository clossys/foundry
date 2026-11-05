// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
"use client";
import { createElement } from "react";
import { PublishedState } from "../components/StudioPage";

export default function GlobalError() {
  return createElement(PublishedState, { state: "global-error" });
}

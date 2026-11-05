import type { ReactNode } from "react";
import type { SectionGround } from "../section-ground.js";
import { ChromeBare } from "./ChromeBare.js";
import { ChromeBrowser } from "./ChromeBrowser.js";
import { ChromeDevice } from "./ChromeDevice.js";

export type MediaFigureChrome = "browser" | "device" | "bare";

/** Selects token-drawn static chrome around the existing media box. */
export function ChromeSpecimen({ children, chrome, label, ground }: {
  children: ReactNode;
  chrome: MediaFigureChrome;
  label?: ReactNode;
  ground: SectionGround;
}) {
  switch (chrome) {
    case "browser": return <ChromeBrowser label={label} ground={ground}>{children}</ChromeBrowser>;
    case "device": return <ChromeDevice ground={ground}>{children}</ChromeDevice>;
    case "bare": return <ChromeBare>{children}</ChromeBare>;
    default: throw new TypeError("Invalid MediaFigure chrome");
  }
}

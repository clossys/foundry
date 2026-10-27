import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Banner as ClientBanner, type BannerProps } from "./Banner.js";
import { Banner as ServerBanner } from "./Banner.server.js";

/**
 * The client `Banner` (dismiss control is react-aria-components' `Button`) and
 * the server `Banner` (a native `<button>`) render the same region, classes
 * and text. Only the attributes react-aria-components adds to its button
 * (its marker, press marker, tabindex and generated id) may differ. Changing a class or element in one variant fails here until the
 * other follows.
 */
const RAC_BUTTON_ONLY = new Set(["data-rac", "data-react-aria-pressable", "tabindex", "id"]);

/** Markup with the dismiss button's react-aria-components-only attributes removed and every element's attributes sorted. */
function normalised(markup: string): string {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const walk = (node: Element): string => {
    const attrs = node
      .getAttributeNames()
      .filter(name => !(node.tagName === "BUTTON" && RAC_BUTTON_ONLY.has(name)))
      .sort()
      .map(name => `${name}=${JSON.stringify(node.getAttribute(name))}`)
      .join(" ");
    const inner = [...node.childNodes].map(child => (child.nodeType === 1 ? walk(child as Element) : child.textContent ?? "")).join("");
    return `<${node.tagName.toLowerCase()} ${attrs}>${inner}</${node.tagName.toLowerCase()}>`;
  };
  return [...host.children].map(walk).join("");
}

const CASES: Array<[string, BannerProps]> = [
  ["info, no dismiss", { children: "Heads up." }],
  ["danger with dismiss", { variant: "danger", children: "Broke.", onDismiss: () => {} }],
  ["warning with custom label, class and style", { variant: "warning", children: "Careful.", onDismiss: () => {}, dismissLabel: "Hide this update", className: "p-lg", style: { marginTop: "8px" } }],
  ["success with dismiss and id", { variant: "success", children: "Saved.", onDismiss: () => {}, id: "b" }],
  ["compact density with dismiss and style", { density: "compact", children: "Synced.", onDismiss: () => {}, style: { marginTop: "8px" } }],
];

describe("Banner server/client parity", () => {
  it.each(CASES)("renders the same markup in both variants: %s", (_name, props) => {
    expect(normalised(renderToStaticMarkup(<ClientBanner {...props} />))).toBe(normalised(renderToStaticMarkup(<ServerBanner {...props} />)));
  });

  it("differs only by the react-aria-components attributes on the dismiss button", () => {
    const props: BannerProps = { children: "x", onDismiss: () => {} };
    expect(renderToStaticMarkup(<ClientBanner {...props} />)).toContain("data-react-aria-pressable");
    expect(renderToStaticMarkup(<ServerBanner {...props} />)).not.toContain("data-react-aria-pressable");
  });
});

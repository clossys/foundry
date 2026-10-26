// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { StatusView } from "./StatusView.js";
afterEach(cleanup);
const destinations = { label: "Next destinations", items: [{ id: "home", heading: "Home", href: "/" }] };
const pair = () => <><StatusView status="404" routes={destinations} /><StatusView status="403" routes={destinations} /></>;

describe("view link region heading references", () => {
  it("uses separate heading references for equally labelled sibling views", () => {
    render(pair());
    const regions = screen.getAllByRole("region", { name: "Next destinations" });
    expect(regions).toHaveLength(2);
    const ids = regions.map(region => {
      const heading = within(region).getByRole("heading", { level: 2, name: "Next destinations" });
      const targetId = region.getAttribute("aria-labelledby")!;
      const target = region.ownerDocument.getElementById(targetId);
      expect(targetId).not.toBe("");
      expect(target).toContainElement(heading);
      expect(target?.textContent).toBe("Next destinations");
      expect(heading).toHaveClass("text-h3", "font-display", "text-ink-primary");
      // The label reference names the visible h2 itself: the id sits on the heading, not on a wrapper block.
      expect(target).toBe(heading);
      expect(region).not.toHaveAttribute("aria-label");
      return targetId;
    });
    expect(new Set(ids).size).toBe(2);
  });
  it("keeps heading references unique and stable in ordinary server rendering", () => {
    const html = renderToStaticMarkup(pair());
    expect(renderToStaticMarkup(pair())).toBe(html);
    const doc = new JSDOM(html).window.document;
    const regions = [...doc.querySelectorAll("section")];
    expect(regions).toHaveLength(2);
    const ids = regions.map(region => {
      const id = region.getAttribute("aria-labelledby");
      expect(id).toBeTruthy();
      expect(doc.getElementById(id!)?.contains(region.querySelector("h2"))).toBe(true);
      expect(doc.getElementById(id!)?.textContent).toBe("Next destinations");
      expect(region.hasAttribute("aria-label")).toBe(false);
      return id;
    });
    expect(new Set(ids).size).toBe(2);
  });
});

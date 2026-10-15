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
      expect(heading.id).not.toBe("");
      expect(region).toHaveAttribute("aria-labelledby", heading.id);
      expect(region).not.toHaveAttribute("aria-label");
      return heading.id;
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
      expect(region.querySelector("h2")?.id).toBe(id);
      expect(doc.getElementById(id!)?.textContent).toBe("Next destinations");
      expect(region.hasAttribute("aria-label")).toBe(false);
      return id;
    });
    expect(new Set(ids).size).toBe(2);
  });
});

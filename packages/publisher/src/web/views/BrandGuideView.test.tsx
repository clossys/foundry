// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { BrandGuideView } from "./BrandGuideView.js";
import type { BrandGuideViewProps } from "./BrandGuideView.js";

afterEach(cleanup);

function props(over: Partial<BrandGuideViewProps> = {}): BrandGuideViewProps {
  return {
    title: "Marker guide",
    usage: "Marker usage",
    lockupSvg: '<svg role="img" aria-label="Marker lockup"></svg>',
    assets: [{ role: "logo", href: "/logo.svg", label: "Marker logo" }],
    colors: [{ name: "--color-brand", value: "#123456" }],
    type: [{ name: "--font-display", value: "\"Example Sans\", sans-serif" }],
    facts: [{ name: "Marker fact", value: "Marker value" }],
    ...over,
  };
}

describe("BrandGuideView standalone", () => {
  it("keeps its page shape: one main with a PageHeader h1, and sections named by aria-label", () => {
    const { container } = render(<BrandGuideView {...props()} />);
    const main = container.querySelector("main") as HTMLElement;
    expect(main).toBeInTheDocument();
    expect(main.querySelector("h1")?.textContent).toBe("Marker guide");
    expect([...main.querySelectorAll(":scope > section")].map((section) => section.getAttribute("aria-label"))).toEqual([
      "Lockup",
      "Downloads",
      "Color",
      "Type",
      "Strategy facts",
    ]);
    expect(main.querySelectorAll("h4")).toHaveLength(0);
  });

  it("leaves the lockup section out when no lockup is passed", () => {
    const { lockupSvg: _omitted, ...rest } = props();
    const { container } = render(<BrandGuideView {...rest} />);
    expect(container.querySelector('[aria-label="Lockup"]')).toBeNull();
  });

  it("renders an empty list with no entries unless an empty label is passed", () => {
    const bare = render(<BrandGuideView {...props({ colors: [] })} />).container;
    expect(bare.querySelector('[aria-label="Color"] dl')?.children).toHaveLength(0);
    cleanup();
    const labelled = render(<BrandGuideView {...props({ colors: [], emptyLabel: "Marker none" })} />).container;
    expect(within(labelled.querySelector('[aria-label="Color"]') as HTMLElement).getByText("Marker none")).toBeInTheDocument();
  });
});

describe("BrandGuideView embedded", () => {
  it("renders no main and no h1: an h3 title, and a visible h4 naming each section through aria-labelledby", () => {
    const { container } = render(<BrandGuideView {...props({ embedded: true, specimen: { text: "Marker sample", faces: [] } })} />);
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("h3")?.textContent).toBe("Marker guide");
    const headings = [...container.querySelectorAll("h4")];
    expect(headings.map((h4) => h4.textContent)).toEqual(["Lockup", "Downloads", "Color", "Type", "Type specimen", "Strategy facts"]);
    for (const h4 of headings) expect(h4.closest("section")?.getAttribute("aria-labelledby")).toBe(h4.id);
    expect(container.querySelectorAll("section[aria-label]")).toHaveLength(0);
  });
});

describe("BrandGuideView type specimen", () => {
  it("sets the sample text in each face's font family", () => {
    const { container } = render(
      <BrandGuideView {...props({ specimen: { text: "Marker sample", faces: [{ name: "--font-display", value: "\"Example Sans\", sans-serif" }] } })} />,
    );
    const sample = within(container.querySelector('[aria-label="Type specimen"]') as HTMLElement).getByText("Marker sample");
    expect(sample.style.fontFamily).toBe("\"Example Sans\", sans-serif");
  });

  it("drops the font family, and keeps the text, for a value that could leave the declaration", () => {
    for (const value of ["serif; background: url(https://example.test/x)", "var(--font-body)", "serif}"]) {
      const html = renderToStaticMarkup(<BrandGuideView {...props({ specimen: { text: "Marker sample", faces: [{ name: "--font-display", value }] } })} />);
      expect(html, value).toContain("Marker sample");
      expect(html, value).not.toContain("font-family");
      expect(html, value).not.toContain("example.test");
    }
  });

  it("renders no specimen section when none is passed", () => {
    const { container } = render(<BrandGuideView {...props()} />);
    expect(container.querySelector('[aria-label="Type specimen"]')).toBeNull();
  });
});

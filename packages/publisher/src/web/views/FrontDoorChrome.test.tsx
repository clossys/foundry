// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AuthView } from "./AuthView.js";
import { BoundaryView } from "./BoundaryView.js";
import { CaptureView } from "./CaptureView.js";

afterEach(cleanup);

/**
 * The page's landmarks as a browser computes them: a `<header>` or `<footer>`
 * is the banner or contentinfo only as a direct child of the frame, outside
 * `<main>` (the page header block's `<header>` inside `<main>` is not a
 * banner, though testing-library's role query counts it).
 */
function landmarks(container: HTMLElement) {
  const root = container.firstElementChild as HTMLElement;
  return {
    root,
    banners: [...root.children].filter((child) => child.tagName === "HEADER"),
    contentinfos: [...root.children].filter((child) => child.tagName === "FOOTER"),
  };
}

const OWN_HEADER = (
  <header data-testid="own-header">
    <a href="https://example.com/">Own brand</a>
  </header>
);
const OWN_FOOTER = (
  <footer data-testid="own-footer">
    <p>Own footer</p>
  </footer>
);

const VIEWS: ReadonlyArray<{ name: string; render: (extra: { header?: ReactElement | null; footer?: ReactElement | null; mainId?: string }) => ReactElement }> = [
  {
    name: "AuthView",
    render: (extra) => (
      <AuthView
        brand={<span>Designer brand</span>}
        heading="Sign in"
        description="Welcome back."
        form={<p>form</p>}
        footerSecondary={<span>Designer legal</span>}
        {...extra}
      />
    ),
  },
  {
    name: "CaptureView",
    render: (extra) => (
      <CaptureView
        brand={<span>Designer brand</span>}
        heading="Contact"
        form={<p>form</p>}
        footerSecondary={<span>Designer legal</span>}
        {...extra}
      />
    ),
  },
  {
    name: "BoundaryView",
    render: (extra) => (
      <BoundaryView
        brand={<span>Designer brand</span>}
        status={404}
        title="Not found"
        footerSecondary={<span>Designer legal</span>}
        {...extra}
      />
    ),
  },
];

describe.each(VIEWS)("$name header and footer replacement", ({ render: view }) => {
  it("default: renders Designer's header and footer, one banner and one contentinfo", () => {
    const { container } = render(view({}));
    const { root, banners, contentinfos } = landmarks(container);
    expect(banners).toHaveLength(1);
    expect(contentinfos).toHaveLength(1);
    expect(screen.getByText("Designer brand")).toBeInTheDocument();
    expect(screen.getByText("Designer legal")).toBeInTheDocument();
    expect(screen.queryByTestId("own-header")).toBeNull();
    expect([...root.children].map((child) => child.tagName)).toEqual(["HEADER", "MAIN", "FOOTER"]);
  });

  it("header replaces the Designer header entirely: one banner, the consumer's own, first in the frame", () => {
    const { container } = render(view({ header: OWN_HEADER }));
    const { root, banners, contentinfos } = landmarks(container);
    expect(banners).toEqual([screen.getByTestId("own-header")]);
    expect(screen.queryByText("Designer brand")).toBeNull();
    // The footer is untouched.
    expect(contentinfos).toHaveLength(1);
    expect(screen.getByText("Designer legal")).toBeInTheDocument();
    expect([...root.children].map((child) => child.tagName)).toEqual(["HEADER", "MAIN", "FOOTER"]);
    expect(root.firstElementChild).toBe(screen.getByTestId("own-header"));
  });

  it("footer replaces the Designer footer entirely: one contentinfo, the consumer's own, last in the frame", () => {
    const { container } = render(view({ footer: OWN_FOOTER }));
    const { root, banners, contentinfos } = landmarks(container);
    expect(contentinfos).toEqual([screen.getByTestId("own-footer")]);
    expect(screen.queryByText("Designer legal")).toBeNull();
    // The header is untouched.
    expect(banners).toHaveLength(1);
    expect(screen.getByText("Designer brand")).toBeInTheDocument();
    expect(root.lastElementChild).toBe(screen.getByTestId("own-footer"));
  });

  it("both together: only the consumer's chrome, one banner and one contentinfo, one <main>", () => {
    const { container } = render(view({ header: OWN_HEADER, footer: OWN_FOOTER }));
    const { banners, contentinfos } = landmarks(container);
    expect(banners).toEqual([screen.getByTestId("own-header")]);
    expect(contentinfos).toEqual([screen.getByTestId("own-footer")]);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(screen.queryByText("Designer brand")).toBeNull();
    expect(screen.queryByText("Designer legal")).toBeNull();
  });

  it("null renders no banner and no contentinfo (an explicit opt-out, not the default)", () => {
    const { container } = render(view({ header: null, footer: null }));
    const { banners, contentinfos } = landmarks(container);
    expect(banners).toHaveLength(0);
    expect(contentinfos).toHaveLength(0);
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });
});

describe.each(VIEWS)("$name host-set main id", ({ render: view }) => {
  it("unset: <main> carries no id and no tabindex, and the markup matches an explicit undefined", () => {
    const { container } = render(view({}));
    const main = container.querySelector("main") as HTMLElement;
    expect(main.hasAttribute("id")).toBe(false);
    expect(main.hasAttribute("tabindex")).toBe(false);
    const withUndefined = render(view({ mainId: undefined }));
    expect(withUndefined.container.innerHTML).toBe(container.innerHTML);
  });

  it("set: <main> gets the id and tabIndex -1 so a host skip link can target and focus it", () => {
    const { container } = render(view({ mainId: "main-content" }));
    const mains = container.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    const main = mains[0] as HTMLElement;
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(container.ownerDocument.getElementById("main-content")).toBe(main);
  });

  it("set: mainId does not leak onto the outer frame element", () => {
    const { container } = render(view({ mainId: "main-content" }));
    const root = container.firstElementChild as HTMLElement;
    expect(root.hasAttribute("id")).toBe(false);
    expect(root.hasAttribute("mainid")).toBe(false);
    expect(root.hasAttribute("mainId")).toBe(false);
  });

  it("set with a host-owned header: the id still lands on <main>, the landmarks are unchanged", () => {
    const { container } = render(view({ mainId: "main-content", header: OWN_HEADER, footer: OWN_FOOTER }));
    const { root } = landmarks(container);
    expect([...root.children].map((child) => child.tagName)).toEqual(["HEADER", "MAIN", "FOOTER"]);
    expect(container.querySelector("main")).toHaveAttribute("id", "main-content");
  });

  it("an empty string is treated as unset, not rendered as an empty id", () => {
    const { container } = render(view({ mainId: "" }));
    const main = container.querySelector("main") as HTMLElement;
    expect(main.hasAttribute("id")).toBe(false);
    expect(main.hasAttribute("tabindex")).toBe(false);
  });
});

describe("an empty mainId is absent, not a chrome prop", () => {
  const CHROME_FREE: ReadonlyArray<{ name: string; element: ReactElement }> = [
    { name: "AuthView", element: <AuthView heading="Sign in" description="Welcome back." form={<p>form</p>} mainId="" /> },
    { name: "CaptureView", element: <CaptureView heading="Contact" form={<p>form</p>} mainId="" /> },
    { name: "BoundaryView", element: <BoundaryView status={404} title="Not found" mainId="" /> },
  ];

  it.each(CHROME_FREE)("$name: mainId=\"\" alone stays chrome-free, with no main, banner or contentinfo", ({ element }) => {
    const { container } = render(element);
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
  });
});

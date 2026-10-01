// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { BoundaryView } from "./BoundaryView.js";

afterEach(cleanup);

const ALLOWED_IMPORT = /^(react|@clossys\/designer\/.+\/server|\.\/ErrorView\.js|\.\.\/internal\/viewChromeGround\.js)$/;

/**
 * Every module specifier named by an `import` statement (bare, type, or
 * side-effect) or an `export ... from` re-export. Anchored to the statement
 * shape rather than scanning to the next string literal.
 */
const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map((m) => m[1] as string);
}

function renderBoundary(props: Partial<Parameters<typeof BoundaryView>[0]> = {}) {
  return render(
    <BoundaryView
      brand={<span>Example Studio</span>}
      status={500}
      title="Something went wrong"
      description="Please try again."
      action={<button type="button">Try again</button>}
      {...props}
    />,
  );
}

describe("BoundaryView", () => {
  it("frame order: header, then one <main> holding the status <h1>, then footer", () => {
    const { container } = renderBoundary();
    const root = container.firstElementChild as HTMLElement;
    const children = [...root.children];

    expect(children).toHaveLength(3);
    expect(children[0]?.tagName).toBe("HEADER");
    expect(children[1]?.tagName).toBe("MAIN");
    expect(children[2]?.tagName).toBe("FOOTER");

    expect(container.querySelectorAll("main")).toHaveLength(1);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("500");
    expect(within(children[1] as HTMLElement).getByRole("heading", { level: 1 })).toBe(headings[0]);
  });

  it("height handoff: the outer element owns min-h-dvh and the ErrorView fills <main>", () => {
    const { container } = renderBoundary();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("min-h-dvh");

    const main = container.querySelector("main") as HTMLElement;
    const errorRoot = main.firstElementChild as HTMLElement;
    expect(errorRoot).toContainElement(screen.getByRole("heading", { level: 1 }));
    expect(errorRoot).toHaveClass("min-h-0");
    expect(errorRoot).toHaveClass("flex-1");
    expect(errorRoot).not.toHaveClass("min-h-dvh");
  });

  it("merges a caller className onto the ErrorView root and the rest props too", () => {
    const { container } = renderBoundary({
      className: "bg-surface-raised",
      style: { color: "red" },
      "data-testid": "boundary-error",
    } as never);
    const errorRoot = screen.getByTestId("boundary-error");
    expect(errorRoot).toHaveClass("bg-surface-raised", "min-h-0", "flex-1");
    expect(errorRoot).toHaveStyle({ color: "rgb(255, 0, 0)" });
    expect(container.firstElementChild).not.toHaveAttribute("data-testid");
  });

  it("forwarding: status, title, description and action reach the ErrorView; brand and footerSecondary reach the frame", () => {
    const { container } = renderBoundary({
      footerSecondary: <a href="/status">Service status</a>,
    });
    const main = container.querySelector("main") as HTMLElement;
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent("500");
    expect(within(main).getByRole("heading", { level: 2, name: "Something went wrong" })).toBeInTheDocument();
    expect(within(main).getByText("Please try again.")).toBeInTheDocument();
    expect(within(main).getByRole("button", { name: "Try again" })).toBeInTheDocument();

    const header = container.querySelector("header") as HTMLElement;
    const footer = container.querySelector("footer") as HTMLElement;
    expect(within(header).getByText("Example Studio")).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Service status" })).toBeInTheDocument();
    expect(main).not.toHaveTextContent("Example Studio");
    expect(main).not.toHaveTextContent("Service status");
  });

  it("renders headerAction, secondaryAction and nav inside the banner landmark and nowhere else", () => {
    const { container } = renderBoundary({
      headerAction: <a href="/contact">Contact us</a>,
      secondaryAction: <a href="/sign-in">Sign in</a>,
      nav: <nav aria-label="Primary">NAV-SENTINEL</nav>,
    });
    const banner = screen.getByRole("banner");
    const primary = within(banner).getByRole("link", { name: "Contact us" });
    const secondary = within(banner).getByRole("link", { name: "Sign in" });
    expect(within(banner).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("main")).not.toHaveTextContent(/Contact us|Sign in|NAV-SENTINEL/);
    expect(container.querySelector("footer")).not.toHaveTextContent(/Contact us|Sign in|NAV-SENTINEL/);
    expect(container.querySelector("main [ground], main [nav]")).toBeNull();
  });

  it("renders the same header and footer as a bare SiteHeader and SiteFooter when every slot is omitted", () => {
    const html = renderToStaticMarkup(
      <BoundaryView brand="Example Studio" status={500} title="Something went wrong" footerSecondary={<span>FOOTER-SENTINEL</span>} />,
    );
    expect(html).toContain(renderToStaticMarkup(<SiteHeader brand="Example Studio" />) + "<main");
    expect(html).toContain("</main>" + renderToStaticMarkup(<SiteFooter secondary={<span>FOOTER-SENTINEL</span>} />) + "</div>");
  });

  it("passes ground to both the header and the footer", () => {
    const html = renderToStaticMarkup(<BoundaryView brand="Example Studio" status={500} title="Something went wrong" ground="transparent" />);
    expect(html).toContain(renderToStaticMarkup(<SiteHeader ground="transparent" brand="Example Studio" />) + "<main");
    expect(html).toContain("</main>" + renderToStaticMarkup(<SiteFooter ground="transparent" />) + "</div>");
  });

  it("imports only react, @clossys/designer/*/server, ./ErrorView.js and ../internal/viewChromeGround.js (no router, no hooks)", () => {
    const source = readFileSync(join(import.meta.dirname, "BoundaryView.tsx"), "utf8");
    const specifiers = moduleSpecifiers(source);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).toMatch(ALLOWED_IMPORT);
    }
    expect(source).not.toMatch(/\brequire\(|import\(/);
    expect(source).not.toMatch(/["']use client["']/);
  });

  it("the import scan catches a router, a client barrel and a bare import", () => {
    const sample = [
      'import type { A } from "react";',
      'import { Link } from "react-router";',
      'import { SiteHeader } from "@clossys/designer/shell";',
      'import "some-auth-provider";',
    ].join("\n");
    const offenders = moduleSpecifiers(sample).filter((specifier) => !ALLOWED_IMPORT.test(specifier));
    expect(offenders).toEqual(["react-router", "@clossys/designer/shell", "some-auth-provider"]);
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Home, Settings } from "@clossys/designer/icons";
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

  it("body structure: a page header block (status <h1>, title <h2>, description), then the action in a card, then the notes", () => {
    const { container } = renderBoundary({ notes: <a href="/support">Contact support</a> });
    const main = container.querySelector("main") as HTMLElement;
    const blocks = [...main.children] as HTMLElement[];
    expect(blocks).toHaveLength(3);
    const [headerBlock, card, notes] = blocks as [HTMLElement, HTMLElement, HTMLElement];
    expect(headerBlock.children[0]?.tagName).toBe("H1");
    expect(headerBlock.children[0]).toHaveTextContent("500");
    expect(headerBlock.children[1]?.tagName).toBe("H2");
    expect(headerBlock.children[1]).toHaveTextContent("Something went wrong");
    expect(headerBlock.children[2]).toHaveTextContent("Please try again.");
    expect(card).toHaveClass("rounded-control");
    expect(card).toContainElement(screen.getByRole("button", { name: "Try again" }));
    expect(card.children).toHaveLength(1);
    expect(notes).toContainElement(screen.getByRole("link", { name: "Contact support" }));
    expect(notes.className).toContain("flex flex-col gap-xs text-body-s text-ink-secondary");
  });

  it("omits the card when there is no action and the notes block when there are no notes", () => {
    const { container } = renderBoundary({ action: undefined });
    const main = container.querySelector("main") as HTMLElement;
    expect(main.children).toHaveLength(1);
    expect(main.querySelector(".rounded-control")).toBeNull();
  });

  it("shares AuthView's form-measure column with no raw-length fallback", () => {
    const { container } = renderBoundary();
    const main = container.querySelector("main") as HTMLElement;
    expect(main.style.maxWidth).toBe("var(--ui-width-form-max, none)");
    expect(main.style.maxWidth).not.toMatch(/rem|px/);
  });

  it("the outer element owns min-h-dvh and takes a caller className, style and the rest props (break: they no longer reach an ErrorView root)", () => {
    const { container } = renderBoundary({
      className: "bg-surface-raised",
      style: { color: "red" },
      "data-testid": "boundary-root",
    } as never);
    const root = screen.getByTestId("boundary-root");
    expect(root).toBe(container.firstElementChild);
    expect(root).toHaveClass("bg-surface-raised", "min-h-dvh", "flex-col");
    expect(root).toHaveStyle({ color: "rgb(255, 0, 0)" });
    expect(container.querySelector("main")?.querySelector("[data-testid]")).toBeNull();
  });

  it("forwarding: status, title, description and action reach <main>; brand and footerSecondary reach the frame", () => {
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

  it("one front-door shell: environment links in the banner, one <h1>, one top-level banner, one contentinfo holding SiteFooter.Legal", () => {
    const { container } = renderBoundary({
      status: 404,
      title: "Page not found",
      headerAction: (
        <>
          <SiteHeader.ActionLink href="https://app.example.com/" label="App" icon={Home} isCurrent />
          <SiteHeader.ActionLink href="https://admin.example.com/" label="Admin" icon={Settings} />
        </>
      ),
      footerSecondary: (
        <SiteFooter.Legal
          entity="Acme"
          links={[
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
          ]}
        />
      ),
    });
    const root = container.firstElementChild as HTMLElement;
    const topLevelHeaders = [...root.querySelectorAll("header")].filter((header) => header.closest("main") === null);
    expect(topLevelHeaders).toHaveLength(1);
    const banner = topLevelHeaders[0] as HTMLElement;
    const app = within(banner).getByRole("link", { name: "App" });
    const admin = within(banner).getByRole("link", { name: "Admin" });
    expect(app).toHaveAttribute("aria-current", "true");
    expect(admin).not.toHaveAttribute("aria-current");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const footers = screen.getAllByRole("contentinfo");
    expect(footers).toHaveLength(1);
    expect(within(footers[0] as HTMLElement).getByText(/^© \d{4} Acme$/)).toBeInTheDocument();
    expect(within(footers[0] as HTMLElement).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(footers[0] as HTMLElement).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});

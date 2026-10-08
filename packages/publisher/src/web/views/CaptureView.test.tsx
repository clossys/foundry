// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Home, Settings } from "@clossys/designer/icons";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { CaptureView } from "./CaptureView.js";

afterEach(cleanup);

/** Every `var(` call in `source`, found by balanced parentheses so a nested `var()` in a fallback stays inside its outer call. */
function varCalls(source: string): string[] {
  const calls: string[] = [];
  for (let at = source.indexOf("var("); at !== -1; at = source.indexOf("var(", at + 1)) {
    let depth = 0;
    for (let i = at + 3; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) {
        calls.push(source.slice(at, i + 1));
        break;
      }
    }
  }
  return calls;
}

/** Assembles a `var()` call from parts, so this file never carries a literal `var(--x)` without a fallback for the contamination scan to flag. */
const cssVar = (name: string, fallback?: string): string => `var(--${name}${fallback === undefined ? "" : `, ${fallback}`})`;

describe("varCalls scanner", () => {
  it("flags a raw length in a fallback nested inside min()", () => {
    expect(hasRawLengthFallback(cssVar("a", `min(${cssVar("b")}, 2rem)`))).toBe(true);
    expect(hasRawLengthFallback(cssVar("a", `min(${cssVar("b")}, none)`))).toBe(false);
  });
});

const RAW_LENGTH = /(^|[\s,(])-?(\d+(\.\d*)?|\.\d+)(px|rem|em|vw|vh|dvh|ch|%)/;

/** True when the fallback of any `var(` call in `source`, however deeply nested, carries a raw length literal. */
function hasRawLengthFallback(source: string): boolean {
  return varCalls(source).some((call) => {
    const commaAt = call.indexOf(",");
    return commaAt !== -1 && RAW_LENGTH.test(call.slice(commaAt + 1, -1));
  });
}

describe("CaptureView", () => {
  it("keeps an error summary before the consumer form and exposes the documented focus target", () => {
    const html = renderToStaticMarkup(
      <CaptureView brand="Acme" heading="Keep in touch" errorSummaryId="capture-errors" errorSummary="Please correct the form." form={<form id="capture-form">Fields</form>} />,
    );
    expect(html).toContain('id="capture-errors" role="alert" tabindex="-1"');
    expect(html.indexOf("Please correct the form.")).toBeLessThan(html.indexOf('id="capture-form"'));
    expect(html).toContain('<h1 class="text-h1');
    const cardAt = html.indexOf("rounded-control");
    expect(cardAt).toBeGreaterThan(html.indexOf("<h1"));
    expect(cardAt).toBeLessThan(html.indexOf('id="capture-form"'));
  });

  it("replaces form and errors in place with a polite submitted state", () => {
    const html = renderToStaticMarkup(
      <CaptureView brand="Acme" heading="Keep in touch" errorSummaryId="capture-errors" errorSummary="Old error" form="Old form" submitted="Thanks — we received it." />,
    );
    expect(html).toContain('<section role="status" aria-live="polite">Thanks — we received it.</section>');
    expect(html).not.toContain("Old form");
    expect(html).not.toContain("Old error");
  });

  it("names the form region Capture form unless formLabel is passed", () => {
    const defaults = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" />);
    expect(defaults).toContain('aria-label="Capture form"');
    const custom = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" formLabel="Formulario" />);
    expect(custom).toContain('aria-label="Formulario"');
    expect(custom).not.toContain("Capture form");
  });

  it("fails closed when the form-state or error-focus contract is incomplete", () => {
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" />)).toThrow(/requires form/);
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" errorSummary="Invalid" />)).toThrow(/errorSummary and errorSummaryId together/);
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" errorSummary="Invalid" errorSummaryId="  " />)).toThrow(/non-whitespace/);
  });

  it("recognises a raw length in a var() fallback, including a leading-dot or nested one", () => {
    expect(hasRawLengthFallback("var(--a, .5rem)")).toBe(true);
    expect(hasRawLengthFallback("var(--a, 0.5rem)")).toBe(true);
    expect(hasRawLengthFallback("var(--a, var(--b, 48rem))")).toBe(true);
    expect(hasRawLengthFallback("var(--a, none)")).toBe(false);
    expect(hasRawLengthFallback("var(--a, var(--b, none))")).toBe(false);
  });

  it("carries no raw length literal in a var() fallback", () => {
    // The column's measure token lives in the shared page layout, which the view builds its column from.
    const source = ["CaptureView.tsx", join("..", "internal", "PageLayout.tsx")].map((file) => readFileSync(join(import.meta.dirname, file), "utf8")).join("\n");
    expect(varCalls(source).length).toBeGreaterThan(0);
    expect(hasRawLengthFallback(source)).toBe(false);
    const html = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" />);
    const mainTag = html.slice(html.indexOf("<main"), html.indexOf(">", html.indexOf("<main")) + 1);
    expect(mainTag).toContain("max-width:var(--ui-width-prose-max, none)");
  });

  it("body structure: page header block, then the card holding the form and secondaryAction, then the notes below the card", () => {
    const { container } = render(
      <CaptureView
        brand="Acme"
        heading="Keep in touch"
        description="We reply within a week."
        form={<form aria-label="Contact form">Fields</form>}
        secondaryAction={<a href="/">Back to home</a>}
        notes={<p>We use your email only to reply.</p>}
      />,
    );
    const main = screen.getByRole("main");
    const blocks = [...main.children] as HTMLElement[];
    expect(blocks).toHaveLength(3);
    expect(within(blocks[0] as HTMLElement).getByRole("heading", { level: 1, name: "Keep in touch" })).toBeInTheDocument();
    const card = container.querySelector(".rounded-control") as HTMLElement;
    expect(blocks[1]).toContainElement(card);
    expect(card).toContainElement(screen.getByRole("form", { name: "Contact form" }));
    expect(card).toContainElement(screen.getByRole("link", { name: "Back to home" }));
    const notes = blocks[2] as HTMLElement;
    expect(card).not.toContainElement(notes);
    expect(notes).toHaveTextContent("We use your email only to reply.");
    expect(notes.className).toContain("flex flex-col items-center gap-xs text-center text-body-s text-ink-secondary");
  });

  it("omits the notes block when no notes are given", () => {
    render(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" />);
    expect(screen.getByRole("main").children).toHaveLength(2);
  });

  it("renders nav, headerSecondaryAction and headerAction inside the one top-level banner, in that order", () => {
    const { container } = render(
      <CaptureView
        brand="Acme"
        heading="Keep in touch"
        form="Fields"
        nav={<nav aria-label="Primary">NAV-SENTINEL</nav>}
        headerSecondaryAction={<a href="/sign-in">Sign in</a>}
        headerAction={<a href="/contact">Contact us</a>}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    const topLevelHeaders = [...root.querySelectorAll("header")].filter((header) => header.closest("main") === null);
    expect(topLevelHeaders).toHaveLength(1);
    const banner = topLevelHeaders[0] as HTMLElement;
    expect(within(banner).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    const secondary = within(banner).getByRole("link", { name: "Sign in" });
    const primary = within(banner).getByRole("link", { name: "Contact us" });
    expect(secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("main")).not.toHaveTextContent(/Sign in|Contact us|NAV-SENTINEL/);
  });

  it("passes ground to both the header and the footer, and renders the bare chrome when every slot is omitted", () => {
    const bare = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" />);
    expect(bare).toContain(renderToStaticMarkup(<SiteHeader brand="Acme" />) + "<main");
    expect(bare).toContain("</main>" + renderToStaticMarkup(<SiteFooter />) + "</div>");
    const grounded = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" ground="transparent" />);
    expect(grounded).toContain(renderToStaticMarkup(<SiteHeader ground="transparent" brand="Acme" />) + "<main");
    expect(grounded).toContain("</main>" + renderToStaticMarkup(<SiteFooter ground="transparent" />) + "</div>");
  });

  it("one front-door shell: environment links with aria-current, one <h1>, one top-level banner, one contentinfo holding SiteFooter.Legal", () => {
    const { container } = render(
      <CaptureView
        brand="Acme"
        heading="Keep in touch"
        form="Fields"
        headerAction={
          <>
            <SiteHeader.ActionLink href="https://example.com/" label="Site" icon={Home} isCurrent />
            <SiteHeader.ActionLink href="https://admin.example.com/" label="Admin" icon={Settings} />
          </>
        }
        footerSecondary={
          <SiteFooter.Legal
            entity="Acme"
            links={[
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
            ]}
          />
        }
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    const topLevelHeaders = [...root.querySelectorAll("header")].filter((header) => header.closest("main") === null);
    expect(topLevelHeaders).toHaveLength(1);
    const banner = topLevelHeaders[0] as HTMLElement;
    expect(within(banner).getByRole("link", { name: "Site" })).toHaveAttribute("aria-current", "true");
    expect(within(banner).getByRole("link", { name: "Admin" })).not.toHaveAttribute("aria-current");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const footers = screen.getAllByRole("contentinfo");
    expect(footers).toHaveLength(1);
    const footer = footers[0] as HTMLElement;
    expect(within(footer).getByText(/^© \d{4} Acme$/)).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});
